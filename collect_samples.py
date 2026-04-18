"""
collect_samples.py — Guided gesture data collection for RF classifier training
Owner: Andrea

Run this with each teammate to collect 50 samples per gesture.
Data is appended to gesture_data.npy so you can run multiple sessions.

Usage:
    python3 collect_samples.py --user andrea
    python3 collect_samples.py --user tomiwa
    python3 collect_samples.py --user sakshi
    python3 collect_samples.py --user sreekar

Gestures collected:
    0 = neutral (arms relaxed at sides)
    1 = target_reach (reach arm forward/up toward a target)
    2 = trajectory_trace (wrist trace motion, hand extended)
    3 = forearm_rotation (rotate forearm/wrist like turning a key)
    4 = bimanual_reach (reach with both arms toward center)
"""

import argparse
import time
import cv2
import numpy as np
from pathlib import Path

from mediapipe_tracker import LandmarkTracker
from feature_extractor import FeatureExtractor

# --- Config ---
SAMPLES_PER_GESTURE = 50
PREP_SECONDS = 3          # countdown before recording starts
DATA_PATH = Path("gesture_data.npy")

GESTURES = {
    0: {
        "name": "neutral",
        "instruction": "Relax arms at your sides. Stay still.",
        "color": (150, 150, 150),
    },
    1: {
        "name": "target_reach",
        "instruction": "Reach your RIGHT arm forward and UP toward an imaginary target.",
        "color": (0, 200, 100),
    },
    2: {
        "name": "trajectory_trace",
        "instruction": "Extend RIGHT hand, trace a slow arc left-to-right with your wrist.",
        "color": (0, 150, 255),
    },
    3: {
        "name": "forearm_rotation",
        "instruction": "Hold RIGHT arm out, rotate forearm like turning a doorknob.",
        "color": (255, 150, 0),
    },
    4: {
        "name": "bimanual_reach",
        "instruction": "Reach BOTH arms forward toward center, like picking up a box.",
        "color": (200, 0, 200),
    },
}


def draw_ui(frame, state: str, gesture_id: int, count: int, total: int, countdown: int = 0):
    """Draw collection UI overlay on frame."""
    h, w = frame.shape[:2]
    gesture = GESTURES[gesture_id]
    color = gesture["color"]

    # Dark banner at top
    cv2.rectangle(frame, (0, 0), (w, 110), (20, 20, 20), -1)

    # Gesture name
    cv2.putText(frame, f"Gesture: {gesture['name']} (label {gesture_id})",
                (15, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)

    # Instruction
    cv2.putText(frame, gesture["instruction"],
                (15, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 1)

    if state == "prep":
        # Countdown
        cv2.rectangle(frame, (0, h - 80), (w, h), (20, 20, 20), -1)
        cv2.putText(frame, f"GET READY... {countdown}",
                    (15, h - 30), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 255), 2)

    elif state == "recording":
        # Progress bar
        bar_w = int((count / total) * (w - 30))
        cv2.rectangle(frame, (15, h - 50), (w - 15, h - 20), (50, 50, 50), -1)
        cv2.rectangle(frame, (15, h - 50), (15 + bar_w, h - 20), color, -1)
        cv2.putText(frame, f"Recording: {count}/{total}",
                    (15, h - 55), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        # Flashing REC indicator
        if int(time.time() * 2) % 2 == 0:
            cv2.circle(frame, (w - 30, 30), 12, (0, 0, 255), -1)
            cv2.putText(frame, "REC", (w - 80, 38),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

    elif state == "done":
        cv2.rectangle(frame, (0, h - 80), (w, h), (20, 20, 20), -1)
        cv2.putText(frame, f"DONE! {total} samples saved. Press any key for next gesture.",
                    (15, h - 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 100), 2)

    elif state == "skip":
        cv2.rectangle(frame, (0, h - 80), (w, h), (20, 20, 20), -1)
        cv2.putText(frame, "SKIPPED. Press any key to continue.",
                    (15, h - 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (100, 100, 255), 2)


def collect_gesture(cap, tracker, extractor, gesture_id: int) -> list:
    """
    Collect SAMPLES_PER_GESTURE feature vectors for one gesture.
    Returns list of numpy vectors, or empty list if skipped.
    """
    samples = []
    gesture = GESTURES[gesture_id]
    print(f"\n--- Gesture {gesture_id}: {gesture['name']} ---")
    print(f"    {gesture['instruction']}")

    # --- PREP countdown ---
    prep_start = time.time()
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        tracker.process_frame(frame)  # keep skeleton visible during prep
        remaining = max(0, PREP_SECONDS - int(time.time() - prep_start))
        draw_ui(frame, "prep", gesture_id, 0, SAMPLES_PER_GESTURE, remaining)
        cv2.imshow("KineticLab — Data Collection", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("s"):  # skip this gesture
            print("    Skipped.")
            return []
        if time.time() - prep_start >= PREP_SECONDS:
            break

    # --- RECORDING ---
    print(f"    Recording {SAMPLES_PER_GESTURE} samples...")
    while len(samples) < SAMPLES_PER_GESTURE:
        ret, frame = cap.read()
        if not ret:
            break

        msg = tracker.process_frame(frame)
        features = extractor.extract(msg)

        if features is not None:
            vec = extractor.to_vector(features)
            # Only record if pose is detected (not all zeros)
            if np.any(vec != 0):
                samples.append(vec)

        draw_ui(frame, "recording", gesture_id, len(samples), SAMPLES_PER_GESTURE)
        cv2.imshow("KineticLab — Data Collection", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            print("    Aborted.")
            return samples  # return what we have

    print(f"    ✓ Collected {len(samples)} samples")

    # --- DONE confirmation ---
    done_start = time.time()
    while time.time() - done_start < 2.0:
        ret, frame = cap.read()
        if not ret:
            break
        tracker.process_frame(frame)
        draw_ui(frame, "done", gesture_id, len(samples), SAMPLES_PER_GESTURE)
        cv2.imshow("KineticLab — Data Collection", frame)
        if cv2.waitKey(1) & 0xFF != 255:
            break

    return samples


def save_samples(all_vectors: list, all_labels: list, user: str):
    """Append new samples to gesture_data.npy."""
    X = np.array(all_vectors)
    y = np.array(all_labels)
    new_data = np.column_stack([X, y])

    if DATA_PATH.exists():
        existing = np.load(DATA_PATH)
        combined = np.vstack([existing, new_data])
        print(f"\nAppended to existing data: {len(existing)} → {len(combined)} total rows")
    else:
        combined = new_data
        print(f"\nCreated new data file: {len(combined)} rows")

    np.save(DATA_PATH, combined)
    print(f"Saved to {DATA_PATH}")

    # Print class balance
    labels = combined[:, -1].astype(int)
    print("Class distribution:")
    for g_id, g_info in GESTURES.items():
        count = np.sum(labels == g_id)
        print(f"  {g_id} ({g_info['name']}): {count} samples")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", default="user", help="Participant name (for logging)")
    parser.add_argument("--camera", type=int, default=0, help="Camera index")
    parser.add_argument("--gestures", nargs="+", type=int,
                        default=list(GESTURES.keys()),
                        help="Which gesture IDs to collect (default: all)")
    args = parser.parse_args()

    print(f"\nKineticLab Data Collection — User: {args.user}")
    print("Controls: [s] skip gesture  [q] abort recording  [q in window] quit")
    print(f"Collecting {SAMPLES_PER_GESTURE} samples for gestures: {args.gestures}\n")

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open camera {args.camera}")

    tracker = LandmarkTracker(draw_landmarks=True)
    extractor = FeatureExtractor()

    all_vectors = []
    all_labels = []

    try:
        for gesture_id in args.gestures:
            extractor.reset_history()  # clear velocity history between gestures
            samples = collect_gesture(cap, tracker, extractor, gesture_id)
            for vec in samples:
                all_vectors.append(vec)
                all_labels.append(gesture_id)

        if all_vectors:
            save_samples(all_vectors, all_labels, args.user)
        else:
            print("No samples collected.")

    finally:
        tracker.release()
        cap.release()
        cv2.destroyAllWindows()

    print(f"\nDone! Run each teammate with --user <name>, then train with:")
    print("    python3 gesture_classifier.py")


if __name__ == "__main__":
    main()
