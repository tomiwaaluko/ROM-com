"""E2E tests for the LiveAvatar pipeline. All tests run with MOCK_MODE=true."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

VALID_CONTEXT: dict = {
    "patient_id": "pt_test001",
    "last_session_date": "2026-04-17T14:00:00Z",
    "last_exercise": "Target Reach",
    "streak_days": 3,
    "fma_subscale_score": 28.0,
    "mood_today": "Good",
    "missed_yesterday": False,
}


# ---------------------------------------------------------------------------
# Task G — LiveAvatar client tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_avatar_client_mock_connect() -> None:
    """MockLiveAvatarClient.connect() must return a non-empty session_id string."""
    from kineticlab.liveavatar.mock import MockLiveAvatarClient

    client = MockLiveAvatarClient()
    session_id = await client.connect()

    assert isinstance(session_id, str)
    assert session_id


@pytest.mark.asyncio
async def test_avatar_client_mock_speak() -> None:
    """MockLiveAvatarClient.speak() must complete without raising after connect()."""
    from kineticlab.liveavatar.mock import MockLiveAvatarClient

    client = MockLiveAvatarClient()
    await client.connect()
    await client.speak("Hello, let's begin your session.")  # must not raise


@pytest.mark.asyncio
async def test_asr_mock_transcript() -> None:
    """MockASRClient must invoke the on_transcript callback with a non-empty string."""
    from kineticlab.liveavatar.asr import MockASRClient

    received: list[str] = []

    async def on_transcript(text: str) -> None:
        received.append(text)

    client = MockASRClient(on_transcript)
    await client.connect()
    await client.send_audio(b"fake-audio-bytes")
    await asyncio.sleep(0.3)  # allow the 200ms mock delay to complete

    assert received, "on_transcript was never called"
    assert all(isinstance(t, str) and t for t in received)


@pytest.mark.asyncio
async def test_clinical_response_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    """clinical_response() must return a guardrail-compliant string via a mocked Gemini."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-dummy-not-real")

    canned = "Good session today. You can rest anytime."

    class _Response:
        text = canned

    mock_model = MagicMock()
    mock_model.generate_content_async = AsyncMock(return_value=_Response())

    with (
        patch("kineticlab.prompts.system_prompt.genai.configure"),
        patch(
            "kineticlab.prompts.system_prompt.genai.GenerativeModel",
            return_value=mock_model,
        ),
    ):
        from kineticlab.prompts import clinical_response

        result = await clinical_response(VALID_CONTEXT, "I'm ready")

    assert result, "clinical_response returned an empty string"
    forbidden = ["failed", "missed", "should have", "didn't"]
    for word in forbidden:
        assert word not in result.lower(), f"Forbidden word '{word}' found in response"


def test_build_user_message_valid() -> None:
    """build_user_message() must include patient_id and exercise in the formatted string."""
    from kineticlab.prompts import build_user_message

    msg = build_user_message(VALID_CONTEXT, "I'm feeling okay today.")

    assert VALID_CONTEXT["patient_id"] in msg
    assert VALID_CONTEXT["last_exercise"] in msg


def test_build_user_message_missing_key() -> None:
    """build_user_message() must raise ValueError when a required key is absent."""
    from kineticlab.prompts import build_user_message

    incomplete = {k: v for k, v in VALID_CONTEXT.items() if k != "streak_days"}

    with pytest.raises(ValueError, match="streak_days"):
        build_user_message(incomplete, "I'm ready")


@pytest.mark.asyncio
async def test_session_latency_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pipeline wiring: _on_transcript → clinical_response → avatar.speak → WS instruction."""
    monkeypatch.setenv("WEBSOCKET_URL", "ws://localhost:9999")
    monkeypatch.setenv("OPENAI_API_KEY", "test-dummy-not-real")

    from kineticlab.liveavatar.mock import MockLiveAvatarClient
    from kineticlab.liveavatar.session import LiveAvatarSession

    session = LiveAvatarSession()
    session._session_context = VALID_CONTEXT

    avatar = MockLiveAvatarClient()
    await avatar.connect()
    session._avatar = avatar

    speak_calls: list[str] = []
    _original_speak = avatar.speak

    async def _tracked_speak(text: str) -> None:
        speak_calls.append(text)
        await _original_speak(text)

    avatar.speak = _tracked_speak
    session._ws.send_avatar_instruction = AsyncMock()

    with patch(
        "kineticlab.liveavatar.session.clinical_response",
        new=AsyncMock(return_value="Great reach. You can rest anytime."),
    ):
        await session._on_transcript("I'm ready to start.")

    assert speak_calls, "avatar.speak was never called — pipeline wiring is broken"
    session._ws.send_avatar_instruction.assert_called_once()


@pytest.mark.asyncio
async def test_on_transcript_llm_error_uses_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """When clinical_response raises, _on_transcript must use the fallback string."""
    monkeypatch.setenv("WEBSOCKET_URL", "ws://localhost:9999")

    from kineticlab.liveavatar.mock import MockLiveAvatarClient
    from kineticlab.liveavatar.session import LiveAvatarSession

    session = LiveAvatarSession()
    session._session_context = VALID_CONTEXT

    avatar = MockLiveAvatarClient()
    await avatar.connect()
    session._avatar = avatar

    speak_calls: list[str] = []
    _original_speak = avatar.speak

    async def _tracked_speak(text: str) -> bytes:
        speak_calls.append(text)
        return await _original_speak(text)

    avatar.speak = _tracked_speak
    session._ws.send_avatar_instruction = AsyncMock()

    with patch(
        "kineticlab.liveavatar.session.clinical_response",
        new=AsyncMock(side_effect=RuntimeError("Gemini down")),
    ):
        await session._on_transcript("I'm ready to start.")

    assert speak_calls, "avatar.speak was not called with fallback text"
    assert "rest" in speak_calls[0].lower()


@pytest.mark.asyncio
async def test_e2e_latency_sla(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mock ASR-to-avatar pipeline must stay under the 2000ms latency SLA."""
    import time

    monkeypatch.setenv("WEBSOCKET_URL", "ws://localhost:9999")

    from kineticlab.liveavatar.mock import MockLiveAvatarClient
    from kineticlab.liveavatar.session import LiveAvatarSession

    async def _mock_clinical_response(*_args) -> str:
        await asyncio.sleep(0.3)
        return "Good effort. You can rest anytime."

    async def _mock_speak(_text: str) -> bytes:
        await asyncio.sleep(0.1)
        return b""

    session = LiveAvatarSession()
    session._session_context = VALID_CONTEXT

    avatar = MockLiveAvatarClient()
    await avatar.connect()
    session._avatar = avatar
    session._avatar.speak = AsyncMock(side_effect=_mock_speak)
    session._ws.send_avatar_instruction = AsyncMock()

    with patch(
        "kineticlab.liveavatar.session.clinical_response",
        new=AsyncMock(side_effect=_mock_clinical_response),
    ):
        start = time.perf_counter()
        await session._on_transcript("I'm ready")
        elapsed_ms = (time.perf_counter() - start) * 1000

    if elapsed_ms > 2000:
        pytest.fail(f"E2E latency {elapsed_ms:.0f}ms exceeds 2000ms SLA")
