"""LiveAvatar service entry point."""
from __future__ import annotations

import asyncio
import logging
import signal
from contextlib import suppress

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s — %(message)s"


def _configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)


def _install_signal_handlers(stop_event: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()

    def request_shutdown() -> None:
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, request_shutdown)


async def main() -> None:
    _configure_logging()
    logger = logging.getLogger(__name__)
    stop_event = asyncio.Event()
    _install_signal_handlers(stop_event)

    from kineticlab.liveavatar.session import LiveAvatarSession

    session = LiveAvatarSession()
    try:
        await session.start()
        await stop_event.wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        await session.stop()
        logger.info("LiveAvatar service shut down cleanly.")


if __name__ == "__main__":
    asyncio.run(main())
