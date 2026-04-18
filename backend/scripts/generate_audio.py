"""
One-time script to pre-generate ElevenLabs narration MP3s.
Saves files to kineticlab/audio/cache/cue_{N}.mp3.

Run from repo root inside the backend venv:
    python backend/scripts/generate_audio.py

Or inside the Docker backend container:
    docker compose exec backend python /app/backend/scripts/generate_audio.py

Idempotent: skips cues that already have a matching MP3 on disk.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Load env from repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env.development")

ELEVEN_API_KEY = os.environ.get("ELEVEN_API_KEY") or os.environ.get("ELEVENLABS_API_KEY")
VOICE_ID = os.environ.get("ELEVEN_VOICE_ID") or os.environ.get(
    "ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"
)

CACHE_DIR = REPO_ROOT / "kineticlab" / "audio" / "cache"

# Exactly the 5 cues from .claude/skills/elevenlabs_streaming.md
CUES = [
    "Take your time. We'll begin whenever you're ready.",
    "That's wonderful. Keep going at your own pace.",
    "Let's gently find your comfortable range of motion.",
    "Beautiful work. Everything's saved.",
    "You did so well today. Rest now.",
]


async def generate_cue(index: int, text: str) -> None:
    out_path = CACHE_DIR / f"cue_{index}.mp3"
    if out_path.exists() and out_path.stat().st_size > 0:
        print(f"⏭  cue_{index}.mp3 exists, skipping ({out_path.stat().st_size} bytes)")
        return

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/stream"
    headers = {"xi-api-key": ELEVEN_API_KEY, "Content-Type": "application/json"}
    payload = {
        "text": text,
        "model_id": "eleven_turbo_v2",
        "voice_settings": {
    "stability": 0.75,
    "similarity_boost": 0.85,
    "style": 0.2,
    "use_speaker_boost": True,
},
    }

    print(f"→ generating cue_{index}: {text!r}")
    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as r:
            if r.status_code != 200:
                body = await r.aread()
                print(f"✗ cue_{index} failed: HTTP {r.status_code} — {body.decode()[:200]}")
                return
            audio = b""
            async for chunk in r.aiter_bytes():
                audio += chunk

    out_path.write_bytes(audio)
    print(f"✓ cue_{index}.mp3 saved ({len(audio)} bytes)")


async def main() -> None:
    if not ELEVEN_API_KEY:
        print("✗ ELEVEN_API_KEY not set in .env.development")
        sys.exit(1)

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Cache dir: {CACHE_DIR}")
    print(f"Voice ID:  {VOICE_ID}")
    print(f"Generating {len(CUES)} cues...\n")

    for i, text in enumerate(CUES):
        await generate_cue(i, text)

    # Write a manifest so the server knows cue name → file + transcript
    manifest = {
        f"cue_{i}": {"file": f"cue_{i}.mp3", "text": text}
        for i, text in enumerate(CUES)
    }
    import json
    (CACHE_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\n✓ manifest.json written with {len(manifest)} entries")


if __name__ == "__main__":
    asyncio.run(main())