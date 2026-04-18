"""SessionContext → user message formatter for the clinical LLM layer."""

_REQUIRED_KEYS = (
    "patient_id",
    "last_session_date",
    "last_exercise",
    "streak_days",
    "fma_subscale_score",
    "mood_today",
    "missed_yesterday",
)


def build_user_message(context: dict, patient_input: str) -> str:
    """Format a SessionContext dict into a GPT-4o user message.

    Validates that all required SessionContext keys are present.

    Args:
        context: SessionContext dict from Sakshi's FastAPI layer.
        patient_input: Transcribed patient speech or text.

    Raises:
        ValueError: If any required key is absent from context.
    """
    missing = [k for k in _REQUIRED_KEYS if k not in context]
    if missing:
        raise ValueError(
            f"SessionContext is missing required keys: {missing}. "
            "Verify the upstream WebSocket payload matches the contract in CLAUDE.md."
        )
    mood = context["mood_today"] if context["mood_today"] is not None else "not reported"
    return (
        f"Session context:\n"
        f"- Patient: {context['patient_id']}\n"
        f"- Last session: {context['last_session_date']}\n"
        f"- Last exercise: {context['last_exercise']}\n"
        f"- Streak: {context['streak_days']} days\n"
        f"- FMA subscale score: {context['fma_subscale_score']:.1f} / 52\n"
        f"- Today's mood: {mood}\n"
        f"- Missed yesterday: {context['missed_yesterday']}\n"
        f"\nPatient said: \"{patient_input}\""
    )
