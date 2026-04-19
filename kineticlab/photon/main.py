"""Photon FastAPI service entry point."""
from __future__ import annotations

import asyncio
import logging, os
import signal
from contextlib import suppress

import uvicorn
from fastapi import FastAPI

from kineticlab.photon.router import router
from kineticlab.photon.scheduler import run_scheduler

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s — %(message)s"


def create_app() -> FastAPI:
    app = FastAPI(title="KineticLab Photon")
    app.include_router(router)
    return app


def _configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)


def _install_signal_handlers(server: uvicorn.Server) -> None:
    loop = asyncio.get_running_loop()

    def request_shutdown() -> None:
        server.should_exit = True

    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, request_shutdown)


async def main() -> None:
    _configure_logging()
    logger = logging.getLogger(__name__)
    app = create_app()
    port = int(os.environ.get("PHOTON_PORT", "6000"))
    config = uvicorn.Config(app, host="0.0.0.0", port=port, log_config=None)
    server = uvicorn.Server(config)
    _install_signal_handlers(server)

    scheduler_task = asyncio.create_task(run_scheduler())
    try:
        await server.serve()
    finally:
        scheduler_task.cancel()
        with suppress(asyncio.CancelledError):
            await scheduler_task
        logger.info("Photon service shut down cleanly.")


if __name__ == "__main__":
    asyncio.run(main())
