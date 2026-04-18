"""Photon Spectrum iMessage API client."""
import os
from typing import Literal

import httpx

PHOTON_BASE = "https://api.photon.codes/v1"
Platform = Literal["imessage", "sms"]


def _require_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(
            f"Missing required environment variable: {key}. "
            "Set it before starting the application."
        )
    return val


class PhotonClient:
    """Photon Spectrum iMessage API client.

    Always call close() when done to release the underlying HTTP connection.
    """

    def __init__(self) -> None:
        self.api_key: str = _require_env("PHOTON_API_KEY")
        self.sender_id: str = _require_env("PHOTON_SENDER_ID")
        self._client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=8.0,
        )

    async def send(
        self,
        recipient: str,
        content: str,
        quick_replies: list[str] | None = None,
        platform: Platform = "imessage",
    ) -> str:
        """Send a message to a patient. Returns message_id.

        Args:
            recipient: Patient phone number in E.164 format (e.g. +14125550100).
            content: Message body text.
            quick_replies: Optional tapable reply buttons.
            platform: Delivery channel — "imessage" or "sms".
        """
        payload: dict = {
            "sender": self.sender_id,
            "recipient": recipient,
            "content": content,
            "platform": platform,
        }
        if quick_replies:
            payload["quick_replies"] = quick_replies
        resp = await self._client.post(f"{PHOTON_BASE}/messages/send", json=payload)
        resp.raise_for_status()
        return resp.json()["message_id"]

    async def close(self) -> None:
        """Release the underlying HTTP client."""
        await self._client.aclose()
