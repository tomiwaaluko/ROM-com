"""
test_progression.py — Manual simulation test for ProgressionManager.

Exercises all three code paths (advance, regress, hold) without a camera,
verifies JSON persistence, and verifies threshold reload on restart.
"""

import json
import sys
import shutil
from pathlib import Path

# ---------------------------------------------------------------------------
# Minimal stubs — avoid importing mediapipe / cv2 / requests
# ---------------------------------------------------------------------------

# Patch heavy imports before rom_calibration loads
import unittest.mock as mock
sys.modules.setdefault("numpy", __import__("numpy"))  # numpy is fine
sys.modules["mediapipe_tracker"] = mock.MagicMock()
sys.modules["feature_extractor"] = mock.MagicMock()
sys.modules["gesture_classifier"] = mock.MagicMock()
sys.modules["fma_scoring"] = mock.MagicMock()
sys.modules["cv2"] = mock.MagicMock()
sys.modules["requests"] = mock.MagicMock()

from rom_calibration import (  # noqa: E402
    ROMProfile, ROMNormalizer, ProgressionManager,
    ACTIVATE_THRESHOLD, DEACTIVATE_THRESHOLD,
)

TEST_USER = "test_progression_user"
TEST_DIR = Path("rom_profiles")

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
failures = []


def check(label: str, condition: bool, detail: str = ""):
    mark = PASS if condition else FAIL
    print(f"  [{mark}] {label}" + (f"  ({detail})" if detail else ""))
    if not condition:
        failures.append(label)


def make_normalizer(activate=ACTIVATE_THRESHOLD, deactivate=DEACTIVATE_THRESHOLD):
    profile = ROMProfile()
    profile.user_id = TEST_USER
    n = ROMNormalizer(profile)
    n._activate_thresh = activate
    n._deactivate_thresh = deactivate
    return n


def cleanup():
    for f in TEST_DIR.glob(f"{TEST_USER}_progression.json"):
        f.unlink()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def simulate_session(pm: ProgressionManager, hits: int, misses: int) -> dict:
    """Feed hits and misses into the manager and end the session."""
    for _ in range(hits):
        pm.record_attempt(True)
    for _ in range(misses):
        pm.record_attempt(False)
    return pm.end_session()


# ===========================================================================
# Test 1 — HOLD: single session at 65% (between 50% and 80%)
# ===========================================================================
print("\n=== Test 1: HOLD (single session, 65% success rate) ===")
cleanup()
norm = make_normalizer()
pm = ProgressionManager(norm, user_id=TEST_USER)

result = simulate_session(pm, hits=13, misses=7)  # 13/20 = 65%
print(f"  success_rate={result['success_rate']:.1%}  action={result['action']}")
print(f"  activate={result['new_activate']:.4f}  deactivate={result['new_deactivate']:.4f}")

check("action == hold", result["action"] == "hold", f"got {result['action']}")
check("activate unchanged", abs(result["new_activate"] - ACTIVATE_THRESHOLD) < 1e-9,
      f"{result['new_activate']:.4f} vs {ACTIVATE_THRESHOLD:.4f}")
check("deactivate unchanged", abs(result["new_deactivate"] - DEACTIVATE_THRESHOLD) < 1e-9,
      f"{result['new_deactivate']:.4f} vs {DEACTIVATE_THRESHOLD:.4f}")


# ===========================================================================
# Test 2 — ADVANCE: two consecutive sessions >= 80%
# ===========================================================================
print("\n=== Test 2: ADVANCE (2× consecutive sessions >= 80%) ===")
cleanup()
norm = make_normalizer()
pm = ProgressionManager(norm, user_id=TEST_USER)

# Session 1: 90% (should hold — only 1 consecutive)
r1 = simulate_session(pm, hits=9, misses=1)
print(f"  Session 1: success_rate={r1['success_rate']:.1%}  action={r1['action']}")
check("session 1 action == hold (1 of 2 needed)", r1["action"] == "hold",
      f"got {r1['action']}")

# Session 2: 85% (now 2 consecutive >= 80% → advance)
r2 = simulate_session(pm, hits=17, misses=3)
print(f"  Session 2: success_rate={r2['success_rate']:.1%}  action={r2['action']}")
print(f"  new_activate={r2['new_activate']:.4f}  new_deactivate={r2['new_deactivate']:.4f}")

expected_activate = min(ACTIVATE_THRESHOLD + 0.05, 0.90)
expected_deactivate = min(DEACTIVATE_THRESHOLD + 0.05, 0.75)
check("session 2 action == advance", r2["action"] == "advance", f"got {r2['action']}")
check("activate += 0.05", abs(r2["new_activate"] - expected_activate) < 1e-9,
      f"{r2['new_activate']:.4f} vs {expected_activate:.4f}")
check("deactivate += 0.05", abs(r2["new_deactivate"] - expected_deactivate) < 1e-9,
      f"{r2['new_deactivate']:.4f} vs {expected_deactivate:.4f}")


# ===========================================================================
# Test 3 — REGRESS: session < 50%
# ===========================================================================
print("\n=== Test 3: REGRESS (single session < 50%) ===")
cleanup()
norm = make_normalizer()
pm = ProgressionManager(norm, user_id=TEST_USER)

r = simulate_session(pm, hits=4, misses=10)  # 4/14 = 28.6%
print(f"  success_rate={r['success_rate']:.1%}  action={r['action']}")
print(f"  new_activate={r['new_activate']:.4f}  new_deactivate={r['new_deactivate']:.4f}")

expected_activate = max(ACTIVATE_THRESHOLD - 0.05, 0.50)
expected_deactivate = max(DEACTIVATE_THRESHOLD - 0.05, 0.30)
check("action == regress", r["action"] == "regress", f"got {r['action']}")
check("activate -= 0.05", abs(r["new_activate"] - expected_activate) < 1e-9,
      f"{r['new_activate']:.4f} vs {expected_activate:.4f}")
check("deactivate -= 0.05", abs(r["new_deactivate"] - expected_deactivate) < 1e-9,
      f"{r['new_deactivate']:.4f} vs {expected_deactivate:.4f}")


# ===========================================================================
# Test 4 — CAP: advance can't push activate above 0.90
# ===========================================================================
print("\n=== Test 4: CAP — activate cannot exceed 0.90 ===")
cleanup()
norm = make_normalizer(activate=0.88, deactivate=0.72)
pm = ProgressionManager(norm, user_id=TEST_USER)

# Two consecutive 100% sessions → tries to add 0.05 to 0.88 (→ 0.93, capped to 0.90)
simulate_session(pm, hits=10, misses=0)
r = simulate_session(pm, hits=10, misses=0)
print(f"  new_activate={r['new_activate']:.4f}  new_deactivate={r['new_deactivate']:.4f}")
check("activate capped at 0.90", abs(r["new_activate"] - 0.90) < 1e-9,
      f"got {r['new_activate']:.4f}")
check("deactivate capped at 0.75", r["new_deactivate"] <= 0.75,
      f"got {r['new_deactivate']:.4f}")


# ===========================================================================
# Test 5 — FLOOR: regress can't push activate below 0.50
# ===========================================================================
print("\n=== Test 5: FLOOR — activate cannot go below 0.50 ===")
cleanup()
norm = make_normalizer(activate=0.52, deactivate=0.32)
pm = ProgressionManager(norm, user_id=TEST_USER)

r = simulate_session(pm, hits=1, misses=10)  # well below 50%
print(f"  new_activate={r['new_activate']:.4f}  new_deactivate={r['new_deactivate']:.4f}")
check("activate floored at 0.50", r["new_activate"] >= 0.50,
      f"got {r['new_activate']:.4f}")
check("deactivate floored at 0.30", r["new_deactivate"] >= 0.30,
      f"got {r['new_deactivate']:.4f}")


# ===========================================================================
# Test 6 — PERSISTENCE: JSON written after end_session()
# ===========================================================================
print("\n=== Test 6: PERSISTENCE — JSON saved correctly ===")
cleanup()
norm = make_normalizer()
pm = ProgressionManager(norm, user_id=TEST_USER)
simulate_session(pm, hits=9, misses=1)   # session 1 @ 90%
simulate_session(pm, hits=18, misses=2)  # session 2 @ 90% → advance

prog_path = TEST_DIR / f"{TEST_USER}_progression.json"
check("JSON file created", prog_path.exists(), str(prog_path))

if prog_path.exists():
    data = json.loads(prog_path.read_text())
    print(f"  JSON contents: {json.dumps(data, indent=4)}")
    check("JSON has activate_thresh", "activate_thresh" in data)
    check("JSON has deactivate_thresh", "deactivate_thresh" in data)
    check("JSON has session_history", "session_history" in data)
    check("session_history length == 2", len(data["session_history"]) == 2,
          f"len={len(data['session_history'])}")
    check("activate_thresh advanced", data["activate_thresh"] > ACTIVATE_THRESHOLD,
          f"{data['activate_thresh']:.4f} vs {ACTIVATE_THRESHOLD:.4f}")


# ===========================================================================
# Test 7 — RELOAD: thresholds restored from JSON on new ProgressionManager
# ===========================================================================
print("\n=== Test 7: RELOAD — thresholds survive app restart ===")
# Reuse the JSON written by Test 6 — create a fresh normalizer at defaults
norm2 = make_normalizer()  # starts at defaults
pm2 = ProgressionManager(norm2, user_id=TEST_USER)  # loads JSON in __init__

loaded_activate, loaded_deactivate = pm2.get_thresholds()
print(f"  Loaded: activate={loaded_activate:.4f}  deactivate={loaded_deactivate:.4f}")
print(f"  Expected (advanced): activate={ACTIVATE_THRESHOLD + 0.05:.4f}")
check("activate loaded from JSON (not default)",
      abs(loaded_activate - (ACTIVATE_THRESHOLD + 0.05)) < 1e-9,
      f"got {loaded_activate:.4f}")
check("deactivate loaded from JSON (not default)",
      abs(loaded_deactivate - (DEACTIVATE_THRESHOLD + 0.05)) < 1e-9,
      f"got {loaded_deactivate:.4f}")


# ===========================================================================
# Test 8 — ZERO ATTEMPTS: end_session with no recorded attempts
# ===========================================================================
print("\n=== Test 8: ZERO ATTEMPTS — no division by zero ===")
cleanup()
norm = make_normalizer()
pm = ProgressionManager(norm, user_id=TEST_USER)
r = pm.end_session()
print(f"  success_rate={r['success_rate']:.1%}  action={r['action']}")
check("success_rate == 0.0", r["success_rate"] == 0.0, f"got {r['success_rate']}")
check("action == regress (0% < 50%)", r["action"] == "regress", f"got {r['action']}")


# ===========================================================================
# Test 9 — EXACTLY 50%: boundary — should HOLD not regress
# ===========================================================================
print("\n=== Test 9: BOUNDARY — exactly 50% → hold ===")
cleanup()
norm = make_normalizer()
pm = ProgressionManager(norm, user_id=TEST_USER)
r = simulate_session(pm, hits=5, misses=5)  # exactly 50%
print(f"  success_rate={r['success_rate']:.1%}  action={r['action']}")
check("action == hold at exactly 50%", r["action"] == "hold", f"got {r['action']}")


# ===========================================================================
# Test 10 — reset() preserves history
# ===========================================================================
print("\n=== Test 10: reset() preserves session history ===")
cleanup()
norm = make_normalizer()
pm = ProgressionManager(norm, user_id=TEST_USER)
# Session 1: 80% → 1 consecutive, should hold
r1 = simulate_session(pm, hits=8, misses=2)
check("session 1 holds (1 of 2 consecutive)", r1["action"] == "hold",
      f"got {r1['action']}")

# Simulate partial attempts mid-session then manual reset
pm.record_attempt(True)
pm.record_attempt(False)
pm.reset()  # clears counters only — history entry from session 1 must survive

# Session 2: 90% — if history was wiped, only 1 consecutive entry → hold.
# If history is preserved, 2 consecutive entries (0.8, 0.9) → advance.
r2 = simulate_session(pm, hits=9, misses=1)
check("history preserved across reset — 2 consecutive fires advance",
      r2["action"] == "advance", f"got {r2['action']}")


# ===========================================================================
# Summary
# ===========================================================================
cleanup()
print(f"\n{'='*55}")
if not failures:
    print(f"  All tests passed.")
else:
    print(f"  {len(failures)} failure(s):")
    for f in failures:
        print(f"    - {f}")
print(f"{'='*55}\n")
sys.exit(0 if not failures else 1)
