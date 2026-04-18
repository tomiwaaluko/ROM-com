---
name: liveavatar-api
description: HeyGen LiveAvatar Lite/BYOLLM integration for real-time patient-facing
  rehab companion. Use this skill whenever building, debugging, or extending the
  LiveAvatar client, handling ASR input, wiring the LLM clinical prompt layer,
  or managing avatar latency. Also use when the session narration flow, avatar
  response logic, or ElevenLabs voice output needs to be touched.
---

## What it does
A HeyGen LiveAvatar serves as the patient-facing interface — delivering spoken
instructions, adaptive guidance, and positive reinforcement through a real-time
human-like presence.

## Why a face matters
Stroke/TBI patients frequently have reading deficits, attention impairment, and
emotional dysregulation. A calm, responsive human face is more accessible and
clinically meaningful than text, audio, or pre-recorded video.

## Data flow
```
Patient speaks/moves → ASR → LLM (clinical prompt layer) → LiveAvatar Lite API → avatar responds
```

## Latency budget

| Stage                   | Budget   |
|-------------------------|----------|
| ASR (Whisper/Deepgram)  | < 500ms  |
| LLM response            | < 800ms  |
| Avatar render + stream  | < 700ms  |
| Total E2E               | < 2s     |

## API client skeleton
```python
import httpx
import os

HEYGEN_API_KEY = os.environ["HEYGEN_API_KEY"]
HEYGEN_BASE = "https://api.heygen.com/v1"

async def create_avatar_session(avatar_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{HEYGEN_BASE}/streaming.new",
            headers={"X-Api-Key": HEYGEN_API_KEY},
            json={"avatar_id": avatar_id, "quality": "low", "version": "v2"}
        )
        r.raise_for_status()
        return r.json()  # {session_id, sdp, ice_servers}

async def send_task(session_id: str, text: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{HEYGEN_BASE}/streaming.task",
            headers={"X-Api-Key": HEYGEN_API_KEY},
            json={"session_id": session_id, "text": text, "task_type": "talk"}
        )
        r.raise_for_status()
        return r.json()
```

## Mock fallback (activate when API unavailable)
```python
MOCK_MODE = os.environ.get("MOCK_AVATAR", "false") == "true"

async def send_task_safe(session_id: str, text: str) -> dict:
    if MOCK_MODE:
        print(f"[MOCK AVATAR] Would say: {text}")
        return {"status": "mock_ok"}
    return await send_task(session_id, text)
```

## Clinical prompt layer
Every LLM call for the avatar MUST use this system prompt.
See `skills/clinical_prompt_guardrails.md` for the full shared prefix.

## Reinforcement style
Specific and grounded — not generic praise:
- ✅ GOOD: "You held that two seconds — up from one last session."
- ❌ BAD: "Great job! Keep it up!"

## ASR wiring (Phase 3)
```python
import whisper

model = whisper.load_model("base")

def transcribe(audio_path: str) -> str:
    result = model.transcribe(audio_path)
    return result["text"]

# Deepgram alternative (lower latency):
# from deepgram import Deepgram
# dg = Deepgram(os.environ["DEEPGRAM_API_KEY"])
# response = await dg.transcription.prerecorded({"buffer": audio, "mimetype": "audio/wav"})
```

## Build risks
- Confirm LiveAvatar API access on-site at H0
- BYOLLM mode requires separate LLM endpoint config — test this at H0 before H4
- If latency > 2s: reduce LLM max_tokens, switch to Deepgram over Whisper,
  lower avatar quality tier to "low"
- Fallback: pre-generate the 5 most common cues via ElevenLabs and play cached audio
