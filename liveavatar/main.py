"""Compatibility entry point for the LiveAvatar service."""
from __future__ import annotations

import asyncio

from kineticlab.liveavatar.main import main


if __name__ == "__main__":
    asyncio.run(main())
