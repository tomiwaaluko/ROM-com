import time
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from schemas import GestureMessage
from connection_manager import manager

from kineticlab.photon.router import router as photon_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()
START_TIME = time.time()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Hardcoded demo patient context for the LiveAvatar conversation demo.
# Rough mood + missed yesterday → triggers Gemini's empathy-first clinical response.
# Post-demo, this is replaced by MongoDB SessionContext lookup per user_id.
DEMO_SESSION_CONTEXT = {
    "patient_id": "demo_maria",
    "last_session_date": "2026-04-16",
    "last_exercise": "target_reach",
    "streak_days": 2,
    "fma_subscale_score": 28.0,
    "mood_today": "Rough",
    "missed_yesterday": True,
}


# Mount Sreekar's Photon iMessage webhook router (handles POST /photon/inbound)
app.include_router(photon_router)

@app.get("/")
async def root():
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {
        "uptime_seconds": round(time.time() - START_TIME, 2),
        "active_connections": len(manager.active_connections),
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    logger.info("Client connected. Total: %d", len(manager.active_connections))
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "payload": {}, "timestamp": time.time()})
            elif msg_type == "avatar_narrate":
                # Scripted narration stage: look up text for the stage name,
                # send back as avatar_response so frontend pushes through LiveKit data channel.
                payload_in = data.get("payload") or {}
                stage = payload_in.get("stage", "")
                kwargs = {}
                if "section_name" in payload_in:
                    kwargs["section_name"] = payload_in["section_name"]
                try:
                    from kineticlab.narration import get_script
                    text = get_script(stage, **kwargs)
                except KeyError as exc:
                    await websocket.send_json({
                        "type": "avatar_narrate_error",
                        "payload": {"code": "UNKNOWN_STAGE", "message": str(exc)},
                        "timestamp": time.time(),
                    })
                    continue
                await websocket.send_json({
                    "type": "avatar_response",
                    "payload": {"text": text, "stage": stage},
                    "timestamp": time.time(),
                })
                logger.info("Narration sent: stage=%s (len=%d)", stage, len(text))
            elif msg_type == "patient_speech":
                # Glue: patient_speech → Gemini clinical_response → avatar_response
                patient_text = (data.get("payload") or {}).get("text", "").strip()
                if not patient_text:
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"code": "EMPTY_SPEECH", "message": "patient_speech payload missing text"},
                        "timestamp": time.time(),
                    })
                    continue
                try:
                    from kineticlab.prompts.system_prompt import clinical_response
                    reply = await clinical_response(DEMO_SESSION_CONTEXT, patient_text)
                except Exception as exc:
                    logger.exception("clinical_response failed")
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"code": "GEMINI_ERROR", "message": str(exc)},
                        "timestamp": time.time(),
                    })
                    continue
                await websocket.send_json({
                    "type": "avatar_response",
                    "payload": {"text": reply, "patient_said": patient_text},
                    "timestamp": time.time(),
                })
                logger.info("Gemini reply sent (len=%d)", len(reply))
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("Client disconnected. Total: %d", len(manager.active_connections))


@app.post("/internal/gesture")
async def receive_gesture(gesture: GestureMessage):
    message = {
        "type": "gesture",
        "payload": gesture.model_dump(),
        "timestamp": time.time(),
    }
    await manager.broadcast(message)
    return {"broadcasted_to": len(manager.active_connections)}

# ----- Audio cache -----
from pathlib import Path
import json as _json

AUDIO_CACHE_DIR = Path("/app/kineticlab/audio/cache")


@app.get("/audio/{cue_name}")
async def get_audio_cue(cue_name: str):
    """Serve a pre-generated ElevenLabs MP3 from the audio cache.

    Frontend plays via: <audio src="http://localhost:8000/audio/cue_1.mp3" />
    Zero live TTS calls at runtime — all MP3s pre-generated offline.
    """
    if cue_name.startswith("cue_") and "." not in cue_name:
        cue_name = f"{cue_name}.mp3"

    if not cue_name.startswith("cue_") or not cue_name.endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Invalid cue name")

    file_path = AUDIO_CACHE_DIR / cue_name
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"Cue not found: {cue_name}")

    return FileResponse(file_path, media_type="audio/mpeg", filename=cue_name)


@app.get("/audio")
async def list_audio_cues():
    """List available audio cues with transcripts (for frontend discovery)."""
    manifest_path = AUDIO_CACHE_DIR / "manifest.json"
    if not manifest_path.exists():
        return {"cues": {}, "note": "Run generate_audio.py to populate"}
    return {"cues": _json.loads(manifest_path.read_text())}

# ----- LiveAvatar session lifecycle -----
from kineticlab.liveavatar.client import LiveAvatarClient

_avatar_clients: dict[str, LiveAvatarClient] = {}


@app.post("/avatar/start")
async def avatar_start():
    client = LiveAvatarClient()
    try:
        session = await client.create_session()
    except Exception as exc:
        try:
            await client.stop()
        except Exception:
            pass
        logger.error("LiveAvatar create_session failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"LiveAvatar upstream error: {exc}")
    _avatar_clients[session["session_id"]] = client
    logger.info("LiveAvatar session started: %s", session["session_id"])
    return session


@app.post("/avatar/stop")
async def avatar_stop(payload: dict):
    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id in body")
    client = _avatar_clients.pop(session_id, None)
    if client is None:
        return {"session_id": session_id, "stopped": False, "note": "No active session in registry"}
    try:
        await client.stop()
    except Exception as exc:
        logger.warning("avatar_stop: client.stop() raised: %s", exc)
    logger.info("LiveAvatar session stopped: %s", session_id)
    return {"session_id": session_id, "stopped": True}


@app.get("/avatar/status")
async def avatar_status():
    return {
        "active_sessions": list(_avatar_clients.keys()),
        "count": len(_avatar_clients),
    }


# ----- Scribe transcribe (patient speech → text) -----
from fastapi import UploadFile, File


@app.post("/avatar/transcribe")
async def avatar_transcribe(file: UploadFile = File(...)):
    """Transcribe a patient audio clip via ElevenLabs Scribe.

    Body: multipart form with 'file' field containing audio (MP3/WAV/WebM).
    Returns: {"text": "transcribed speech"}

    Frontend flow:
      1. Record mic audio with MediaRecorder (any format Scribe accepts)
      2. POST blob here as multipart
      3. Receive transcript
      4. Send transcript to /ws as {type: "patient_speech", payload: {text}}
    """
    import httpx
    import os

    api_key = os.environ.get("ELEVEN_API_KEY") or os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ElevenLabs API key not configured")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    content_type = file.content_type or "audio/mpeg"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": api_key},
                files={"file": (file.filename or "audio", audio_bytes, content_type)},
                data={"model_id": "scribe_v1", "language_code": "en"},
            )
            resp.raise_for_status()
            payload = resp.json()
        except httpx.HTTPError as exc:
            logger.warning("Scribe request failed: %s", exc)
            raise HTTPException(status_code=502, detail=f"Scribe upstream error: {exc}")

    text = (payload.get("text") or "").strip()
    logger.info("Transcribed %d bytes → %d chars", len(audio_bytes), len(text))
    return {"text": text}
