"""LLM-based message personalizer for the Photon iMessage pipeline."""
import os

from openai import AsyncOpenAI

_GUARDRAIL_INSTRUCTIONS = """
You are generating a short iMessage for a stroke or TBI rehabilitation patient.

Rules (never violate):
1. No guilt or failure language: no "missed", "failed", "should have", "didn't do".
2. No diagnostic claims: do not say the patient is getting better or improving.
3. Max 15 words per sentence.
4. Keep the total message under 40 words.
5. Frame FMA scores as a research-based progress measure, never a clinical assessment.
6. Tone: calm, warm, factual.

Return JSON only, with this exact shape:
{"content": "<message text>", "quick_replies": ["opt1", "opt2"] or null}
""".strip()

_MESSAGE_TYPE_HINTS: dict[str, str] = {
    "missed_nudge": "The patient skipped yesterday. Send a supportive nudge without guilt.",
    "streak": "The patient has a multi-day streak. Reinforce with specific, grounded praise.",
    "mood_poll": "We don't know the patient's mood. Ask how they're feeling.",
    "daily_reminder": "Standard morning reminder for today's exercise.",
}


def select_message_type(session_context: dict) -> str:
    """Choose the appropriate message type based on session context (no LLM).

    Priority: missed_yesterday → streak ≥3 → mood unknown → daily_reminder.
    Weekly summary is triggered externally and not handled here.
    """
    if session_context.get("missed_yesterday"):
        return "missed_nudge"
    if session_context.get("streak_days", 0) >= 3:
        return "streak"
    if session_context.get("mood_today") is None:
        return "mood_poll"
    return "daily_reminder"


async def generate_message(session_context: dict) -> tuple[str, list[str] | None]:
    """Use GPT-4o to generate a personalized iMessage for the patient.

    Selects the message type via select_message_type(), then personalizes the
    content using session data. Enforces clinical guardrails via system prompt.

    Args:
        session_context: SessionContext dict from MongoDB via pull_session_data().

    Returns:
        Tuple of (message_text, quick_replies). quick_replies is None when not needed.
    """
    import json

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Missing required environment variable: OPENAI_API_KEY. "
            "Set it before starting the application."
        )

    msg_type = select_message_type(session_context)
    hint = _MESSAGE_TYPE_HINTS[msg_type]

    user_prompt = (
        f"Message type: {msg_type}\n"
        f"Guidance: {hint}\n\n"
        f"Patient data:\n"
        f"- Name (patient_id): {session_context.get('patient_id', 'unknown')}\n"
        f"- Last exercise: {session_context.get('last_exercise', 'unknown')}\n"
        f"- Streak: {session_context.get('streak_days', 0)} days\n"
        f"- FMA subscale score: {session_context.get('fma_subscale_score', 0.0):.1f} / 52\n"
        f"- Today's mood: {session_context.get('mood_today', 'not reported')}\n"
    )

    oai = AsyncOpenAI(api_key=api_key)
    resp = await oai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _GUARDRAIL_INSTRUCTIONS},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=120,
        temperature=0.4,
        response_format={"type": "json_object"},
    )

    raw = json.loads(resp.choices[0].message.content or "{}")
    content: str = raw.get("content", "")
    quick_replies: list[str] | None = raw.get("quick_replies") or None
    return content, quick_replies
