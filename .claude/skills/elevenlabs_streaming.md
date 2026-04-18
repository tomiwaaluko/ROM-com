---
name: elevenlabs-streaming
description: ElevenLabs streaming TTS for real-time avatar voice output. Use whenever
  generating or streaming voice audio for the LiveAvatar companion, pre-generating
  session narration cues, debugging audio latency, or choosing between streaming
  and cached audio fallback strategies.
---

## What it does
Converts LLM text output to natural speech streamed directly to the avatar in
real time. Used by the LiveAvatar track to give the companion a warm, human voice.

## Streaming client
```python
import httpx
import os

ELEVEN_API_KEY = os.environ["ELEVEN_API_KEY"]
VOICE_ID = os.environ.get("ELEVEN_VOICE_ID", "your_voice_id_here")

async def stream_tts(text: str):
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/stream"
    headers = {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "text": text,
        "model_id": "eleven_turbo_v2",   # lowest latency model
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.8}
    }
    async with httpx.AsyncClient() as client:
        async with client.stream("POST", url, headers=headers, json=payload) as r:
            async for chunk in r.aiter_bytes():
                yield chunk   # pipe directly to HeyGen avatar audio input
```

## Pre-generated audio cues (for demo stability)
Pre-generate these 5 cues before H8 and cache as .mp3 files.
Play cached audio when text matches — eliminates ElevenLabs latency for known phrases.

```python
CUES = [
    "Let's begin your session.",
    "Great reach — keep going.",
    "Now let's calibrate your range of motion.",
    "Excellent. Your score has been recorded.",
    "Session complete. Well done today.",
]

async def pre_generate_cues():
    import os
    os.makedirs("cues", exist_ok=True)
    for i, text in enumerate(CUES):
        audio = b""
        async for chunk in stream_tts(text):
            audio += chunk
        with open(f"cues/cue_{i}.mp3", "wb") as f:
            f.write(audio)
        print(f"Generated: cue_{i}.mp3 — '{text}'")
```

## Cached playback fallback
```python
import difflib

def get_cached_cue(text: str) -> str | None:
    """Return path to cached .mp3 if text closely matches a known cue."""
    for i, cue in enumerate(CUES):
        ratio = difflib.SequenceMatcher(None, text.lower(), cue.lower()).ratio()
        if ratio > 0.85:
            return f"cues/cue_{i}.mp3"
    return None

async def speak(text: str):
    cached = get_cached_cue(text)
    if cached:
        play_audio_file(cached)   # implement with pygame or subprocess ffplay
    else:
        async for chunk in stream_tts(text):
            stream_to_avatar(chunk)
```

## Latency note
`eleven_turbo_v2` adds ~300–500ms. If total E2E > 2s:
1. Switch to cached cues for all known phrases
2. Reduce LLM max_tokens to shorten response text
3. As last resort: use browser Web Audio API beep (440Hz) as placeholder
