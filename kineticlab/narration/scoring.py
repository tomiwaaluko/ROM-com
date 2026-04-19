"""Score branching logic for end-of-session avatar narration.

Three outcome branches:
- score_asymmetric: affected-vs-unaffected delta > 25 (clinically meaningful side difference)
- score_high: overall rom_score >= 70 (strong session)
- score_low: default (encouragement-focused)
"""
from __future__ import annotations


ASYMMETRY_THRESHOLD = 25.0
HIGH_SCORE_THRESHOLD = 70.0


def select_score_key(
    rom_score: float,
    affected_side_score: float,
    unaffected_side_score: float,
) -> str:
    """Pick the narration key to use for score feedback.

    >>> select_score_key(50.0, 30.0, 80.0)
    'score_asymmetric'
    >>> select_score_key(75.0, 75.0, 80.0)
    'score_high'
    >>> select_score_key(40.0, 38.0, 45.0)
    'score_low'
    """
    if abs(affected_side_score - unaffected_side_score) > ASYMMETRY_THRESHOLD:
        return "score_asymmetric"
    if rom_score >= HIGH_SCORE_THRESHOLD:
        return "score_high"
    return "score_low"


def score_narration_payload(
    rom_score: float,
    affected_side_score: float,
    unaffected_side_score: float,
    session_id: str,
) -> dict:
    """Build a ready-to-send avatar_narrate WebSocket payload for end-of-session feedback."""
    stage = select_score_key(rom_score, affected_side_score, unaffected_side_score)
    return {
        "type": "avatar_narrate",
        "payload": {
            "stage": stage,
            "session_id": session_id,
        },
    }
