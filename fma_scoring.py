"""
fma_scoring.py — Automated FMA-UE subscale scoring module
Owner: Andrea (H24+ only — do not build until model is frozen at H30)

Scores the visible FMA-UE subscale (~52/66 points) from a completed session.
Vision cannot measure grip force → Hand domain (D, 0-14) is excluded.

Scoring methodology:
  Each item scored 0/1/2 per FMA-UE convention:
    0 = cannot perform
    1 = partial performance
    2 = full performance
  Thresholds derived from ROM-normalized values (0–1 scale).
  Grounded in: Frontiers in Neuroscience 2024 (r=0.99), Brain Sciences 2022
  (r=0.981), Zamin et al. BIONICS 2023 (78-83% item-wise accuracy).

  ⚠ IMPORTANT: Frame this as research-grade subscale proxy, NOT FDA-validated.
    Never call it a diagnostic tool. Cite methodology on Devpost.

Domain coverage:
  A. Shoulder/elbow/forearm  0–36 pts  (Target Reach exercise)
  C. Wrist                   0–10 pts  (Trajectory Trace exercise)
  E. Coordination/speed      0–6  pts  (Mirror Therapy / Bimanual)
  ── Total subscale ────────  0–52 pts
  D. Hand/grip               EXCLUDED  (vision cannot measure grip force)
"""

from dataclasses import dataclass, field, asdict
from typing import Optional
import numpy as np


# FMA-UE severity bands (for report output — Appendix A reference)
SEVERITY_BANDS = [
    (0, 19, "severe"),
    (20, 47, "moderate"),
    (48, 52, "mild"),        # adjusted for our 52-pt subscale ceiling
]

# Minimum clinically important difference (MCID) — chronic mild-moderate
MCID_LOWER = 4.25
MCID_UPPER = 7.25


@dataclass
class FMAItemScore:
    """Single FMA-UE item result."""
    item_id: str          # e.g. "A_I"
    domain: str           # "A", "C", or "E"
    description: str
    score: int            # 0, 1, or 2
    max_score: int = 2
    normalized_value: Optional[float] = None  # the ROM-normalized input that drove scoring


@dataclass
class FMASessionScore:
    """
    Complete FMA-UE subscale score for one session.
    Serializable to JSON for the therapist dashboard.
    """
    user_id: str
    session_id: str
    timestamp: float

    # Per-item results
    domain_a_items: list[FMAItemScore] = field(default_factory=list)
    domain_c_items: list[FMAItemScore] = field(default_factory=list)
    domain_e_items: list[FMAItemScore] = field(default_factory=list)

    # Computed totals
    domain_a_score: int = 0   # 0–36
    domain_c_score: int = 0   # 0–10
    domain_e_score: int = 0   # 0–6
    total_score: int = 0      # 0–52

    severity: str = ""
    notes: str = ""

    def compute_totals(self):
        """Sum up domain scores and total from item list."""
        self.domain_a_score = sum(i.score for i in self.domain_a_items)
        self.domain_c_score = sum(i.score for i in self.domain_c_items)
        self.domain_e_score = sum(i.score for i in self.domain_e_items)
        self.total_score = self.domain_a_score + self.domain_c_score + self.domain_e_score
        self.severity = self._classify_severity()

    def _classify_severity(self) -> str:
        for lo, hi, label in SEVERITY_BANDS:
            if lo <= self.total_score <= hi:
                return label
        return "unknown"

    def to_dict(self) -> dict:
        return asdict(self)

    def summary(self) -> str:
        return (
            f"FMA-UE Subscale Score: {self.total_score}/52  |  "
            f"Severity: {self.severity.upper()}  |  "
            f"A(shoulder/elbow): {self.domain_a_score}/36  "
            f"C(wrist): {self.domain_c_score}/10  "
            f"E(coordination): {self.domain_e_score}/6"
        )


class FMAScorer:
    """
    Converts ROM-normalized session statistics into FMA-UE item scores.

    Expected input: session_stats dict produced at end of exercise session.
    Format (from ROMNormalizer output aggregated over session):
    {
        "shoulder_flexion_r_max": float [0,1],
        "shoulder_abduction_r_max": float [0,1],
        "elbow_extension_r_max": float [0,1],
        "wrist_flexion_r_max": float [0,1],
        "wrist_flexion_r_smoothness": float [0,1],
        "forearm_pronation_r_range": float [0,1],
        "bimanual_timing_score": float [0,1],
        "tremor_variance_r_mean": float [0,1],   (lower = better)
        ...
    }
    """

    def score_session(
        self,
        session_stats: dict,
        user_id: str = "unknown",
        session_id: str = "session_0",
        timestamp: float = 0.0,
    ) -> FMASessionScore:
        """
        Produce a complete FMA-UE subscale score from session statistics.
        """
        result = FMASessionScore(
            user_id=user_id,
            session_id=session_id,
            timestamp=timestamp,
        )

        result.domain_a_items = self._score_domain_a(session_stats)
        result.domain_c_items = self._score_domain_c(session_stats)
        result.domain_e_items = self._score_domain_e(session_stats)
        result.compute_totals()

        result.notes = (
            "Subscale score excludes hand/grip domain (D, 0-14pts) — "
            "vision cannot measure grip force. "
            "Methodology: Frontiers in Neuroscience 2024 (r=0.99 vs clinical raters)."
        )

        return result

    def _fma_item(
        self,
        item_id: str,
        domain: str,
        description: str,
        norm_value: float,
    ) -> FMAItemScore:
        """
        Score a single FMA-UE item on 0/1/2 scale from a normalized [0,1] value.
        Standard thresholds: <0.33 = 0, 0.33-0.66 = 1, >0.66 = 2
        """
        if norm_value >= 0.66:
            score = 2
        elif norm_value >= 0.33:
            score = 1
        else:
            score = 0
        return FMAItemScore(
            item_id=item_id,
            domain=domain,
            description=description,
            score=score,
            normalized_value=norm_value,
        )

    def _score_domain_a(self, stats: dict) -> list[FMAItemScore]:
        """
        Domain A: Upper extremity (shoulder, elbow, forearm) — 0 to 36 pts
        18 items × 2 pts each. We approximate via key movement metrics.
        Items cover reflexes, flexor/extensor synergy, out-of-synergy movement.
        """
        items = []
        sf = stats.get("shoulder_flexion_r_max", 0.0)
        sa = stats.get("shoulder_abduction_r_max", 0.0)
        ee = stats.get("elbow_extension_r_max", 0.0)
        reach = stats.get("reach_accuracy_mean", 0.0)

        # A.I  — Biceps reflex (approximated by any elbow movement)
        items.append(self._fma_item("A_I",  "A", "Biceps reflex activity",          min(ee * 1.5, 1.0)))
        # A.II — Triceps reflex
        items.append(self._fma_item("A_II", "A", "Triceps reflex activity",         min(ee * 1.5, 1.0)))
        # A.III — Flexor synergy: shoulder retraction/elevation
        items.append(self._fma_item("A_III","A", "Flexor synergy: shoulder",        sf))
        # A.IV — Flexor synergy: elbow flexion
        items.append(self._fma_item("A_IV", "A", "Flexor synergy: elbow flexion",   ee))
        # A.V  — Extensor synergy: shoulder adduction/internal rotation
        items.append(self._fma_item("A_V",  "A", "Extensor synergy: shoulder adduction", sa))
        # A.VI — Extensor synergy: elbow extension
        items.append(self._fma_item("A_VI", "A", "Extensor synergy: elbow extension", ee))
        # A.VII through A.XII — mixed/out-of-synergy, approximated by reach accuracy
        for idx, desc in enumerate([
            "Hand to lumbar spine",
            "Shoulder flexion 0-90° (elbow extended)",
            "Pronation/supination (elbow flexed)",
            "Shoulder abduction 0-90°",
            "Shoulder flexion 90-180°",
            "Pronation/supination (elbow extended)",
        ]):
            items.append(self._fma_item(f"A_{idx+7}", "A", desc, reach))
        # A.XIII–A.XVIII — wrist stability and circumduction
        wrist_stab = stats.get("wrist_stability_score", stats.get("wrist_flexion_r_max", 0.0))
        for idx, desc in enumerate([
            "Wrist stability (elbow flexed)",
            "Wrist flexion/extension (elbow flexed)",
            "Wrist stability (elbow extended)",
            "Wrist flexion/extension (elbow extended)",
            "Wrist circumduction",
            "Wrist overall coordination",
        ]):
            items.append(self._fma_item(f"A_{idx+13}", "A", desc, wrist_stab))

        return items

    def _score_domain_c(self, stats: dict) -> list[FMAItemScore]:
        """
        Domain C: Wrist — 0 to 10 pts (5 items × 2 pts)
        Driven by Trajectory Trace exercise metrics.
        """
        wf = stats.get("wrist_flexion_r_max", 0.0)
        smooth = stats.get("wrist_flexion_r_smoothness", 0.0)
        trace = stats.get("trajectory_accuracy_mean", 0.0)
        circ = stats.get("forearm_pronation_r_range", 0.0)

        return [
            self._fma_item("C_I",   "C", "Wrist stability with elbow flexed",    wf),
            self._fma_item("C_II",  "C", "Wrist flexion/extension (elbow flexed)", smooth),
            self._fma_item("C_III", "C", "Wrist stability with elbow extended",   wf * 0.9),
            self._fma_item("C_IV",  "C", "Wrist flexion/extension (elbow extended)", trace),
            self._fma_item("C_V",   "C", "Wrist circumduction",                   circ),
        ]

    def _score_domain_e(self, stats: dict) -> list[FMAItemScore]:
        """
        Domain E: Coordination/speed — 0 to 6 pts (3 items × 2 pts)
        Driven by bimanual timing and tremor metrics.
        """
        tremor = stats.get("tremor_variance_r_mean", 0.5)
        # Lower tremor = better coordination — invert the scale
        coordination = 1.0 - min(tremor * 4, 1.0)
        timing = stats.get("bimanual_timing_score", 0.0)
        speed = stats.get("movement_speed_score", 0.0)

        return [
            self._fma_item("E_I",   "E", "Finger-to-nose tremor",    coordination),
            self._fma_item("E_II",  "E", "Finger-to-nose dysmetria",  timing),
            self._fma_item("E_III", "E", "Speed (finger-to-nose ×5)", speed),
        ]


def demo_score():
    """Quick demo: generate a sample score with placeholder stats."""
    import time
    scorer = FMAScorer()

    # Example stats from a completed session (these would come from exercise logic)
    sample_stats = {
        "shoulder_flexion_r_max": 0.72,
        "shoulder_abduction_r_max": 0.65,
        "elbow_extension_r_max": 0.80,
        "reach_accuracy_mean": 0.68,
        "wrist_flexion_r_max": 0.55,
        "wrist_flexion_r_smoothness": 0.60,
        "trajectory_accuracy_mean": 0.58,
        "forearm_pronation_r_range": 0.45,
        "wrist_stability_score": 0.62,
        "tremor_variance_r_mean": 0.12,
        "bimanual_timing_score": 0.50,
        "movement_speed_score": 0.55,
    }

    result = scorer.score_session(
        sample_stats,
        user_id="demo_patient",
        session_id="session_001",
        timestamp=time.time(),
    )
    print(result.summary())
    print(f"\nSeverity classification: {result.severity}")
    print(f"MCID reference: {MCID_LOWER}–{MCID_UPPER} pts (chronic, mild-moderate)")
    print(f"\nDomain A items ({result.domain_a_score}/36):")
    for item in result.domain_a_items:
        print(f"  {item.item_id}: {item.score}/2  — {item.description}")
    print(f"\nDomain C items ({result.domain_c_score}/10):")
    for item in result.domain_c_items:
        print(f"  {item.item_id}: {item.score}/2  — {item.description}")
    print(f"\nDomain E items ({result.domain_e_score}/6):")
    for item in result.domain_e_items:
        print(f"  {item.item_id}: {item.score}/2  — {item.description}")


if __name__ == "__main__":
    demo_score()
