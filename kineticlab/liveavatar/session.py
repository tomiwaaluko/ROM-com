"""LiveAvatar pipeline orchestrator: ASR → GPT-4o → HeyGen avatar → WebSocket haptics."""
from __future__ import annotations

import asyncio
import json
import logging
import os

from websockets.exceptions import ConnectionClosed

from kineticlab.liveavatar.asr import get_asr_client
from kineticlab.prompts import clinical_response

logger = logging.getLogger(__name__)

_HELLO = {"type": "hello", "payload": {"client": "sreekar_integrations", "version": "1.0.0"}}
_FATAL_CODES = {"SESSION_CONFLICT", "AUTH_EXPIRED"}


def _require_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(f"Missing required environment variable: {key}.")
    return val


class KineticLabWebSocket:
    """Persistent WebSocket to Sakshi's FastAPI backend.

    Handles HELLO handshake, inbound message dispatch, reconnect with exponential
    backoff (max 5 attempts), and AvatarInstruction delivery.
    """

    def __init__(
        self,
        on_session_context,
        on_session_end,
    ) -> None:
        self.url: str = _require_env("WEBSOCKET_URL")
        self.on_session_context = on_session_context
        self.on_session_end = on_session_end
        self._ws = None
        self._running: bool = False

    async def connect(self) -> None:
        """Open the WebSocket and send the HELLO handshake."""
        import websockets

        self._ws = await websockets.connect(self.url)
        await self._send(_HELLO)
        self._running = True
        asyncio.create_task(self._listen())

    async def send_avatar_instruction(
        self,
        patient_id: str,
        instruction_type: str,
        text: str,
        haptic: str | None = None,
        audio_url: str | None = None,
    ) -> None:
        """Send AvatarInstruction so Sakshi's backend can sync Arduino haptics."""
        await self._send({
            "type": "avatar_instruction",
            "payload": {
                "patient_id": patient_id,
                "instruction_type": instruction_type,
                "text": text,
                "audio_url": audio_url,
                "haptic": haptic,
            },
        })

    async def _listen(self) -> None:
        try:
            async for raw in self._ws:
                msg = json.loads(raw)
                match msg.get("type"):
                    case "session_context":
                        await self.on_session_context(msg["payload"])
                    case "session_end":
                        await self.on_session_end(msg["payload"])
                    case "error":
                        await self._handle_error(msg["payload"])
        except ConnectionClosed:
            if self._running:
                await self._reconnect()

    async def _reconnect(self, max_attempts: int = 5) -> None:
        for attempt in range(1, max_attempts + 1):
            wait = 2 ** attempt
            logger.warning("WebSocket disconnected. Reconnect attempt %d in %ds.", attempt, wait)
            await asyncio.sleep(wait)
            try:
                await self.connect()
                logger.info("WebSocket reconnected.")
                return
            except Exception as exc:
                logger.error("Reconnect attempt %d failed: %s", attempt, exc)
        logger.critical("WebSocket reconnect failed after 5 attempts. Pipeline halted.")
        self._running = False

    async def _handle_error(self, payload: dict) -> None:
        code: str = payload.get("code", "UNKNOWN")
        fatal: bool = payload.get("fatal", False)
        logger.error("Server error [%s]: %s", code, payload.get("message"))
        if code == "BACKEND_OVERLOAD":
            await asyncio.sleep(5)
        elif fatal or code in _FATAL_CODES:
            self._running = False
            raise RuntimeError(f"Fatal server error: {code}")

    async def _send(self, message: dict) -> None:
        if self._ws:
            await self._ws.send(json.dumps(message))

    async def close(self) -> None:
        """Close the WebSocket connection cleanly."""
        self._running = False
        if self._ws:
            await self._ws.close()


class LiveAvatarSession:
    """Full LiveAvatar pipeline orchestrator.

    Wires: WebSocket SessionContext → ASR → clinical_response (GPT-4o) →
    HeyGen avatar.speak() → AvatarInstruction back over WebSocket.

    Usage::

        session = LiveAvatarSession()
        await session.start()          # blocks — runs until session_end or cancel
        await session.stop()
    """

    def __init__(self) -> None:
        self._ws = KineticLabWebSocket(
            on_session_context=self._begin_session,
            on_session_end=self._end_session,
        )
        self._avatar = None
        self._asr = None
        self._session_context: dict | None = None

    async def start(self) -> None:
        """Connect to the backend WebSocket and await a session_context message."""
        await self._ws.connect()
        logger.info("[Session] Waiting for session_context from backend.")

    async def _begin_session(self, session_context: dict) -> None:
        """Called when the backend pushes a new session_context."""
        self._session_context = session_context
        patient_id = session_context.get("patient_id", "unknown")
        logger.info("[Session] Starting session for patient %s.", patient_id)

        from kineticlab.liveavatar import get_avatar_client
        self._avatar = get_avatar_client()
        await self._avatar.connect()

        self._asr = get_asr_client(self._on_transcript)
        await self._asr.connect()
        logger.info("[Session] Pipeline ready — ASR and avatar connected.")

    async def _on_transcript(self, text: str) -> None:
        """ASR callback: runs the full LLM → avatar → WebSocket haptic chain."""
        if not self._session_context or not self._avatar:
            logger.warning("[Session] Transcript received before session_context — ignoring.")
            return
        logger.debug("[Session] Transcript: %s", text)
        response = await clinical_response(self._session_context, text)
        await self._avatar.speak(response)
        patient_id: str = self._session_context.get("patient_id", "unknown")
        await self._ws.send_avatar_instruction(
            patient_id=patient_id,
            instruction_type="speak",
            text=response,
            haptic="buzz",
        )

    async def _end_session(self, payload: dict) -> None:
        """Called when the backend signals session_end."""
        patient_id = payload.get("patient_id", "unknown")
        duration = payload.get("session_duration_sec", 0)
        logger.info("[Session] Session ended for %s (duration: %ds).", patient_id, duration)
        await self.stop()

    async def stop(self) -> None:
        """Shut down ASR, avatar, and WebSocket cleanly."""
        if self._asr:
            await self._asr.close()
            self._asr = None
        if self._avatar:
            await self._avatar.close()
            self._avatar = None
        await self._ws.close()
        logger.info("[Session] All pipeline components closed.")
