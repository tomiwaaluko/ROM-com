"""
rom_calibration.py — Adaptive ROM normalization (THE DEMO CENTERPIECE)
Owner: Andrea

Three-step calibration:
  1. Baseline capture (~30 seconds): guide user through max-comfort movements,
     record min/max per joint angle feature.
  2. Normalize: store profile {feature: (min, max)}. All future readings →
     (current - user_min) / (user_max - user_min), clamped to [0, 1].
  3. Adaptive thresholds: exercise targets fire at % of personal max.
     Hysteresis (activate 70%, deactivate 50%) prevents flicker.
     EMA filter smooths joint positions.
     Rolling 60-sec variance auto-lowers thresholds on fatigue detection.

This is what makes a patient with 45° max shoulder flexion and a healthy user
at 180° both map to [0.0, 1.0] and complete the same exercise.
"""

import time
import json
import numpy as np
from collections import deque
from typing import Optional
from pathlib import Path


# EMA smoothing factor — higher = more responsive, lower = smoother
EMA_ALPHA = 0.2

# Hysteresis thresholds — prevents target flickering on the boundary
ACTIVATE_THRESHOLD = 0.70    # normalized value must reach 70% to trigger
DEACTIVATE_THRESHOLD = 0.50  # must drop below 50% to un-trigger

# Fatigue detection: if rolling 60s variance drops below this, lower thresholds
FATIGUE_VARIANCE_FLOOR = 0.005
FATIGUE_THRESHOLD_REDUCTION = 0.10  # reduce activate/deactivate by 10%

# Calibration duration
CALIBRATION_DURATION_SEC = 30


class ROMProfile:
    """
    Stores per-user per-joint (min, max) from calibration.
    Serializable to JSON for user-switch auto-recalibrate and pre-load fallback.
    """

    def __init__(self):
        # {feature_name: [min_val, max_val]}
        self.ranges: dict[str, list[float]] = {}
        self.user_id: Optional[str] = None
        self.calibrated_at: Optional[float] = None

    def update(self, feature_name: str, value: float):
        """Expand the recorded range with a new observation during calibration."""
        if feature_name not in self.ranges:
            self.ranges[feature_name] = [value, value]
        else:
            self.ranges[feature_name][0] = min(self.ranges[feature_name][0], value)
            self.ranges[feature_name][1] = max(self.ranges[feature_name][1], value)

    def normalize(self, feature_name: str, value: float) -> float:
        """
        Map raw value to [0, 1] based on user's personal range.
        Returns 0.5 if feature not calibrated (safe default — won't trigger targets).
        """
        if feature_name not in self.ranges:
            return 0.5
        lo, hi = self.ranges[feature_name]
        span = hi - lo
        if span < 1e-6:
            # No range detected — feature didn't move during calibration
            return 0.5
        return float(np.clip((value - lo) / span, 0.0, 1.0))

    def save(self, path: str):
        """Persist profile to JSON for user-switch auto-recalibrate."""
        data = {
            "user_id": self.user_id,
            "calibrated_at": self.calibrated_at,
            "ranges": self.ranges,
        }
        Path(path).write_text(json.dumps(data, indent=2))

    @classmethod
    def load(cls, path: str) -> "ROMProfile":
        """Load a saved profile — used for pre-load fallback in demo contingency."""
        data = json.loads(Path(path).read_text())
        profile = cls()
        profile.user_id = data.get("user_id")
        profile.calibrated_at = data.get("calibrated_at")
        profile.ranges = data.get("ranges", {})
        return profile

    def is_valid(self) -> bool:
        """True if calibration produced at least some usable ranges."""
        return any(
            (hi - lo) > 1e-6 for lo, hi in self.ranges.values()
        )


class ROMCalibrator:
    """
    Runs the 30-second baseline capture and builds a ROMProfile.
    Feed frames via update() while showing calibration UI; call finish() when done.
    """

    def __init__(self):
        self._collecting = False
        self._start_time: Optional[float] = None
        self._profile = ROMProfile()

    def start(self, user_id: str = "user"):
        """Begin calibration — call this when the guided calibration UI starts."""
        self._profile = ROMProfile()
        self._profile.user_id = user_id
        self._collecting = True
        self._start_time = time.time()

    def update(self, features: dict) -> float:
        """
        Feed extracted features during calibration window.
        Returns progress as 0.0–1.0 for the progress bar UI.
        """
        if not self._collecting:
            return 1.0

        elapsed = time.time() - self._start_time
        progress = min(elapsed / CALIBRATION_DURATION_SEC, 1.0)

        for name, value in features.items():
            if isinstance(value, (int, float)) and value >= 0:
                self._profile.update(name, value)

        if progress >= 1.0:
            self.finish()

        return progress

    def finish(self) -> ROMProfile:
        """Stop calibration and return the completed profile."""
        self._collecting = False
        self._profile.calibrated_at = time.time()
        return self._profile

    @property
    def profile(self) -> ROMProfile:
        return self._profile

    @property
    def is_running(self) -> bool:
        return self._collecting


class ROMNormalizer:
    """
    Real-time normalizer + adaptive threshold engine.
    Uses a calibrated ROMProfile to normalize features and decide if exercise
    targets should fire.

    Features:
      - EMA smoothing on raw feature values
      - Hysteresis (activate/deactivate thresholds) to prevent flickering
      - Rolling 60s variance → fatigue detection → threshold auto-reduction
    """

    def __init__(self, profile: ROMProfile):
        self.profile = profile

        # EMA state: {feature_name: smoothed_value}
        self._ema: dict[str, float] = {}

        # Hysteresis state: {feature_name: bool} — is this feature currently "active"?
        self._active: dict[str, bool] = {}

        # Rolling window for fatigue detection (~60 sec at 30fps = 1800 samples)
        self._window_size = 1800
        self._history: dict[str, deque] = {}

        # Current effective thresholds (may be lowered by fatigue detection)
        self._activate_thresh = ACTIVATE_THRESHOLD
        self._deactivate_thresh = DEACTIVATE_THRESHOLD

    def process(self, features: dict) -> dict:
        """
        Normalize a feature dict and return per-feature activation state.

        Returns:
          {
            "normalized": {feature: float [0,1]},
            "active": {feature: bool},
            "fatigue_detected": bool,
            "effective_activate_thresh": float,
          }
        """
        normalized = {}
        active = {}

        for name, raw in features.items():
            if not isinstance(raw, (int, float)) or raw < 0:
                continue

            # 1. EMA smoothing — reduces jitter without adding much latency
            prev_ema = self._ema.get(name, raw)
            smoothed = EMA_ALPHA * raw + (1 - EMA_ALPHA) * prev_ema
            self._ema[name] = smoothed

            # 2. Normalize to user's personal range
            norm = self.profile.normalize(name, smoothed)
            normalized[name] = norm

            # 3. Hysteresis — avoid flickering when hovering at threshold
            was_active = self._active.get(name, False)
            if was_active:
                # Already active: only deactivate if drops below lower threshold
                is_active = norm >= self._deactivate_thresh
            else:
                # Not active: only activate if reaches upper threshold
                is_active = norm >= self._activate_thresh
            self._active[name] = is_active
            active[name] = is_active

            # 4. Update rolling history for fatigue detection
            if name not in self._history:
                self._history[name] = deque(maxlen=self._window_size)
            self._history[name].append(norm)

        # 5. Fatigue detection: if variance across all features drops, lower thresholds
        fatigue_detected = self._check_fatigue()
        if fatigue_detected:
            self._activate_thresh = max(
                0.3, ACTIVATE_THRESHOLD - FATIGUE_THRESHOLD_REDUCTION
            )
            self._deactivate_thresh = max(
                0.2, DEACTIVATE_THRESHOLD - FATIGUE_THRESHOLD_REDUCTION
            )
        else:
            # Restore default thresholds when fatigue clears
            self._activate_thresh = ACTIVATE_THRESHOLD
            self._deactivate_thresh = DEACTIVATE_THRESHOLD

        return {
            "normalized": normalized,
            "active": active,
            "fatigue_detected": fatigue_detected,
            "effective_activate_thresh": self._activate_thresh,
        }

    def _check_fatigue(self) -> bool:
        """
        Returns True if the rolling variance of normalized values is below the
        fatigue floor — indicates patient is no longer achieving their full range.
        Only evaluated once we have a full rolling window.
        """
        variances = []
        for name, window in self._history.items():
            if len(window) >= self._window_size:
                variances.append(float(np.var(list(window))))
        if not variances:
            return False
        return float(np.mean(variances)) < FATIGUE_VARIANCE_FLOOR

    def reset(self):
        """Call on user switch — clears all state so thresholds are clean."""
        self._ema.clear()
        self._active.clear()
        self._history.clear()
        self._activate_thresh = ACTIVATE_THRESHOLD
        self._deactivate_thresh = DEACTIVATE_THRESHOLD


def quick_calibration_test():
    """
    CLI smoke test for calibration flow.
    Simulates 30s of random feature data and prints the resulting profile.
    """
    from feature_extractor import FeatureExtractor

    calibrator = ROMCalibrator()
    calibrator.start(user_id="test_user")

    # Simulate feature stream
    rng = np.random.default_rng(42)
    dummy_features = {
        "shoulder_flexion_r": 0.0,
        "elbow_extension_r": 0.0,
        "wrist_flexion_r": 0.0,
    }

    print("Simulating 30s calibration...")
    sim_start = time.time()
    while calibrator.is_running:
        # Simulate varying angles
        dummy_features = {
            k: rng.uniform(20, 160) for k in dummy_features
        }
        progress = calibrator.update(dummy_features)
        if int(progress * 10) % 2 == 0:
            print(f"  Progress: {progress*100:.0f}%", end="\r")
        time.sleep(0.033)  # ~30fps

    profile = calibrator.profile
    print(f"\nCalibration complete. Profile valid: {profile.is_valid()}")
    for feat, (lo, hi) in profile.ranges.items():
        print(f"  {feat}: [{lo:.1f}°, {hi:.1f}°]")


if __name__ == "__main__":
    quick_calibration_test()
