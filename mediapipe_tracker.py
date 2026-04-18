"""
mediapipe_tracker.py — Landmark extraction via MediaPipe Pose + Hands
Owner: Andrea

Extracts 33 body landmarks (Pose) + 21 landmarks per hand (Hands) at 25-30 fps.
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
"""

import time
import cv2
import mediapipe as mp
import numpy as np
from typing import Optional

# MediaPipe solution handles — initialize once, reuse across frames
mp_pose = mp.solutions.pose
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils


class LandmarkTracker:
    """
    Wraps MediaPipe Pose + Hands and produces a unified landmark dict per frame.
    Single tracker instance per session — not thread-safe, call from one thread.
    """

    def __init__(
        self,
        pose_confidence: float = 0.5,
        hand_confidence: float = 0.5,
        draw_landmarks: bool = True,
    ):
        # Why separate models: Pose gives body structure for shoulder/elbow scoring;
        # Hands gives finger/wrist detail needed for FMA-UE domains C and E.
        self.pose = mp_pose.Pose(
            static_image_mode=False,
            model_complexity=1,          # 0=lite, 1=full, 2=heavy — 1 balances accuracy/latency
            enable_segmentation=False,   # not needed, saves ~5ms
            min_detection_confidence=pose_confidence,
            min_tracking_confidence=pose_confidence,
        )
        self.hands = mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=hand_confidence,
            min_tracking_confidence=hand_confidence,
        )
        self.draw_landmarks = draw_landmarks

    def process_frame(self, frame: np.ndarray) -> dict:
        """
        Process a single BGR frame from OpenCV.
        Returns a landmark dict ready to send over the WebSocket.
        """
        # MediaPipe expects RGB — convert once here so callers stay BGR
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False  # performance hint to MediaPipe

        pose_results = self.pose.process(rgb)
        hand_results = self.hands.process(rgb)

        rgb.flags.writeable = True

        # Optionally draw skeleton overlay for debug/demo visualization
        if self.draw_landmarks:
            if pose_results.pose_landmarks:
                mp_drawing.draw_landmarks(
                    frame, pose_results.pose_landmarks, mp_pose.POSE_CONNECTIONS
                )
            if hand_results.multi_hand_landmarks:
                for hand_lm in hand_results.multi_hand_landmarks:
                    mp_drawing.draw_landmarks(
                        frame, hand_lm, mp_hands.HAND_CONNECTIONS
                    )

        return self._build_message(pose_results, hand_results)

    def _build_message(self, pose_results, hand_results) -> dict:
        """
        Convert raw MediaPipe results into the agreed WebSocket schema.
        All coordinates are normalized [0,1] relative to frame dimensions.
        """
        timestamp_ms = int(time.time() * 1000)

        # --- Pose landmarks (33 points) ---
        pose_dict = {}
        if pose_results.pose_landmarks:
            for idx, lm in enumerate(pose_results.pose_landmarks.landmark):
                name = mp_pose.PoseLandmark(idx).name.lower()
                pose_dict[name] = {
                    "x": lm.x,
                    "y": lm.y,
                    "z": lm.z,
                    "visibility": lm.visibility,
                }

        # --- Hand landmarks (21 points each, up to 2 hands) ---
        left_hand = None
        right_hand = None
        if hand_results.multi_hand_landmarks and hand_results.multi_handedness:
            for hand_lm, handedness in zip(
                hand_results.multi_hand_landmarks, hand_results.multi_handedness
            ):
                label = handedness.classification[0].label  # "Left" or "Right"
                hand_dict = {}
                for idx, lm in enumerate(hand_lm.landmark):
                    name = mp_hands.HandLandmark(idx).name.lower()
                    hand_dict[name] = {"x": lm.x, "y": lm.y, "z": lm.z}

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

    def release(self):
        """Clean up MediaPipe resources."""
        self.pose.close()
        self.hands.close()


def run_webcam_test(camera_index: int = 0):
    """
    Quick smoke test — opens webcam and prints landmark counts per frame.
    Run this to verify MediaPipe is working: python mediapipe_tracker.py
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

            # Print a summary every 30 frames so the terminal stays readable
            if frame_count % 30 == 0:
                elapsed = time.time() - start
                fps = frame_count / elapsed
                pose_count = len(msg["pose"])
                lh = len(msg["left_hand"]) if msg["left_hand"] else 0
                rh = len(msg["right_hand"]) if msg["right_hand"] else 0
                print(
                    f"FPS: {fps:.1f} | Pose landmarks: {pose_count}/33 | "
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
