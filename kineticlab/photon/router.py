"""Photon inbound webhook handler — hand this router to Sakshi to register."""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)

router = APIRouter()

# Reply → action name mapping (lowercase, stripped)
_REPLY_ROUTES: dict[str, str] = {
    "ready": "launch_liveavatar_session",
    "yes, let's go": "launch_liveavatar_session",
    "not today": "log_skip",
    "remind me later": "log_remind_later",
    "good": "set_mood_good",
    "okay": "set_mood_okay",
    "rough": "set_mood_rough",
}


@router.post("/photon/inbound")
async def handle_reply(request: Request) -> dict:
    """Receive an inbound iMessage reply from Photon Spectrum and dispatch it.

    Sakshi registers this router on the FastAPI app. The webhook URL must be
    configured in the Photon dashboard and be publicly reachable (use ngrok if local).
    """
    data = await request.json()
    reply = data.get("content", "").strip().lower()
    patient_phone: str = data.get("sender", "unknown")
    action = _REPLY_ROUTES.get(reply, "log_unrecognized")
    logger.info("[Photon] Reply from %s: %r → action: %s", patient_phone, reply, action)
    await _dispatch_action(action, patient_phone, data)
    return {"status": "ok"}


async def _dispatch_action(action: str, patient_phone: str, data: dict) -> None:
    """Route the normalised action to the appropriate handler."""
    handlers = {
        "launch_liveavatar_session": _handle_launch,
        "log_skip": _handle_skip,
        "log_remind_later": _handle_remind_later,
        "set_mood_good": lambda p, d: _handle_mood(p, d, "Good"),
        "set_mood_okay": lambda p, d: _handle_mood(p, d, "Okay"),
        "set_mood_rough": lambda p, d: _handle_mood(p, d, "Rough"),
        "log_unrecognized": _handle_unrecognized,
    }
    handler = handlers.get(action, _handle_unrecognized)
    await handler(patient_phone, data)


async def _handle_launch(patient_phone: str, data: dict) -> None:
    """Log intent to launch LiveAvatar session (stretch: deeplink trigger)."""
    logger.info("[Photon] Patient %s is ready — LiveAvatar session launch requested.", patient_phone)


async def _handle_skip(patient_phone: str, data: dict) -> None:
    """Log that the patient declined today's session."""
    logger.info("[Photon] Patient %s skipped today's session.", patient_phone)
    await _write_mongo_event(patient_phone, {"event": "skip", "raw": data})


async def _handle_remind_later(patient_phone: str, data: dict) -> None:
    """Log a reminder deferral — no rescheduling implemented yet."""
    logger.info("[Photon] Patient %s asked to be reminded later.", patient_phone)


async def _handle_mood(patient_phone: str, data: dict, mood: str) -> None:
    """Persist the reported mood into MongoDB via the session store."""
    logger.info("[Photon] Patient %s mood: %s", patient_phone, mood)
    await _write_mongo_event(patient_phone, {"event": "mood_update", "mood": mood, "raw": data})


async def _handle_unrecognized(patient_phone: str, data: dict) -> None:
    """Log replies that don't match any known quick-reply option."""
    logger.warning("[Photon] Unrecognized reply from %s: %r", patient_phone, data.get("content"))


async def _write_mongo_event(patient_phone: str, payload: dict) -> None:
    """Write an event document to MongoDB if MONGO_URI is available.

    Silently skips if MONGO_URI is not set — caller has already logged the event.
    """
    mongo_uri = os.environ.get("MONGO_URI")
    if not mongo_uri:
        logger.debug("[Photon] MONGO_URI not set — skipping MongoDB write.")
        return
    try:
        import motor.motor_asyncio as motor  # type: ignore

        client = motor.AsyncIOMotorClient(mongo_uri)
        db = client["kineticlab"]
        payload["patient_phone"] = patient_phone
        await db["photon_events"].insert_one(payload)
        client.close()
    except Exception as exc:
        logger.error("[Photon] MongoDB write failed for %s: %s", patient_phone, exc)
