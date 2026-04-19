"""
pipeline.py — Main ML pipeline loop
Owner: Andrea

Ties together: webcam → MediaPipe → feature extraction → ROM normalization
→ gesture classification → WebSocket output → Arduino haptic trigger.

Run standalone for testing:
    python3 pipeline.py

Or import PipelineRunner and call run() from FastAPI (Sakshi's server).

WebSocket message schema (outbound, agreed with Sakshi):
{
    "type": "pipeline",
    "gesture": str,
    "confidence": float,
    "normalized_features": {feature: float [0,1]},
    "active_joints": {feature: bool},
    "fatigue_detected": bool,
    "calibrated": bool,
    "calibration_progress": float,   # 0.0-1.0, only during calibration
    "timestamp_ms": int
}
"""

import time
import json
import asyncio
import cv2
import numpy as np
import requests
from pathlib import Path
from typing import Optional, Callable

from mediapipe_tracker import LandmarkTracker
from feature_extractor import FeatureExtractor
from rom_calibration import ROMCalibrator, ROMNormalizer, ROMProfile
from gesture_classifier import GestureClassifier
from fma_scoring import FMAScorer

MODEL_PATH = Path("gesture_classifier.pkl")
PROFILE_DIR = Path("rom_profiles")   # saved per-user calibration profiles


class PipelineRunner:
    """
    Single object that owns the full ML pipeline for one session.
    Thread-safe output via on_message callback.
    """

    def __init__(
        self,
        on_message: Optional[Callable[[dict], None]] = None,
        camera_index: int = 0,
        draw_landmarks: bool = True,
    ):
        self.on_message = on_message or (lambda msg: None)
        self.camera_index = camera_index
        self.draw_landmarks = draw_landmarks

        # Pipeline components
        self.tracker = LandmarkTracker(draw_landmarks=draw_landmarks)
        self.extractor = FeatureExtractor()
        self.classifier = GestureClassifier.load(MODEL_PATH)

        # Calibration state
        self.calibrator = ROMCalibrator()
        self.normalizer: Optional[ROMNormalizer] = None
        self.calibrated = False
        self.current_user = "user"

        # FMA scoring
        self.fma_scorer = FMAScorer()
        self._session_stats: dict = {}   # running max of normalized features per session
        self._fma_result = None          # latest computed FMA score
        self._fma_frame_counter = 0      # recompute every 30 frames (~1/sec)

        # Runtime flags
        self._running = False
        PROFILE_DIR.mkdir(exist_ok=True)

    # --- Calibration control (called by UI / API) ---

    def start_calibration(self, user_id: str = "user"):
        """Begin 30-second ROM calibration for a new user."""
        self.current_user = user_id
        self.calibrated = False
        self.normalizer = None
        self.extractor.reset_history()
        self.calibrator.start(user_id=user_id)
        print(f"[pipeline] Calibration started for '{user_id}'")

    def load_profile(self, user_id: str) -> bool:
        """
        Load a saved ROM profile — demo contingency fallback so calibration
        isn't required every run. Returns True if profile found and loaded.
        """
        path = PROFILE_DIR / f"{user_id}.json"
        if path.exists():
            profile = ROMProfile.load(str(path))
            if profile.is_valid():
                self.normalizer = ROMNormalizer(profile)
                self.calibrated = True
                self.current_user = user_id
                print(f"[pipeline] Loaded saved ROM profile for '{user_id}'")
                return True
        return False

    def _finish_calibration(self):
        """Called internally when calibration timer completes."""
        profile = self.calibrator.finish()
        if profile.is_valid():
            self.normalizer = ROMNormalizer(profile)
            self.calibrated = True
            # Save profile for demo contingency
            profile.save(str(PROFILE_DIR / f"{self.current_user}.json"))
            print(f"[pipeline] Calibration complete for '{self.current_user}' — profile saved")
        else:
            print("[pipeline] WARNING: Calibration produced no valid ranges — try again")

    # --- Main loop ---

    def run(self, show_window: bool = True):
        """
        Blocking main loop. Call from a thread or use run_async() from FastAPI.
        Press 'c' to start calibration, 'q' to quit, 'u' to switch user.
        """
        cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open camera {self.camera_index}")
        print(f"[pipeline] Camera {self.camera_index} opened OK.")

        self._running = True
        frame_count = 0
        start = time.time()

        cv2.namedWindow("KineticLab — Pipeline", cv2.WINDOW_NORMAL)
        print("[pipeline] Running. Keys: [c] calibrate  [u] switch user  [q] quit")
        if not self.calibrated:
            print("[pipeline] Not calibrated — press 'c' to start calibration")

        try:
            while self._running:
                ret, frame = cap.read()
                if not ret:
                    break

                # --- Process frame ---
                msg = self.tracker.process_frame(frame)
                features = self.extractor.extract(msg)

                output = {
                    "type": "pipeline",
                    "gesture": "unknown",
                    "confidence": 0.0,
                    "normalized_features": {},
                    "active_joints": {},
                    "fatigue_detected": False,
                    "calibrated": self.calibrated,
                    "calibration_progress": 0.0,
                    "timestamp_ms": msg["timestamp_ms"],
                    # Live FMA-UE subscale score (updates ~1/sec after calibration)
                    "fma_total": self._fma_result.total_score if self._fma_result else None,
                    "fma_severity": self._fma_result.severity if self._fma_result else None,
                    "fma_domain_a": self._fma_result.domain_a_score if self._fma_result else None,
                    "fma_domain_c": self._fma_result.domain_c_score if self._fma_result else None,
                    "fma_domain_e": self._fma_result.domain_e_score if self._fma_result else None,
                }

                if features is not None:
                    # --- Calibration update ---
                    if self.calibrator.is_running:
                        progress = self.calibrator.update(features)
                        output["calibration_progress"] = progress
                        if progress >= 1.0:
                            self._finish_calibration()

                    # --- ROM normalization ---
                    if self.normalizer is not None:
                        norm_result = self.normalizer.process(features)
                        output["normalized_features"] = norm_result["normalized"]
                        output["active_joints"] = norm_result["active"]
                        output["fatigue_detected"] = norm_result["fatigue_detected"]

                        # Use normalized features for classification when calibrated
                        norm_features = {
                            k: norm_result["normalized"].get(k, v)
                            for k, v in features.items()
                        }
                        pred = self.classifier.predict(norm_features)

                        # --- Update session stats (running max for FMA scoring) ---
                        norm = norm_result["normalized"]
                        gesture = pred["gesture"]
                        self._update_session_stats(norm, gesture)

                        # --- Recompute FMA score every 30 frames ---
                        self._fma_frame_counter += 1
                        if self._fma_frame_counter % 30 == 0:
                            import time as _time
                            self._fma_result = self.fma_scorer.score_session(
                                self._session_stats,
                                user_id=self.current_user,
                                session_id=f"live_{self.current_user}",
                                timestamp=_time.time(),
                            )
                        # Inject latest FMA into output
                        if self._fma_result:
                            output["fma_total"]    = self._fma_result.total_score
                            output["fma_severity"] = self._fma_result.severity
                            output["fma_domain_a"] = self._fma_result.domain_a_score
                            output["fma_domain_c"] = self._fma_result.domain_c_score
                            output["fma_domain_e"] = self._fma_result.domain_e_score
                    else:
                        # Pre-calibration: classify on raw features
                        pred = self.classifier.predict(features)

                    output["gesture"] = pred["gesture"]
                    output["confidence"] = pred["confidence"]

                # --- Emit to WebSocket / callback ---
                self.on_message(output)
                self._post_to_backend(output)

                # --- HUD overlay ---
                if show_window:
                    self._draw_hud(frame, output)
                    cv2.imshow("KineticLab — Pipeline", frame)

                # --- FPS log ---
                frame_count += 1
                if frame_count % 60 == 0:
                    fps = frame_count / (time.time() - start)
                    print(f"[pipeline] FPS: {fps:.1f} | gesture: {output['gesture']} "
                          f"({output['confidence']:.0%}) | calibrated: {self.calibrated}")

                # --- Poll backend for calibration trigger from website ---
                if frame_count % 30 == 0:  # check ~once per second
                    self._check_calibration_trigger()

                # --- Key handling ---
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                elif key == ord("c"):
                    self.start_calibration(self.current_user)
                elif key == ord("u"):
                    # Simple user switch — auto-recalibrates
                    new_user = f"user_{int(time.time()) % 1000}"
                    self.start_calibration(new_user)
                    print(f"[pipeline] Switched to new user '{new_user}' — recalibrating")

        finally:
            self._running = False
            self.tracker.release()
            cap.release()
            if show_window:
                cv2.destroyAllWindows()

    def _update_session_stats(self, norm: dict, gesture: str):
        """Track running max of normalized features for FMA scoring."""
        # Map normalized feature keys → FMA session stat keys
        key_map = {
            "shoulder_flexion_r":   "shoulder_flexion_r_max",
            "shoulder_abduction_r": "shoulder_abduction_r_max",
            "elbow_angle_r":        "elbow_extension_r_max",
            "wrist_angle_r":        "wrist_flexion_r_max",
            "forearm_rotation":     "forearm_pronation_r_range",
            "tremor_r":             "tremor_variance_r_mean",
            "wrist_velocity_r":     "wrist_flexion_r_smoothness",
        }
        for feat_key, stat_key in key_map.items():
            val = norm.get(feat_key, 0.0)
            # tremor: track mean (lower is better) — use running min instead
            if "tremor" in stat_key:
                self._session_stats[stat_key] = min(
                    self._session_stats.get(stat_key, 1.0), val
                )
            else:
                self._session_stats[stat_key] = max(
                    self._session_stats.get(stat_key, 0.0), val
                )

        # Gesture-specific accuracy stats
        if gesture == "target_reach":
            conf = self._session_stats.get("_reach_conf_count", 0)
            total = self._session_stats.get("_reach_total", 0) + 1
            self._session_stats["_reach_total"] = total
            self._session_stats["reach_accuracy_mean"] = (
                (self._session_stats.get("reach_accuracy_mean", 0.0) * conf + norm.get("shoulder_flexion_r", 0.0))
                / total
            )
            self._session_stats["_reach_conf_count"] = total

        if gesture == "trajectory_trace":
            total = self._session_stats.get("_trace_total", 0) + 1
            self._session_stats["_trace_total"] = total
            self._session_stats["trajectory_accuracy_mean"] = (
                (self._session_stats.get("trajectory_accuracy_mean", 0.0) * (total - 1) + norm.get("wrist_angle_r", 0.0))
                / total
            )

        if gesture == "bimanual_reach":
            total = self._session_stats.get("_bim_total", 0) + 1
            self._session_stats["_bim_total"] = total
            self._session_stats["bimanual_timing_score"] = (
                (self._session_stats.get("bimanual_timing_score", 0.0) * (total - 1) + norm.get("shoulder_flexion_r", 0.0))
                / total
            )
            self._session_stats["movement_speed_score"] = norm.get("wrist_velocity_r", 0.0)

    def _check_calibration_trigger(self):
        """Poll backend for a calibration trigger from the website."""
        try:
            resp = requests.get(
                "http://localhost:8000/internal/calibrate/pending",
                timeout=0.1,
            )
            data = resp.json()
            if data.get("pending"):
                user_id = data.get("user_id", "user")
                print(f"[pipeline] Calibration triggered from website for '{user_id}'")
                self.start_calibration(user_id)
        except Exception:
            pass  # backend not running — ignore

    def _post_to_backend(self, output: dict):
        """POST gesture data to Sakshi's FastAPI backend."""
        if output["gesture"] == "unknown":
            return
        norm = output.get("normalized_features", {})
        normalized_rom = sum(norm.values()) / len(norm) if norm else 0.0
        try:
            requests.post(
                "http://localhost:8000/internal/gesture",
                json={
                    "name": output["gesture"],
                    "confidence": output["confidence"],
                    "normalized_rom": round(normalized_rom, 4),
                    "fma_total": output.get("fma_total"),
                    "fma_severity": output.get("fma_severity"),
                    "fma_domain_a": output.get("fma_domain_a"),
                    "fma_domain_c": output.get("fma_domain_c"),
                    "fma_domain_e": output.get("fma_domain_e"),
                },
                timeout=0.05,  # drop if backend is slow — don't block the pipeline
            )
        except Exception:
            pass  # pipeline keeps running even if backend is down

    def stop(self):
        self._running = False

    # --- HUD overlay ---

    def _draw_hud(self, frame: np.ndarray, output: dict):
        """Draw gesture + calibration status overlay."""
        h, w = frame.shape[:2]

        # Top banner
        cv2.rectangle(frame, (0, 0), (w, 85), (15, 15, 15), -1)

        # Calibration state
        if self.calibrator.is_running:
            prog = output["calibration_progress"]
            bar_w = int(prog * (w - 30))
            cv2.rectangle(frame, (15, 55), (w - 15, 78), (50, 50, 50), -1)
            cv2.rectangle(frame, (15, 55), (15 + bar_w, 78), (0, 200, 255), -1)
            cv2.putText(frame, f"CALIBRATING... {prog*100:.0f}%",
                        (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 255), 2)
        elif not self.calibrated:
            cv2.putText(frame, "NOT CALIBRATED — press [c] to calibrate",
                        (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 80, 255), 2)
        else:
            cv2.putText(frame, f"User: {self.current_user}  [u]=switch user  [c]=recalibrate",
                        (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (100, 200, 100), 1)

        # Gesture label
        gesture = output["gesture"]
        conf = output["confidence"]
        color = (0, 255, 100) if conf > 0.7 else (0, 180, 255)
        cv2.putText(frame, f"{gesture}  {conf:.0%}",
                    (15, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.85, color, 2)

        # Fatigue indicator
        if output.get("fatigue_detected"):
            cv2.putText(frame, "FATIGUE DETECTED — thresholds lowered",
                        (15, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 100, 255), 1)


# --- Standalone test ---

def print_output(msg: dict):
    """Simple console callback for standalone testing."""
    print(
        f"  gesture={msg['gesture']:20s}  conf={msg['confidence']:.0%}"
        f"  calibrated={msg['calibrated']}  fatigue={msg['fatigue_detected']}",
        end="\r"
    )


if __name__ == "__main__":
    print("KineticLab Pipeline — standalone test")
    print("Press [c] to calibrate, [q] to quit\n")

    runner = PipelineRunner(on_message=print_output, draw_landmarks=True, camera_index=1)

    # Try loading a saved profile first (demo contingency)
    runner.load_profile("default")

    runner.run(show_window=True)
