"""Single source of truth for all avatar narration script lines.

All strings are pre-reviewed to pass clinical guardrails:
- No diagnostic claims
- No false positivity
- Empathy-first on distress
- Always offers a way out
- Short, simple sentences suitable for patients with attention/reading deficits.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class NarrationScript:
    """A single narration line. Some are templates and take kwargs."""
    key: str
    text: str
    is_template: bool = False


SCRIPTS: dict[str, str] = {
    "welcome": (
        "Hi, I'm Kai. I'll be guiding you through today's session. "
        "Take your time. When you're ready, tap next to get started."
    ),
    "calibration_intro": (
        "Before we begin, I'm going to map out your comfortable range of movement. "
        "There are no right or wrong answers. Just move wherever feels natural today."
    ),
    # Template — expects section_name kwarg
    "calibration_section_start": (
        "Let's work on your {section_name}. "
        "Move slowly, and stop wherever feels comfortable."
    ),
    "calibration_section_pause": (
        "That's done. Take a breath if you need one."
    ),
    "calibration_section_ready": (
        "Whenever you're ready, tap continue to move to the next part."
    ),
    "calibration_complete": (
        "You've finished the calibration. "
        "That's the hardest part done."
    ),
    "score_high": (
        "Beautiful work today. Your movement looked strong and steady. "
        "Rest well. Your therapist will see your results."
    ),
    "score_low": (
        "You showed up today, and that matters. "
        "Every session adds to your progress. "
        "Rest now. We'll go again next time."
    ),
    "score_asymmetric": (
        "Nice work. I noticed one side moved a little differently today. "
        "That's useful information for your therapist. "
        "Rest now, and we'll keep building from here."
    ),
    "session_close": (
        "Great work today. Your therapist will review your results. "
        "See you next session."
    ),
}

# Keys that contain template placeholders and require kwargs
TEMPLATE_KEYS: set[str] = {"calibration_section_start"}


def get_script(key: str, **kwargs: str) -> str:
    """Return the narration string for a given key, formatting templates if needed.

    Raises:
        KeyError: If key is not a known narration stage (with helpful message).
    """
    if key not in SCRIPTS:
        known = ", ".join(sorted(SCRIPTS.keys()))
        raise KeyError(
            f"Unknown narration key: '{key}'. Known keys: {known}"
        )
    text = SCRIPTS[key]
    if key in TEMPLATE_KEYS:
        return text.format(**kwargs)
    return text
