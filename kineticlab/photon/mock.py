"""Mock Photon client — logs to stdout. Activated by MOCK_MODE=true."""
import logging
from typing import Literal

Platform = Literal["imessage", "sms"]

logger = logging.getLogger(__name__)


class MockPhotonClient:
    """Logs iMessage payloads to stdout. Swap for PhotonClient when Photon is available."""

    async def send(
        self,
        recipient: str,
        content: str,
        quick_replies: list[str] | None = None,
        platform: Platform = "imessage",
    ) -> str:
        """Log a message payload and return a mock message ID."""
        logger.info("[MOCK] iMessage to %s (%s): %s", recipient, platform, content)
        if quick_replies:
            logger.info("[MOCK] Quick replies: %s", quick_replies)
        return "mock-msg-001"

    async def close(self) -> None:
        """No-op teardown."""
