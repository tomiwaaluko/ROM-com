"""
Photon service entry point.

Starts the APScheduler event loop and keeps the process alive until Ctrl-C.
Run with:
    python -m photon.main
    MOCK_PHOTON=1 python -m photon.main            # mock mode — no real iMessages sent
    PHOTON_SEND_HOUR=9 python -m photon.main       # send at 09:00 instead of 08:00
"""

import asyncio
import logging
import os
import sys

from photon.scheduler import start_scheduler

_LOG_FORMAT = "%(asctime)s %(name)s %(levelname)s %(message)s"


def _configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, stream=sys.stdout)


async def main() -> None:
    """Configure logging, start the scheduler, and block until interrupted."""
    _configure_logging()
    logger = logging.getLogger(__name__)

    mock = os.environ.get("MOCK_PHOTON", "0")
    send_hour = os.environ.get("PHOTON_SEND_HOUR", "8")
    send_minute = os.environ.get("PHOTON_SEND_MINUTE", "0")

    logger.info(
        "Photon starting — MOCK_PHOTON=%s PHOTON_SEND_HOUR=%s PHOTON_SEND_MINUTE=%s",
        mock,
        send_hour,
        send_minute,
    )

    scheduler = start_scheduler()

    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, asyncio.CancelledError):
        scheduler.shutdown(wait=False)
        logger.info("Photon scheduler stopped.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
