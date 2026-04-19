"""ElevenLabs TTS streaming client for real-time avatar voice output."""
from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
_DEFAULT_MODEL = "eleven_turbo_v2_5"   # ~300ms latency, lowest-latency TTS model
_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"  # Rachel (ElevenLabs built-in)


class ElevenLabsTTSClient:
    """Streaming TTS via ElevenLabs REST API.

    Calls the /stream endpoint and collects MP3 chunks into a single bytes
    object per utterance.  Reuses one httpx.AsyncClient for the session.
    """

    def __init__(self) -> None:
        api_key = (
            os.environ.get("ELEVEN_API_KEY")
            or os.environ.get("ELEVENLABS_API_KEY")
        )
        if not api_key:
            raise RuntimeError(
                "Missing required environment variable: ELEVENLABS_API_KEY."
            )
        self._api_key = api_key
        self._voice_id = os.environ.get("ELEVENLABS_VOICE_ID") or _DEFAULT_VOICE
        self._model_id = os.environ.get("ELEVENLABS_MODEL_ID") or _DEFAULT_MODEL
        self._client = httpx.AsyncClient(timeout=30.0)

    async def synthesize(self, text: str) -> bytes:
        """Convert text to speech; returns MP3 bytes (empty bytes on error)."""
        url = _TTS_URL.format(voice_id=self._voice_id)
        headers = {
            "xi-api-key": self._api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        body = {
            "text": text,
            "model_id": self._model_id,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        try:
            chunks: list[bytes] = []
            async with self._client.stream("POST", url, headers=headers, json=body) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_bytes():
                    if chunk:
                        chunks.append(chunk)
            audio = b"".join(chunks)
            logger.debug("[TTS] Synthesized %d bytes for %d chars.", len(audio), len(text))
            return audio
        except httpx.HTTPError as exc:
            logger.error("[TTS] ElevenLabs request failed: %s", exc)
            return b""

    async def close(self) -> None:
        await self._client.aclose()


class MockTTSClient:
    """Returns empty audio bytes. Activated by MOCK_MODE=true."""

    async def synthesize(self, text: str) -> bytes:
        logger.info("[MOCK TTS] Would speak: %s", text)
        return b""

    async def close(self) -> None:
        pass


def get_tts_client() -> ElevenLabsTTSClient | MockTTSClient:
    """Return MockTTSClient if MOCK_MODE=true, else ElevenLabsTTSClient."""
    if os.environ.get("MOCK_MODE", "false").lower() == "true":
        return MockTTSClient()
    return ElevenLabsTTSClient()
