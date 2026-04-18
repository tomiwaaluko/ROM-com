"""ASR layer: Deepgram (streaming, preferred) and Whisper (REST fallback)."""
from __future__ import annotations

import asyncio
import io
import logging
import os
import wave
from typing import Awaitable, Callable

import numpy as np

logger = logging.getLogger(__name__)

SILENCE_THRESHOLD = 500
_TranscriptCallback = Callable[[str], Awaitable[None]]

try:
    from deepgram import DeepgramClient, LiveOptions, LiveTranscriptionEvents as _LTE
    _DEEPGRAM_AVAILABLE = True
except ImportError:
    _DEEPGRAM_AVAILABLE = False


def is_silent(chunk: bytes, threshold: int = SILENCE_THRESHOLD) -> bool:
    """Return True if the RMS energy of the PCM chunk is below threshold."""
    audio = np.frombuffer(chunk, dtype=np.int16)
    rms = float(np.sqrt(np.mean(audio.astype(np.float32) ** 2)))
    return rms < threshold


class DeepgramASRClient:
    """Streaming ASR via Deepgram WebSocket (nova-2-medical, ≤300ms target).

    Calls on_transcript(text) when a final utterance is detected.
    """

    def __init__(self, on_transcript: _TranscriptCallback) -> None:
        if not _DEEPGRAM_AVAILABLE:
            raise RuntimeError("deepgram-sdk not installed. Run: pip install deepgram-sdk")
        api_key = os.environ.get("DEEPGRAM_API_KEY")
        if not api_key:
            raise RuntimeError("Missing required environment variable: DEEPGRAM_API_KEY.")
        self.on_transcript = on_transcript
        self._dg = DeepgramClient(api_key)
        self._connection = None

    async def connect(self) -> None:
        """Open the Deepgram streaming WebSocket. Call once at session start."""
        options = LiveOptions(
            model="nova-2-medical",
            language="en-US",
            smart_format=True,
            utterance_end_ms=1000,
            interim_results=False,
            punctuate=True,
        )
        self._connection = self._dg.listen.asyncwebsocket.v("1")
        self._connection.on(_LTE.Transcript, self._on_message)
        await self._connection.start(options)

    async def send_audio(self, chunk: bytes) -> None:
        """Feed a raw PCM chunk (16kHz mono 16-bit) into the stream."""
        if self._connection:
            await self._connection.send(chunk)

    async def _on_message(self, _self, result, **kwargs) -> None:
        sentence: str = result.channel.alternatives[0].transcript
        if result.is_final and sentence.strip():
            logger.debug("[ASR] Final transcript: %s", sentence)
            await self.on_transcript(sentence)

    async def close(self) -> None:
        """Finish the Deepgram streaming session."""
        if self._connection:
            await self._connection.finish()


def _to_wav(raw_pcm: bytes, sample_rate: int = 16000) -> io.BytesIO:
    """Wrap raw PCM bytes in a WAV container for Whisper."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(raw_pcm)
    buf.seek(0)
    return buf


class WhisperASRClient:
    """Fallback ASR via OpenAI Whisper REST API (~300–600ms per utterance).

    Buffers audio and transcribes when silence is detected (RMS VAD).
    """

    def __init__(self, on_transcript: _TranscriptCallback) -> None:
        from openai import AsyncOpenAI

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("Missing required environment variable: OPENAI_API_KEY.")
        self.on_transcript = on_transcript
        self._client = AsyncOpenAI(api_key=api_key)
        self._buffer: list[bytes] = []
        self._silent_chunks: int = 0
        self._silence_limit: int = 6  # ~800ms at 128ms/chunk

    async def connect(self) -> None:
        """No persistent connection needed for REST."""

    async def send_audio(self, chunk: bytes) -> None:
        """Buffer audio; transcribe and fire on_transcript on silence."""
        self._buffer.append(chunk)
        if is_silent(chunk):
            self._silent_chunks += 1
        else:
            self._silent_chunks = 0
        if self._silent_chunks >= self._silence_limit and len(self._buffer) > 10:
            await self._transcribe_and_reset()

    async def _transcribe_and_reset(self) -> None:
        audio_data = b"".join(self._buffer)
        self._buffer = []
        self._silent_chunks = 0
        wav_buf = _to_wav(audio_data)
        resp = await self._client.audio.transcriptions.create(
            model="whisper-1",
            file=("audio.wav", wav_buf, "audio/wav"),
            language="en",
        )
        text = resp.text.strip()
        if text and text != "[BLANK_AUDIO]" and len(text.split()) >= 3:
            logger.debug("[ASR Whisper] Transcript: %s", text)
            await self.on_transcript(text)

    async def close(self) -> None:
        """Flush any remaining buffered audio."""
        if self._buffer:
            await self._transcribe_and_reset()


class MockASRClient:
    """Returns a canned transcript after 200ms. Use with MOCK_MODE=true."""

    def __init__(self, on_transcript: _TranscriptCallback) -> None:
        self.on_transcript = on_transcript

    async def connect(self) -> None:
        """No-op."""

    async def send_audio(self, chunk: bytes) -> None:
        """Simulate 200ms ASR latency then fire a canned transcript."""
        await asyncio.sleep(0.2)
        await self.on_transcript("I'm ready to start the exercise.")

    async def close(self) -> None:
        """No-op."""


def get_asr_client(on_transcript: _TranscriptCallback) -> DeepgramASRClient | WhisperASRClient | MockASRClient:
    """Return the best available ASR client.

    Priority: MOCK_MODE=true → Deepgram (DEEPGRAM_API_KEY) → Whisper (OPENAI_API_KEY).
    Raises RuntimeError if no credentials are available.
    """
    if os.environ.get("MOCK_MODE", "false").lower() == "true":
        return MockASRClient(on_transcript)
    if os.environ.get("DEEPGRAM_API_KEY"):
        return DeepgramASRClient(on_transcript)
    if os.environ.get("OPENAI_API_KEY"):
        return WhisperASRClient(on_transcript)
    raise RuntimeError(
        "No ASR credentials found. Set DEEPGRAM_API_KEY or OPENAI_API_KEY."
    )
