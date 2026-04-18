"""HeyGen LiveAvatar Lite BYOLLM client."""
import os
import httpx

HEYGEN_BASE = "https://api.heygen.com/v2"


def _require_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(
            f"Missing required environment variable: {key}. "
            "Set it before starting the application."
        )
    return val


class LiveAvatarClient:
    """HeyGen LiveAvatar Lite BYOLLM client.

    Call connect() before speak(). Always call close() when done.
    """

    def __init__(self) -> None:
        self.api_key: str = _require_env("HEYGEN_API_KEY")
        self.avatar_id: str = _require_env("HEYGEN_AVATAR_ID")
        self.voice_id: str = _require_env("ELEVENLABS_VOICE_ID")
        self.session_id: str | None = None
        self._client = httpx.AsyncClient(
            headers={"X-Api-Key": self.api_key},
            timeout=10.0,
        )

    async def connect(self) -> str:
        """Start a streaming session. Returns session_id."""
        resp = await self._client.post(
            f"{HEYGEN_BASE}/realtime/streaming/session",
            json={
                "avatar_id": self.avatar_id,
                "quality": "medium",
                "voice": {"voice_id": self.voice_id, "rate": 1.0},
            },
        )
        resp.raise_for_status()
        self.session_id = resp.json()["data"]["session_id"]
        return self.session_id

    async def speak(self, text: str) -> None:
        """Send text to avatar for real-time lip sync."""
        if not self.session_id:
            raise RuntimeError("Call connect() before speak().")
        resp = await self._client.post(
            f"{HEYGEN_BASE}/realtime/streaming/send_task",
            json={
                "session_id": self.session_id,
                "text": text,
                "task_type": "talk",
            },
        )
        resp.raise_for_status()

    async def close(self) -> None:
        """Stop the streaming session and release the HTTP client."""
        if self.session_id:
            await self._client.post(
                f"{HEYGEN_BASE}/realtime/streaming/stop",
                json={"session_id": self.session_id},
            )
            self.session_id = None
        await self._client.aclose()
