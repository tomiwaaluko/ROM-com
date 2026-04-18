"""
feature_extractor.py — Joint angle & velocity feature extraction
Owner: Andrea

Converts raw MediaPipe landmark dicts (from mediapipe_tracker.py) into
numerical features used by the ROM calibration and Random Forest classifier.

Covers FMA-UE domains:
  A: shoulder flexion/abduction, elbow extension (Target Reach)
  C: wrist flexion/extension, forearm pronation/supination (Trajectory Trace)
  E: bilateral timing, tremor variance (Mirror Therapy / Bimanual)
"""

import numpy as np
from typing import Optional


# --- Vector math helpers ---

def _vec(a: dict, b: dict) -> np.ndarray:
    """Return 3D vector from landmark a to landmark b."""
    return np.array([b["x"] - a["x"], b["y"] - a["y"], b["z"] - a["z"]])


def _angle_between(v1: np.ndarray, v2: np.ndarray) -> float:
    """
    Angle in degrees between two vectors.
    Clipped to avoid NaN from floating point errors at exactly ±1.
    """
    cos_theta = np.clip(
        np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-8), -1.0, 1.0
    )
    return float(np.degrees(np.arccos(cos_theta)))


def _joint_angle(proximal: dict, joint: dict, distal: dict) -> float:
    """
    Angle at 'joint' formed by the proximal→joint and distal→joint vectors.
    Standard 3-point joint angle calculation.
    """
    v1 = _vec(joint, proximal)
    v2 = _vec(joint, distal)
    return _angle_between(v1, v2)


# --- Main feature extractor ---

class FeatureExtractor:
    """
    Stateful extractor — keeps a short history buffer for velocity calculation.
    Create one instance per user session.
    """

    HISTORY_LEN = 5  # frames kept for velocity smoothing

    def __init__(self):
        # Rolling buffer of recent landmark dicts for velocity estimation
        self._history: list[dict] = []

    def extract(self, landmarks: dict) -> Optional[dict]:
        """
        Extract features from a single landmark message (from LandmarkTracker).
        Returns None if landmarks are incomplete (e.g. pose not detected).

        Feature dict keys:
          shoulder_flexion_r/l, shoulder_abduction_r/l  (domain A)
          elbow_extension_r/l                            (domain A)
          wrist_flexion_r/l                              (domain C)
          forearm_pronation_r/l                          (domain C, approx)
          wrist_velocity_r/l                             (domain E)
          shoulder_velocity_r/l                          (domain E)
          tremor_variance_r/l                            (domain E)
        """
        pose = landmarks.get("pose", {})
        left_hand = landmarks.get("left_hand")
        right_hand = landmarks.get("right_hand")

        # Bail early if we don't have a full pose — can't score without body
        required = [
            "right_shoulder", "left_shoulder",
            "right_elbow", "left_elbow",
            "right_wrist", "left_wrist",
            "right_hip", "left_hip",
        ]
        if not all(k in pose for k in required):
            return None

        features = {}

        # --- Domain A: Shoulder & Elbow ---
        for side in ("right", "left"):
            hip      = pose[f"{side}_hip"]
            shoulder = pose[f"{side}_shoulder"]
            elbow    = pose[f"{side}_elbow"]
            wrist    = pose[f"{side}_wrist"]

            # Shoulder flexion: angle between torso axis and upper arm
            # Torso axis approximated as hip→shoulder vector
            features[f"shoulder_flexion_{side[0]}"] = _joint_angle(hip, shoulder, elbow)

            # Shoulder abduction: angle from midline
            # Use opposite shoulder as the proximal reference
            opp = "left" if side == "right" else "right"
            features[f"shoulder_abduction_{side[0]}"] = _joint_angle(
                pose[f"{opp}_shoulder"], shoulder, elbow
            )

            # Elbow extension: 180° = fully extended, 0° = fully flexed
            features[f"elbow_extension_{side[0]}"] = _joint_angle(shoulder, elbow, wrist)

        # --- Domain C: Wrist (requires hand landmarks) ---
        for side, hand_lm in (("right", right_hand), ("left", left_hand)):
            wrist_pose = pose[f"{side}_wrist"]
            elbow = pose[f"{side}_elbow"]

            if hand_lm and "wrist" in hand_lm and "middle_finger_mcp" in hand_lm:
                # Wrist flexion: angle between forearm axis and hand axis
                features[f"wrist_flexion_{side[0]}"] = _joint_angle(
                    elbow, wrist_pose, hand_lm["middle_finger_mcp"]
                )
                # Forearm pronation approximated from index/pinky MCP lateral spread
                if "index_finger_mcp" in hand_lm and "pinky_mcp" in hand_lm:
                    lateral = _vec(hand_lm["pinky_mcp"], hand_lm["index_finger_mcp"])
                    # Z-component of lateral vector encodes rotation in camera plane
                    features[f"forearm_pronation_{side[0]}"] = float(lateral[2])
            else:
                # Hand not visible — fill with sentinel so RF doesn't break
                features[f"wrist_flexion_{side[0]}"] = -1.0
                features[f"forearm_pronation_{side[0]}"] = 0.0

        # --- Domain E: Velocity & Tremor (requires history) ---
        self._history.append(pose)
        if len(self._history) > self.HISTORY_LEN:
            self._history.pop(0)

        for side in ("right", "left"):
            if len(self._history) >= 2:
                prev_wrist = self._history[-2][f"{side}_wrist"]
                curr_wrist = pose[f"{side}_wrist"]
                wrist_disp = _vec(prev_wrist, curr_wrist)
                features[f"wrist_velocity_{side[0]}"] = float(np.linalg.norm(wrist_disp))

                prev_shoulder = self._history[-2][f"{side}_shoulder"]
                curr_shoulder = pose[f"{side}_shoulder"]
                shoulder_disp = _vec(prev_shoulder, curr_shoulder)
                features[f"shoulder_velocity_{side[0]}"] = float(np.linalg.norm(shoulder_disp))

                # Tremor: variance of wrist position over history window
                if len(self._history) >= self.HISTORY_LEN:
                    wrist_positions = np.array([
                        [h[f"{side}_wrist"]["x"], h[f"{side}_wrist"]["y"]]
                        for h in self._history
                    ])
                    features[f"tremor_variance_{side[0]}"] = float(np.var(wrist_positions))
                else:
                    features[f"tremor_variance_{side[0]}"] = 0.0
            else:
                features[f"wrist_velocity_{side[0]}"] = 0.0
                features[f"shoulder_velocity_{side[0]}"] = 0.0
                features[f"tremor_variance_{side[0]}"] = 0.0

        return features

    def to_vector(self, features: dict) -> np.ndarray:
        """
        Convert feature dict to a fixed-length numpy vector for the RF classifier.
        Key order is FIXED — changing it breaks the trained model.
        """
        KEY_ORDER = [
            "shoulder_flexion_r", "shoulder_flexion_l",
            "shoulder_abduction_r", "shoulder_abduction_l",
            "elbow_extension_r", "elbow_extension_l",
            "wrist_flexion_r", "wrist_flexion_l",
            "forearm_pronation_r", "forearm_pronation_l",
            "wrist_velocity_r", "wrist_velocity_l",
            "shoulder_velocity_r", "shoulder_velocity_l",
            "tremor_variance_r", "tremor_variance_l",
        ]
        return np.array([features.get(k, 0.0) for k in KEY_ORDER], dtype=np.float32)

    def reset_history(self):
        """Call when switching users or between exercises."""
        self._history.clear()
