"""Shared pytest configuration: MOCK_MODE=true, all real API keys cleared."""
import pytest

_API_KEYS = [
    "HEYGEN_API_KEY",
    "HEYGEN_AVATAR_ID",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "DEEPGRAM_API_KEY",
    "PHOTON_API_KEY",
    "PHOTON_SENDER_ID",
    "MONGO_URI",
    "WEBSOCKET_URL",
]


@pytest.fixture(autouse=True)
def mock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force MOCK_MODE=true and clear all real API keys for every test."""
    monkeypatch.setenv("MOCK_MODE", "true")
    for key in _API_KEYS:
        monkeypatch.delenv(key, raising=False)
