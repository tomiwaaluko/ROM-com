"""
LLM-powered iMessage generator for the Photon reminder service.

Uses Gemini 2.5 Flash to generate personalized daily reminders for stroke/TBI
rehabilitation patients. Clinical guardrails are enforced at the system-prompt
level and validated against a prohibited-phrase list before any message is sent.

Falls back to static templates on any Gemini error so the scheduler never
silently drops a patient's morning message.
"""

from __future__ import annotations

import asyncio
import logging
import os

import google.generativeai as genai
from google.api_core import exceptions as google_exceptions
from google.generativeai.types import GenerationConfig

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash-preview-04-17"
MAX_CHARS = 160

# Verbatim system prompt required by .claude/skills/clinical_prompt_guardrails.md.
# Do NOT paraphrase or shorten — this exact text is the compliance requirement.
CLINICAL_GUARDRAILS_PREFIX = """\
You are a supportive rehabilitation companion for stroke and TBI patients.
You are NOT a doctor, therapist, or medical professional.

Absolute rules:
1. Never diagnose, prescribe, or give medical advice
2. Never claim FDA validation, FDA clearance, or clinical certification
3. Never induce guilt, anxiety, or urgency in any message
4. Never suggest the patient is failing, falling behind, or underperforming
5. If patient expresses pain, distress, or emergency: immediately respond with
   "Let's pause. Please rest and check with your therapist or call 911 if urgent."
6. Frame all scores as "research-grade FMA-UE subscale proxy" — not clinical diagnosis
7. Responses for real-time avatar delivery: max 2 sentences
8. Responses for iMessage: max 3 sentences, warm tone, no medical jargon
9. Celebrate effort, not just outcomes
10. You are a supportive guide, not a clinician"""

# Prohibited phrases from .claude/skills/clinical_prompt_guardrails.md.
PROHIBITED: list[str] = [
    "you failed",
    "you didn't complete",
    "you should have",
    "you're behind",
    "you must",
    "fda-cleared",
    "fda-approved",
    "clinically validated",
    "clinically proven",
    "medically certified",
]

# Static fallback templates — used when Gemini is unavailable.
TEMPLATES: dict[str, str] = {
    "daily_reminder": (
        "Good morning {name}. Today's goal: {exercise}. You did it yesterday — let's go."
    ),
    "streak_reinforcement": (
        "Day {streak} in a row. That's real consistency. Today: {exercise}, {duration} min."
    ),
    "missed_session_nudge": (
        "You skipped yesterday — no problem. Want to do a short 2-minute session now?"
    ),
    "weekly_summary": (
        "This week: {completed}/7 sessions. Your {metric} improved. Full recap inside."
    ),
    "quick_poll": (
        "How are you feeling today? \U0001f4aa Good / \U0001f610 Okay / \U0001f613 Rough"
    ),
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_message(user_id: str, session_data: dict) -> str:
    """
    Generate a personalized daily reminder iMessage using Gemini 2.5 Flash.

    The clinical guardrails prefix is sent as Gemini's system instruction.
    Output is validated against prohibited phrases and hard-truncated to 160
    characters. Falls back to the static daily_reminder template on any error.

    Args:
        user_id:      Patient identifier — used for logging and personalisation.
        session_data: Latest session dict from Sakshi's endpoint. Recognised
                      keys: last_exercise (str), fma_score (dict | int),
                      streak (int), name (str).

    Returns:
        Message string of at most 160 characters, safe for send_imessage_safe().
    """
    try:
        model = _build_model()
        prompt = _build_prompt(user_id, session_data)

        # generate_content is synchronous — run in a thread to avoid blocking
        # the APScheduler asyncio event loop.
        response = await asyncio.to_thread(model.generate_content, prompt)
        text = response.text.strip()

        violations = validate_llm_output(text)
        if violations:
            logger.warning(
                "Gemini output for user %s contained prohibited phrases %s — "
                "falling back to template.",
                user_id,
                violations,
            )
            return _template_fallback(session_data)

        text = _enforce_char_limit(text)
        logger.info(
            "Generated iMessage for user %s (%d chars): %r", user_id, len(text), text
        )
        return text

    except google_exceptions.InvalidArgument as exc:
        logger.error("Gemini invalid argument for user %s: %s", user_id, exc)
    except google_exceptions.ResourceExhausted as exc:
        logger.error("Gemini quota exceeded for user %s: %s", user_id, exc)
    except google_exceptions.ServiceUnavailable as exc:
        logger.error("Gemini service unavailable for user %s: %s", user_id, exc)
    except google_exceptions.GoogleAPICallError as exc:
        logger.error("Gemini API error for user %s: %s", user_id, exc)
    except RuntimeError as exc:
        # GEMINI_API_KEY not set
        logger.error("Gemini config error: %s", exc)

    return _template_fallback(session_data)


def validate_llm_output(text: str) -> list[str]:
    """
    Check generated text against the prohibited-phrase list.

    Returns:
        List of prohibited phrases found. Empty list means the text is safe.
    """
    lower = text.lower()
    return [phrase for phrase in PROHIBITED if phrase in lower]


def render_template(message_type: str, **kwargs: str) -> str:
    """
    Render a static fallback template without an LLM call.

    Args:
        message_type: One of the five supported types.
        **kwargs:     Template variables (name, exercise, streak, etc.).

    Returns:
        Formatted message string.

    Raises:
        KeyError: if message_type is not in VALID_MESSAGE_TYPES.
    """
    return TEMPLATES[message_type].format_map(_SafeFormatMap(kwargs))


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_model() -> genai.GenerativeModel:
    """Initialise the Gemini client. Raises RuntimeError if key is missing."""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. "
            "Export the variable or set MOCK_PHOTON=1 to skip LLM calls."
        )
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        system_instruction=CLINICAL_GUARDRAILS_PREFIX,
        generation_config=GenerationConfig(
            temperature=0.4,
            # 160 chars ≈ 40–50 tokens; cap at 60 for breathing room.
            max_output_tokens=60,
        ),
    )


def _build_prompt(user_id: str, session_data: dict) -> str:
    """Construct the user-turn prompt from session fields."""
    name = session_data.get("name", "")
    last_exercise = session_data.get("last_exercise", "your exercises")
    streak = session_data.get("streak", 0)  # Sakshi's schema field is "streak"
    fma_score = session_data.get("fma_score", {})
    fma_total = fma_score.get("total") if isinstance(fma_score, dict) else fma_score

    lines = [
        "Generate a warm, personalized daily reminder iMessage for a stroke "
        "rehabilitation patient.",
    ]
    if name:
        lines.append(f"Patient first name: {name}")
    lines.append(f"Most recent exercise: {last_exercise}")
    if streak:
        lines.append(f"Consecutive-day streak: {streak}")
    if fma_total is not None:
        lines.append(
            f"Research-grade FMA-UE subscale proxy score: {fma_total} "
            "(do not interpret this as a clinical diagnosis)"
        )
    lines += [
        "",
        "Output rules:",
        "- Hard limit: 160 characters total (count carefully)",
        "- 1–2 sentences only",
        "- Warm, encouraging, never patronising",
        "- Celebrate effort, not just results",
        "- Return the message text only — no quotes, no preamble",
    ]
    return "\n".join(lines)


def _enforce_char_limit(text: str) -> str:
    """Truncate at the last word boundary at or before MAX_CHARS."""
    if len(text) <= MAX_CHARS:
        return text
    truncated = text[:MAX_CHARS]
    # Don't cut mid-word.
    last_space = truncated.rfind(" ")
    return truncated[:last_space].rstrip() if last_space != -1 else truncated


def _template_fallback(session_data: dict) -> str:
    """Render the static daily_reminder template from available session fields."""
    text = render_template(
        "daily_reminder",
        name=session_data.get("name", ""),
        exercise=session_data.get("last_exercise", "today's exercise"),
        streak=str(session_data.get("streak") or ""),  # Sakshi's schema field is "streak"
    )
    return _enforce_char_limit(text)


class _SafeFormatMap(dict):
    """Returns the placeholder string unchanged when a variable is missing."""

    def __missing__(self, key: str) -> str:
        return f"{{{key}}}"
