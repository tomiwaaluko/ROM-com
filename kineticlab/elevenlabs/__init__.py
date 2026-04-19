"""ElevenLabs integration package — TTS streaming for avatar voice output."""
from kineticlab.elevenlabs.client import ElevenLabsTTSClient, MockTTSClient, get_tts_client

__all__ = ["get_tts_client", "ElevenLabsTTSClient", "MockTTSClient"]
