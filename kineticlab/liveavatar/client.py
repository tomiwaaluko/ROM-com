"""LiveAvatar Interactive Avatar API client (LITE mode).

Backend owns session lifecycle only. Frontend drives commands via LiveKit data channel.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

API_BASE = "https://api.liveavatar.com/v1"


def _require_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(f"Missing required environment variable: {key}.")
    return val


class LiveAvatarClient:
    """Async client for LiveAvatar (LITE mode, session lifecycle only)."""

    def __init__(self) -> None:
        self.api_key: str = _require_env("LIVEAVATAR_API_KEY")
        self.avatar_id: str = _require_env("LIVEAVATAR_AVATAR_ID")
        self.voice_id: str | None = os.environ.get("LIVEAVATAR_VOICE_ID") or None
        self.is_sandbox: bool = (
            os.environ.get("LIVEAVATAR_SANDBOX", "false").lower() == "true"
        )
        self.session_id: str | None = None
        self.session_token: str | None = None
        self.livekit_url: str | None = None
        self.livekit_client_token: str | None = None
        self.ws_url: str | None = None
        self.max_duration_seconds: int | None = None
        self._client = httpx.AsyncClient(timeout=30.0)

    async def create_session(self) -> dict[str, Any]:
        token_body: dict[str, Any] = {
            "mode": "LITE",
            "avatar_id": self.avatar_id,
            "is_sandbox": self.is_sandbox,
        }
        if self.voice_id:
            token_body["avatar_persona"] = {"voice_id": self.voice_id, "language": "en"}
        r1 = await self._client.post(
            f"{API_BASE}/sessions/token",
            headers={"X-Api-Key": self.api_key},
            json=token_body,
        )
        r1.raise_for_status()
        td = r1.json()["data"]
        self.session_id = td["session_id"]
        self.session_token = td["session_token"]
        r2 = await self._client.post(
            f"{API_BASE}/sessions/start",
            headers={"Authorization": f"Bearer {self.session_token}"},
            json={},
        )
        r2.raise_for_status()
        sd = r2.json()["data"]
        self.livekit_url = sd["livekit_url"]
        self.livekit_client_token = sd["livekit_client_token"]
        self.ws_url = sd.get("ws_url")
        self.max_duration_seconds = sd.get("max_session_duration")
        return {
            "session_id": self.session_id,
            "livekit_url": self.livekit_url,
            "livekit_client_token": self.livekit_client_token,
            "ws_url": self.ws_url,
            "max_session_duration": self.max_duration_seconds,
        }

    async def stop(self) -> None:
        if self.session_id and self.session_token:
            try:
                await self._client.post(
                    f"{API_BASE}/sessions/stop",
                    headers={"Authorization": f"Bearer {self.session_token}"},
                    json={"session_id": self.session_id},
                )
            except Exception:
                pass
        self.session_id = None
        self.session_token = None
        self.livekit_url = None
        self.livekit_client_token = None
        await self._client.aclose()
