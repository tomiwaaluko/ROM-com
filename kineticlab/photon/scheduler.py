"""Photon daily outreach scheduler: pulls session data and sends personalized iMessages."""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from kineticlab.photon import get_photon_client
from kineticlab.photon.llm import generate_message
from kineticlab.photon.templates import (
    daily_reminder,
    mood_poll,
    missed_session_nudge,
    streak_message,
)

logger = logging.getLogger(__name__)

_DEFAULT_HOUR = 8   # 8:00 AM local time


def _require_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(f"Missing required environment variable: {key}.")
    return val


async def pull_session_data() -> list[dict]:
    """Fetch all active patient SessionContexts from MongoDB.

    Reads MONGO_URI from environment. Returns an empty list (no crash) if
    MongoDB is unavailable — caller logs and skips the run.
    """
    mongo_uri = _require_env("MONGODB_URI")
    try:
        import motor.motor_asyncio as motor  # type: ignore

        client = motor.AsyncIOMotorClient(mongo_uri)
        db = client["kineticlab"]
        cursor = db["patients"].find({"active": True})
        patients = await cursor.to_list(length=1000)
        client.close()
        logger.info("[Scheduler] Pulled %d patient records.", len(patients))
        return patients
    except Exception as exc:
        logger.error("[Scheduler] Failed to pull session data: %s", exc)
        return []


async def run_once(contexts: list[dict]) -> None:
    """Send messages to a pre-fetched list of patient SessionContext dicts.

    Does not hit MongoDB — accepts contexts directly. Designed for testing
    and for callers that have already fetched session data.
    """
    client = get_photon_client()
    try:
        for ctx in contexts:
            await _send_for_patient(client, ctx)
    finally:
        await client.close()


async def run_daily_outreach() -> None:
    """Iterate all active patients and send a personalised iMessage to each.

    Uses generate_message() (LLM) when the message needs personalisation; for
    simple type dispatches the pre-built template functions are called directly.
    """
    patients = await pull_session_data()
    if not patients:
        logger.warning("[Scheduler] No patient records found — skipping outreach run.")
        return

    client = get_photon_client()
    try:
        for ctx in patients:
            await _send_for_patient(client, ctx)
    finally:
        await client.close()


async def _send_for_patient(client, ctx: dict) -> None:
    """Send the appropriate message to a single patient."""
    patient_id: str = ctx.get("patient_id", "unknown")
    recipient: str = ctx.get("phone", "")
    if not recipient:
        logger.warning("[Scheduler] Patient %s has no phone number — skipping.", patient_id)
        return
    try:
        content, quick_replies = await generate_message(ctx)
        msg_id = await client.send(
            recipient=recipient,
            content=content,
            quick_replies=quick_replies,
        )
        logger.info("[Scheduler] Sent %s to patient %s (msg_id=%s).", ctx.get("msg_type", "message"), patient_id, msg_id)
    except Exception as exc:
        logger.error("[Scheduler] Failed to send message to patient %s: %s", patient_id, exc)


def _seconds_until(hour: int) -> float:
    """Return seconds until the next occurrence of `hour`:00 local time."""
    now = datetime.now()
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def run_scheduler(hour: int = _DEFAULT_HOUR) -> None:
    """Run the daily outreach loop forever, firing each day at `hour`:00 local.

    Designed to be launched as a long-running asyncio task alongside the main app.
    Cancel the task to stop the scheduler cleanly.
    """
    logger.info("[Scheduler] Started. Daily outreach fires at %02d:00.", hour)
    while True:
        wait = _seconds_until(hour)
        logger.info("[Scheduler] Next run in %.0f seconds.", wait)
        await asyncio.sleep(wait)
        logger.info("[Scheduler] Running daily outreach at %s.", datetime.now().isoformat())
        await run_daily_outreach()
