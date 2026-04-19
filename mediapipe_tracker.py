"""
mediapipe_tracker.py — Landmark extraction via MediaPipe Tasks API (Pose + Hands)
Owner: Andrea

Extracts 33 body landmarks (Pose) + 21 landmarks per hand (Hands) at 25-30 fps.
Uses MediaPipe Tasks API (0.10.30+) — solutions API was removed in this version.

Outputs a normalized landmark dict that matches the WebSocket message schema
agreed with Sakshi. DO NOT change output format without checking with Sakshi.

WebSocket message schema (outbound):
{
    "type": "landmarks",
    "pose": {<landmark_name>: {"x": float, "y": float, "z": float, "visibility": float}},
    "left_hand": {<landmark_name>: {"x": float, "y": float, "z": float}} | None,
    "right_hand": {<landmark_name>: {"x": float, "y": float, "z": float}} | None,
    "timestamp_ms": int
}

First run: downloads model files to ./models/ (~7MB each, one-time).
"""

import time
import os
import urllib.request
import cv2
import mediapipe as mp
import numpy as np
from typing import Optional

# --- Tasks API handles ---
BaseOptions         = mp.tasks.BaseOptions
PoseLandmarker      = mp.tasks.vision.PoseLandmarker
PoseLandmarkerOpts  = mp.tasks.vision.PoseLandmarkerOptions
HandLandmarker      = mp.tasks.vision.HandLandmarker
HandLandmarkerOpts  = mp.tasks.vision.HandLandmarkerOptions
VisionRunningMode   = mp.tasks.vision.RunningMode

# --- Landmark name tables (same order as solutions API) ---
POSE_LANDMARK_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky",
    "left_index", "right_index", "left_thumb", "right_thumb",
    "left_hip", "right_hip", "left_knee", "right_knee",
    "left_ankle", "right_ankle", "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
]

HAND_LANDMARK_NAMES = [
    "wrist", "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip",
    "index_finger_mcp", "index_finger_pip", "index_finger_dip", "index_finger_tip",
    "middle_finger_mcp", "middle_finger_pip", "middle_finger_dip", "middle_finger_tip",
    "ring_finger_mcp", "ring_finger_pip", "ring_finger_dip", "ring_finger_tip",
    "pinky_mcp", "pinky_pip", "pinky_dip", "pinky_tip",
]

# Skeleton connections for drawing
POSE_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,7),(0,4),(4,5),(5,6),(6,8),
    (9,10),(11,12),(11,13),(13,15),(15,17),(15,19),(15,21),(17,19),
    (12,14),(14,16),(16,18),(16,20),(16,22),(18,20),
    (11,23),(12,24),(23,24),(23,25),(24,26),(25,27),(26,28),
    (27,29),(28,30),(29,31),(30,32),(27,31),(28,32),
]
HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),(0,5),(5,6),(6,7),(7,8),
    (5,9),(9,10),(10,11),(11,12),(9,13),(13,14),(14,15),(15,16),
    (13,17),(0,17),(17,18),(18,19),(19,20),
]

# Model files — downloaded on first run
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
POSE_MODEL_PATH = os.path.join(MODELS_DIR, "pose_landmarker_lite.task")
HAND_MODEL_PATH = os.path.join(MODELS_DIR, "hand_landmarker.task")
POSE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"


def download_models():
    """Download MediaPipe task model files on first run."""
    os.makedirs(MODELS_DIR, exist_ok=True)
    for path, url, name in [
        (POSE_MODEL_PATH, POSE_MODEL_URL, "Pose"),
        (HAND_MODEL_PATH, HAND_MODEL_URL, "Hand"),
    ]:
        if not os.path.exists(path):
            print(f"Downloading {name} model (~7MB)...")
            urllib.request.urlretrieve(url, path)
            print(f"  [ok] Saved to {path}")
        else:
            print(f"  [ok] {name} model already present")


class LandmarkTracker:
    """
    Wraps MediaPipe Tasks Pose + Hand landmarkers.
    Single tracker instance per session — not thread-safe, call from one thread.
    """

    def __init__(self, draw_landmarks: bool = True):
        download_models()

        self.draw_landmarks = draw_landmarks
        self._start_ms = int(time.time() * 1000)
        self._last_ts = -1  # ensure monotonic timestamps for VIDEO mode

        # Pose landmarker in VIDEO mode (synchronous, timestamp-aware)
        pose_opts = PoseLandmarkerOpts(
            base_options=BaseOptions(model_asset_path=POSE_MODEL_PATH),
            running_mode=VisionRunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._pose = PoseLandmarker.create_from_options(pose_opts)

        # Hand landmarker in VIDEO mode
        hand_opts = HandLandmarkerOpts(
            base_options=BaseOptions(model_asset_path=HAND_MODEL_PATH),
            running_mode=VisionRunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._hands = HandLandmarker.create_from_options(hand_opts)

    def _get_ts(self) -> int:
        """Monotonically increasing timestamp in ms for VIDEO mode."""
        ts = int(time.time() * 1000) - self._start_ms
        if ts <= self._last_ts:
            ts = self._last_ts + 1
        self._last_ts = ts
        return ts

    def process_frame(self, frame: np.ndarray) -> dict:
        """
        Process a single BGR frame from OpenCV.
        Returns a landmark dict ready to send over the WebSocket.
        """
        # Tasks API expects RGB
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts = self._get_ts()

        pose_result = self._pose.detect_for_video(mp_image, ts)
        hand_result = self._hands.detect_for_video(mp_image, ts)

        msg = self._build_message(pose_result, hand_result, ts + self._start_ms)

        if self.draw_landmarks:
            self._draw(frame, pose_result, hand_result)

        return msg

    def _build_message(self, pose_result, hand_result, timestamp_ms: int) -> dict:
        """Convert Tasks API results to agreed WebSocket schema."""
        # --- Pose (33 landmarks) ---
        pose_dict = {}
        if pose_result.pose_landmarks:
            for idx, lm in enumerate(pose_result.pose_landmarks[0]):
                name = POSE_LANDMARK_NAMES[idx]
                pose_dict[name] = {
                    "x": lm.x, "y": lm.y, "z": lm.z,
                    "visibility": getattr(lm, "visibility", 1.0),
                }

        # --- Hands (21 landmarks each) ---
        left_hand = None
        right_hand = None
        if hand_result.hand_landmarks:
            for hand_lms, handedness_list in zip(
                hand_result.hand_landmarks, hand_result.handedness
            ):
                label = handedness_list[0].display_name  # "Left" or "Right"
                hand_dict = {
                    HAND_LANDMARK_NAMES[i]: {"x": lm.x, "y": lm.y, "z": lm.z}
                    for i, lm in enumerate(hand_lms)
                }
                if label == "Left":
                    left_hand = hand_dict
                else:
                    right_hand = hand_dict

        return {
            "type": "landmarks",
            "pose": pose_dict,
            "left_hand": left_hand,
            "right_hand": right_hand,
            "timestamp_ms": timestamp_ms,
        }

    def _draw(self, frame: np.ndarray, pose_result, hand_result):
        """Draw skeleton overlay using OpenCV (drawing_utils removed in Tasks API)."""
        h, w = frame.shape[:2]

        # Draw pose skeleton
        if pose_result.pose_landmarks:
            lms = pose_result.pose_landmarks[0]
            pts = [(int(lm.x * w), int(lm.y * h)) for lm in lms]
            for i, j in POSE_CONNECTIONS:
                if i < len(pts) and j < len(pts):
                    cv2.line(frame, pts[i], pts[j], (0, 255, 0), 2)
            for pt in pts:
                cv2.circle(frame, pt, 4, (0, 128, 255), -1)

        # Draw hand skeletons
        if hand_result.hand_landmarks:
            for hand_lms in hand_result.hand_landmarks:
                pts = [(int(lm.x * w), int(lm.y * h)) for lm in hand_lms]
                for i, j in HAND_CONNECTIONS:
                    if i < len(pts) and j < len(pts):
                        cv2.line(frame, pts[i], pts[j], (255, 0, 128), 2)
                for pt in pts:
                    cv2.circle(frame, pt, 4, (255, 255, 0), -1)

    def release(self):
        """Clean up MediaPipe resources."""
        self._pose.close()
        self._hands.close()


def run_webcam_test(camera_index: int = 0):
    """
    Smoke test — opens webcam and prints landmark counts per frame.
    Run: python3 mediapipe_tracker.py
    """
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open camera index {camera_index}")

    tracker = LandmarkTracker(draw_landmarks=True)
    print("MediaPipe tracker running. Press 'q' to quit.")

    frame_count = 0
    start = time.time()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            msg = tracker.process_frame(frame)
            frame_count += 1

            if frame_count % 30 == 0:
                elapsed = time.time() - start
                fps = frame_count / elapsed
                pose_count = len(msg["pose"])
                lh = len(msg["left_hand"]) if msg["left_hand"] else 0
                rh = len(msg["right_hand"]) if msg["right_hand"] else 0
                print(
                    f"FPS: {fps:.1f} | Pose: {pose_count}/33 | "
                    f"Left hand: {lh}/21 | Right hand: {rh}/21"
                )

            cv2.imshow("KineticLab — MediaPipe Test", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        tracker.release()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    run_webcam_test()
