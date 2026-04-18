"""
Inbound reply router for Photon iMessage responses.

When a patient replies to a daily reminder, Photon delivers the text to a
webhook which calls handle_reply(). This module classifies the reply and
dispatches the appropriate downstream action.

    YES / Y / OK / READY   → trigger LiveAvatar session
    SKIP / NO / N / LATER  → log the skip
    PLAN / TODAY           → send today's exercise plan via iMessage
    (anything else)        → log as unrecognised, no action
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import httpx

from photon.client import send_imessage_safe
from photon.session import SESSION_BASE_URL, get_all_active_users, get_latest_session

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(10.0)

# LiveAvatar runs on a separate service from the session layer.
LIVEAVATAR_BASE_URL: str = os.environ.get("LIVEAVATAR_BASE_URL", "http://localhost:5000")

_TRIGGER_KEYWORDS = frozenset({"yes", "y", "ok", "ready"})
_SKIP_KEYWORDS = frozenset({"skip", "no", "n", "later"})
_PLAN_KEYWORDS = frozenset({"plan", "today"})


@asynccontextmanager
async def _client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """Yield a configured AsyncClient with a 10-second timeout."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        yield client


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def handle_reply(user_id: str, reply_text: str) -> dict:
    """
    Parse an incoming iMessage reply and route it to the correct handler.

    Matching is case-insensitive and whitespace-trimmed. Only exact keyword
    tokens are matched — partial-word matches are not performed — so "notable"
    does not match "no".

    Args:
        user_id:    Internal user identifier.
        reply_text: Raw text the patient sent back via iMessage.

    Returns:
        A routing result dict with at minimum an "action" key:
            {"action": "session_triggered"}
            {"action": "skipped"}
            {"action": "plan_sent"}
            {"action": "unrecognized", "reply": <original text>}
    """
    token = reply_text.strip().lower()

    if token in _TRIGGER_KEYWORDS:
        await trigger_liveavatar_session(user_id)
        return {"action": "session_triggered"}

    if token in _SKIP_KEYWORDS:
        await log_skip(user_id)
        return {"action": "skipped"}

    if token in _PLAN_KEYWORDS:
        await send_todays_plan(user_id)
        return {"action": "plan_sent"}

    logger.info("Unrecognised reply from user %s: %r", user_id, reply_text)
    return {"action": "unrecognized", "reply": reply_text}


async def trigger_liveavatar_session(user_id: str) -> None:
    """
    POST to the LiveAvatar service to start a real-time companion session.

    Uses LIVEAVATAR_BASE_URL as the base (defaults to http://localhost:5000,
    configurable via the LIVEAVATAR_BASE_URL env var). Never raises — logs
    errors and returns cleanly.

    Args:
        user_id: Forwarded as a path segment to identify the patient session.
    """
    url = f"{LIVEAVATAR_BASE_URL}/liveavatar/{user_id}/start"
    try:
        async with _client() as client:
            r = await client.post(url)
            r.raise_for_status()
        logger.info(
            "LiveAvatar session triggered for user %s (status %d).",
            user_id,
            r.status_code,
        )
    except httpx.HTTPStatusError as exc:
        logger.error(
            "Failed to trigger LiveAvatar for user %s: HTTP %d from %s",
            user_id,
            exc.response.status_code,
            url,
        )
    except httpx.RequestError as exc:
        logger.error(
            "Network error triggering LiveAvatar for user %s at %s: %s",
            user_id,
            url,
            exc,
        )


async def log_skip(user_id: str) -> None:
    """
    POST to the session layer to record that the user skipped today's session.

    Never raises — logs errors and returns cleanly. Caregiver notification on
    consecutive skips is not yet implemented (caregiver contacts are not in
    the current session schema).

    Args:
        user_id: Internal user identifier.
    """
    url = f"{SESSION_BASE_URL}/session/{user_id}/skip"
    try:
        async with _client() as client:
            r = await client.post(url)
            r.raise_for_status()
        logger.info("Skip logged for user %s.", user_id)
    except httpx.HTTPStatusError as exc:
        logger.error(
            "Failed to log skip for user %s: HTTP %d from %s",
            user_id,
            exc.response.status_code,
            url,
        )
    except httpx.RequestError as exc:
        logger.error(
            "Network error logging skip for user %s at %s: %s",
            user_id,
            url,
            exc,
        )


async def send_todays_plan(user_id: str) -> None:
    """
    Fetch the patient's latest session and send a plain-text plan summary
    back to them via iMessage.

    Phone numbers are not in Sakshi's session schema, so the number is
    resolved by looking up the user in the active-users list from session.py.

    Never raises — logs errors and returns cleanly.

    Args:
        user_id: Internal user identifier.
    """
    try:
        users = await get_all_active_users()
    except (NotImplementedError, RuntimeError) as exc:
        logger.warning(
            "Cannot send today's plan to user %s — could not fetch user list: %s",
            user_id,
            exc,
        )
        return

    user = next((u for u in users if u.get("id") == user_id), None)
    if not user:
        logger.warning(
            "Cannot send today's plan — user %s not found in active users list.",
            user_id,
        )
        return

    phone = user.get("phone", "")
    if not phone:
        logger.warning(
            "Cannot send today's plan to user %s — no phone number in user record.",
            user_id,
        )
        return

    try:
        session_data = await get_latest_session(user_id)
    except RuntimeError as exc:
        logger.error(
            "Could not fetch session for today's plan (user %s): %s", user_id, exc
        )
        return

    plan_text = _format_plan(session_data)
    result = await send_imessage_safe(phone, plan_text)
    if result.get("status") == "error":
        logger.error(
            "Failed to send today's plan to user %s: %s",
            user_id,
            result.get("detail", "unknown error"),
        )
    else:
        logger.info("Today's plan sent to user %s.", user_id)


async def notify_caregiver(user_id: str, message: str) -> None:
    """
    Alert a patient's caregiver via iMessage.

    Not yet implemented — caregiver contact information (phone number,
    consent record) is not part of the current session schema. Coordinate
    with Sakshi to add a caregiver_phone field before implementing.

    Args:
        user_id: Internal user identifier of the patient.
        message: Pre-composed message text to send to the caregiver.
    """
    raise NotImplementedError(
        "notify_caregiver is not yet implemented: caregiver phone numbers "
        "are not part of the current session schema. Add caregiver_phone "
        "to the schema (coordinate with Sakshi) before implementing this."
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _format_plan(session_data: dict) -> str:
    """
    Build a short plain-text plan summary from session data fields.

    Handles missing fields gracefully so the message is always sendable.
    Keeps output under 160 characters per the iMessage SMS fallback limit.
    """
    exercises = session_data.get("exercises_completed", [])
    streak = session_data.get("streak", 0)

    if exercises:
        exercise_list = ", ".join(str(e).replace("_", " ") for e in exercises)
        plan = f"Today's plan: {exercise_list}."
    else:
        plan = "Today's plan: your exercises are ready when you are."

    if streak:
        plan += f" {streak}-day streak — keep it going!"

    # Hard-trim to 160 chars at the last word boundary.
    if len(plan) > 160:
        plan = plan[:160].rsplit(" ", 1)[0].rstrip()

    return plan
