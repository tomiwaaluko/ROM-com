"""
gesture_classifier.py — Random Forest gesture classifier
Owner: Andrea

Trains on per-user collected samples (joint angle features) and classifies
gestures in real time. Target: ≥90% accuracy.

Gestures (labels):
  0 = neutral / rest
  1 = target_reach     (shoulder flexion dominant — FMA-UE domain A)
  2 = trajectory_trace  (wrist flexion dominant — FMA-UE domain C)
  3 = forearm_rotation  (pronation/supination — FMA-UE domain B)
  4 = bimanual_reach    (bilateral — FMA-UE domain E)
"""

import json
import numpy as np
import pickle
from pathlib import Path
from typing import Optional

from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import SVC
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report, confusion_matrix

from feature_extractor import FeatureExtractor

# Gesture label map — keep in sync with frontend exercise IDs
GESTURE_LABELS = {
    0: "neutral",
    1: "target_reach",
    2: "trajectory_trace",
    3: "forearm_rotation",
    4: "bimanual_reach",
}

MODEL_PATH = Path("gesture_classifier.pkl")
DATA_PATH = Path("gesture_data.npy")   # shape: (N, features+1) last col = label
FEATURE_KEYS = [
    "shoulder_flexion_r", "shoulder_flexion_l",
    "shoulder_abduction_r", "shoulder_abduction_l",
    "elbow_extension_r", "elbow_extension_l",
    "wrist_flexion_r", "wrist_flexion_l",
    "forearm_pronation_r", "forearm_pronation_l",
    "wrist_velocity_r", "wrist_velocity_l",
    "shoulder_velocity_r", "shoulder_velocity_l",
    "tremor_variance_r", "tremor_variance_l",
]


class GestureClassifier:
    """
    Wraps a trained sklearn Pipeline (RF or SVM fallback).
    Load from disk for inference; train fresh for new data.
    """

    def __init__(self):
        self.pipeline: Optional[Pipeline] = None
        self.accuracy: float = 0.0
        self._extractor = FeatureExtractor()

    # --- Training ---

    def train(self, X: np.ndarray, y: np.ndarray) -> float:
        """
        Train on feature matrix X (N, 16) and labels y (N,).
        Returns cross-validated accuracy.
        Falls back to SVM if RF < 90%.
        """
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

        # Try Random Forest first
        rf_pipe = Pipeline([
            ("scaler", StandardScaler()),
            ("clf", RandomForestClassifier(
                n_estimators=200,
                max_depth=None,
                min_samples_split=2,
                random_state=42,
                n_jobs=-1,
            )),
        ])
        rf_scores = cross_val_score(rf_pipe, X, y, cv=cv, scoring="accuracy")
        rf_acc = float(rf_scores.mean())
        print(f"RF cross-val accuracy: {rf_acc:.3f} ± {rf_scores.std():.3f}")

        if rf_acc >= 0.90:
            # RF meets the bar — use it
            rf_pipe.fit(X, y)
            self.pipeline = rf_pipe
            self.accuracy = rf_acc
            print("✓ Using Random Forest (≥90% accuracy)")
        else:
            # RF underperforms — try SVM (RBF kernel usually fixes boundary issues)
            print(f"RF below 90% — trying SVM fallback...")
            svm_pipe = Pipeline([
                ("scaler", StandardScaler()),
                ("clf", SVC(kernel="rbf", C=10, gamma="scale", probability=True)),
            ])
            svm_scores = cross_val_score(svm_pipe, X, y, cv=cv, scoring="accuracy")
            svm_acc = float(svm_scores.mean())
            print(f"SVM cross-val accuracy: {svm_acc:.3f} ± {svm_scores.std():.3f}")

            best_pipe = svm_pipe if svm_acc >= rf_acc else rf_pipe
            best_acc = max(rf_acc, svm_acc)
            best_pipe.fit(X, y)
            self.pipeline = best_pipe
            self.accuracy = best_acc

            if best_acc < 0.90:
                print(f"⚠ Best accuracy {best_acc:.3f} is below 90% target — collect more data")

        # Full report on training set for debug
        y_pred = self.pipeline.predict(X)
        print("\nClassification report (train set):")
        print(classification_report(y, y_pred, target_names=list(GESTURE_LABELS.values())))

        return self.accuracy

    def save(self, path: Path = MODEL_PATH):
        """Persist trained model to disk."""
        if self.pipeline is None:
            raise RuntimeError("No trained model to save.")
        with open(path, "wb") as f:
            pickle.dump({"pipeline": self.pipeline, "accuracy": self.accuracy}, f)
        print(f"Model saved → {path}")

    @classmethod
    def load(cls, path: Path = MODEL_PATH) -> "GestureClassifier":
        """Load trained model from disk for inference."""
        with open(path, "rb") as f:
            data = pickle.load(f)
        gc = cls()
        gc.pipeline = data["pipeline"]
        gc.accuracy = data["accuracy"]
        return gc

    # --- Inference ---

    def predict(self, features: dict) -> dict:
        """
        Classify a single feature dict (from FeatureExtractor).
        Returns prediction dict with label, confidence, and all class probabilities.
        """
        if self.pipeline is None:
            raise RuntimeError("Model not trained or loaded.")

        vec = self._extractor.to_vector(features).reshape(1, -1)

        label_idx = int(self.pipeline.predict(vec)[0])
        label_name = GESTURE_LABELS.get(label_idx, "unknown")

        # Get probability scores if available (RF + SVM with probability=True)
        try:
            probs = self.pipeline.predict_proba(vec)[0]
            confidence = float(probs[label_idx])
            all_probs = {GESTURE_LABELS[i]: float(p) for i, p in enumerate(probs)}
        except AttributeError:
            confidence = 1.0
            all_probs = {label_name: 1.0}

        return {
            "gesture": label_name,
            "label_idx": label_idx,
            "confidence": confidence,
            "probabilities": all_probs,
        }


# --- Data collection helpers ---

class DataCollector:
    """
    Records labeled feature samples for training.
    Usage: run collect_samples() at event start with each teammate.
    """

    def __init__(self):
        self._samples: list[tuple[np.ndarray, int]] = []
        self._extractor = FeatureExtractor()

    def record(self, features: dict, label: int):
        """Add a labeled sample."""
        vec = self._extractor.to_vector(features)
        self._samples.append((vec, label))

    def get_arrays(self) -> tuple[np.ndarray, np.ndarray]:
        """Return (X, y) arrays ready for training."""
        X = np.array([s[0] for s in self._samples])
        y = np.array([s[1] for s in self._samples])
        return X, y

    def save(self, path: Path = DATA_PATH):
        X, y = self.get_arrays()
        combined = np.column_stack([X, y])
        np.save(path, combined)
        print(f"Saved {len(self._samples)} samples → {path}")

    @classmethod
    def load_arrays(cls, path: Path = DATA_PATH) -> tuple[np.ndarray, np.ndarray]:
        combined = np.load(path)
        X = combined[:, :-1]
        y = combined[:, -1].astype(int)
        return X, y

    @property
    def sample_count(self) -> int:
        return len(self._samples)


def train_from_file(data_path: Path = DATA_PATH, model_path: Path = MODEL_PATH):
    """Convenience: load data from disk, train, and save model."""
    X, y = DataCollector.load_arrays(data_path)
    print(f"Loaded {len(X)} samples, {len(np.unique(y))} classes")
    gc = GestureClassifier()
    acc = gc.train(X, y)
    gc.save(model_path)
    return gc, acc


if __name__ == "__main__":
    # If data file exists, train immediately
    if DATA_PATH.exists():
        print(f"Training from {DATA_PATH}...")
        gc, acc = train_from_file()
        print(f"\nFinal accuracy: {acc:.1%}")
    else:
        print(f"No data file found at {DATA_PATH}.")
        print("Run data collection first, then re-run this script.")
