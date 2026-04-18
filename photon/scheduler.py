"""
APScheduler cron job — fires the daily reminder pipeline once per day.

Send time defaults to 08:00 local time and is configurable via env vars:
    PHOTON_SEND_HOUR   — integer hour   (0–23, default 8)
    PHOTON_SEND_MINUTE — integer minute (0–59, default 0)
"""

import logging
import os

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from photon.client import send_imessage_safe
from photon.message_gen import generate_message
from photon.session import get_all_active_users, get_latest_session

logger = logging.getLogger(__name__)

_DEFAULT_HOUR = 8
_DEFAULT_MINUTE = 0


def _send_hour() -> int:
    raw = os.environ.get("PHOTON_SEND_HOUR", "")
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "PHOTON_SEND_HOUR=%r is not a valid integer — using default %d.",
            raw,
            _DEFAULT_HOUR,
        )
        return _DEFAULT_HOUR
    if not 0 <= value <= 23:
        logger.warning(
            "PHOTON_SEND_HOUR=%d is out of range (0–23) — using default %d.",
            value,
            _DEFAULT_HOUR,
        )
        return _DEFAULT_HOUR
    return value


def _send_minute() -> int:
    raw = os.environ.get("PHOTON_SEND_MINUTE", "")
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "PHOTON_SEND_MINUTE=%r is not a valid integer — using default %d.",
            raw,
            _DEFAULT_MINUTE,
        )
        return _DEFAULT_MINUTE
    if not 0 <= value <= 59:
        logger.warning(
            "PHOTON_SEND_MINUTE=%d is out of range (0–59) — using default %d.",
            value,
            _DEFAULT_MINUTE,
        )
        return _DEFAULT_MINUTE
    return value


async def daily_reminder_job() -> None:
    """
    Pull session data for every active user, generate a personalized iMessage,
    and deliver it via Photon Spectrum.

    Per-user failures are caught and logged without aborting the remaining
    users. If get_all_active_users() is not yet implemented, the job exits
    gracefully with a warning rather than raising.
    """
    logger.info("Daily reminder job starting.")

    try:
        users = await get_all_active_users()
    except NotImplementedError:
        logger.warning(
            "get_all_active_users() is not yet implemented — "
            "daily reminder job skipped. Coordinate the /users endpoint "
            "with Sakshi at the H0 integration checkpoint."
        )
        return
    except Exception:
        logger.exception("Unexpected error fetching active users — job aborted.")
        return

    if not users:
        logger.info("No active users returned — nothing to send.")
        return

    logger.info("Daily reminder job: %d active user(s) to process.", len(users))

    succeeded = 0
    failed = 0

    for user in users:
        user_id = user.get("id", "<unknown>")
        phone = user.get("phone", "")

        if not phone:
            logger.warning("User %s has no phone number — skipping.", user_id)
            failed += 1
            continue

        try:
            session_data = await get_latest_session(user_id)
        except Exception:
            logger.exception(
                "Failed to fetch session for user %s — skipping.", user_id
            )
            failed += 1
            continue

        message = await generate_message(user_id, session_data)

        result = await send_imessage_safe(phone, message)
        if result.get("status") == "error":
            logger.error(
                "Photon delivery failed for user %s: %s",
                user_id,
                result.get("detail", "unknown error"),
            )
            failed += 1
        else:
            logger.info(
                "Reminder sent to user %s (status=%s).",
                user_id,
                result.get("status"),
            )
            succeeded += 1

    logger.info(
        "Daily reminder job complete — %d sent, %d failed.", succeeded, failed
    )


def start_scheduler() -> AsyncIOScheduler:
    """
    Create, configure, and start the APScheduler AsyncIOScheduler.

    Send time is read from PHOTON_SEND_HOUR / PHOTON_SEND_MINUTE at startup.
    Invalid or out-of-range values fall back to 08:00 with a logged warning.

    Returns:
        The running AsyncIOScheduler instance. Caller is responsible for
        calling scheduler.shutdown() on exit.
    """
    hour = _send_hour()
    minute = _send_minute()

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        daily_reminder_job,
        trigger="cron",
        hour=hour,
        minute=minute,
        id="daily_reminder",
        replace_existing=True,
        misfire_grace_time=300,  # tolerate up to 5-min scheduler lag before skipping
    )
    scheduler.start()

    logger.info(
        "Photon scheduler started — daily reminders scheduled for %02d:%02d local time.",
        hour,
        minute,
    )
    return scheduler
