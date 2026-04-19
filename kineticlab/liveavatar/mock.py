"""Mock LiveAvatar client — logs to stdout. Activated by MOCK_MODE=true."""
import logging

logger = logging.getLogger(__name__)


class MockLiveAvatarClient:
    """Logs avatar speech to stdout. Swap for LiveAvatarClient when HeyGen is available."""

    def __init__(self) -> None:
        self.session_id: str | None = None

    async def connect(self) -> str:
        """Simulate session start. Returns a fixed mock session ID."""
        self.session_id = "mock-session-001"
        logger.info("[MOCK] LiveAvatar session started (id=%s)", self.session_id)
        return self.session_id

    async def speak(self, text: str) -> bytes:
        """Log avatar speech to stdout. Returns empty bytes (mock TTS)."""
        logger.info("[MOCK] Avatar says: %s", text)
        return b""

    async def close(self) -> None:
        """Simulate session teardown."""
        logger.info("[MOCK] LiveAvatar session closed (id=%s)", self.session_id)
        self.session_id = None
