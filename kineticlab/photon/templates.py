"""Photon iMessage message-type generators for KineticLab patient outreach."""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from kineticlab.photon.client import PhotonClient
    from kineticlab.photon.mock import MockPhotonClient

    _Client = PhotonClient | MockPhotonClient


async def daily_reminder(
    client: "_Client",
    recipient: str,
    name: str,
    exercise: str,
    duration_min: int,
) -> str:
    """Send the standard daily exercise reminder with quick-reply options.

    Returns the message_id from the Photon API.
    """
    return await client.send(
        recipient=recipient,
        content=f"Good morning {name}. Today's goal: {duration_min} minutes of {exercise}.",
        quick_replies=["Ready", "Not today", "Remind me later"],
    )


async def streak_message(
    client: "_Client",
    recipient: str,
    name: str,
    streak_days: int,
    exercise: str,
) -> str:
    """Send a streak-reinforcement message grounded in actual session count.

    Returns the message_id from the Photon API.
    """
    return await client.send(
        recipient=recipient,
        content=f"Day {streak_days} in a row, {name}. Today: {exercise}.",
    )


async def missed_session_nudge(
    client: "_Client",
    recipient: str,
    name: str,
) -> str:
    """Send a non-guilt nudge when the patient missed yesterday's session.

    Returns the message_id from the Photon API.
    """
    return await client.send(
        recipient=recipient,
        content=f"No session yesterday, {name} — that's okay. Want a short 2-minute session today?",
        quick_replies=["Yes, let's go", "Not today"],
    )


async def mood_poll(
    client: "_Client",
    recipient: str,
    name: str,
) -> str:
    """Send a mood-check poll when today's mood is not yet recorded.

    Returns the message_id from the Photon API.
    """
    return await client.send(
        recipient=recipient,
        content=f"How are you feeling today, {name}?",
        quick_replies=["Good", "Okay", "Rough"],
    )


async def weekly_summary(
    client: "_Client",
    recipient: str,
    name: str,
    sessions_completed: int,
    fma_delta: float,
) -> str:
    """Send a weekly summary grounded in actual session and FMA data.

    fma_delta is framed as a research-based progress measure, not a clinical assessment.
    Returns the message_id from the Photon API.
    """
    direction = "up" if fma_delta >= 0 else "down"
    return await client.send(
        recipient=recipient,
        content=(
            f"This week: {sessions_completed}/7 sessions, {name}. "
            f"Your research-based FMA score moved {direction} by {abs(fma_delta):.1f} points."
        ),
    )
