import asyncio
import time
import logging
import os
import subprocess
import sys
from contextlib import asynccontextmanager
from datetime import date, timedelta
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from schemas import GestureMessage
from connection_manager import manager

from kineticlab.photon.router import router as photon_router

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

START_TIME = time.time()
_calibrate_pending: bool = False
_calibrate_user: str = "user"


@asynccontextmanager
async def lifespan(application: FastAPI):
    mongo_uri = os.environ.get("MONGODB_URI", "")
    if mongo_uri:
        application.state.mongo = AsyncIOMotorClient(mongo_uri)
        application.state.db = application.state.mongo["kineticlab"]
        logger.info("MongoDB connected")
    else:
        application.state.mongo = None
        application.state.db = None
        logger.warning("MONGODB_URI not set — running without MongoDB")

    # Start Photon daily outreach scheduler (disabled when MOCK_PHOTON=1)
    scheduler_task = None
    if os.environ.get("MOCK_PHOTON", "1") != "1":
        from kineticlab.photon.scheduler import run_scheduler
        scheduler_task = asyncio.create_task(run_scheduler())
        logger.info("Photon scheduler started — daily outreach at 08:00")
    else:
        logger.info("MOCK_PHOTON=1 — Photon scheduler disabled")

    yield

    if scheduler_task:
        scheduler_task.cancel()
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass
        logger.info("Photon scheduler stopped")

    if application.state.mongo:
        application.state.mongo.close()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:3000"],
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
    g = gesture.model_dump()
    ts = time.time()
    await manager.broadcast({"type": "gesture", "payload": g, "timestamp": ts})
    await manager.broadcast({"type": "calibration:angle", "payload": {"angle": round(g["normalized_rom"] * 180, 1)}, "timestamp": ts})
    recognized = g["name"] != "unknown" and g["confidence"] > 0.5
    await manager.broadcast({"type": "calibration:recognized", "payload": {"recognized": recognized}, "timestamp": ts})
    if g.get("fma_total") is not None:
        await manager.broadcast({"type": "session:fma_score", "payload": {"total": g["fma_total"], "severity": g["fma_severity"], "domain_a": g["fma_domain_a"], "domain_c": g["fma_domain_c"], "domain_e": g["fma_domain_e"]}, "timestamp": ts})
    await manager.broadcast({"type": "exercise:normalized_angle", "payload": {"normalized_angle": g["normalized_rom"]}, "timestamp": ts})
    return {"broadcasted_to": len(manager.active_connections)}


@app.post("/internal/calibrate")
async def trigger_calibrate(user_id: str = "user"):
    global _calibrate_pending, _calibrate_user
    _calibrate_pending = True
    _calibrate_user = user_id
    logger.info("Calibration triggered for user: %s", user_id)
    return {"status": "calibration_triggered", "user_id": user_id}


@app.get("/internal/calibrate/pending")
async def check_calibrate_pending():
    global _calibrate_pending, _calibrate_user
    if _calibrate_pending:
        _calibrate_pending = False
        return {"pending": True, "user_id": _calibrate_user}
    return {"pending": False, "user_id": None}

# ----- Audio cache -----
from pathlib import Path
import json as _json

AUDIO_CACHE_DIR = Path("/app/kineticlab/audio/cache")


@app.get("/audio/{cue_name}")
async def get_audio_cue(cue_name: str):
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
# ----- Session endpoints -----

@app.get("/session/{user_id}/latest")
async def get_latest_session(user_id: str):
    db = app.state.db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not configured")
    patient = await db["patients"].find_one({"patient_id": user_id})
    if not patient:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found")
    sessions = patient.get("sessions", [])
    if not sessions:
        raise HTTPException(status_code=404, detail=f"No sessions found for {user_id}")
    latest = max(sessions, key=lambda s: s["timestamp"])
    return {
        "session_id": latest["session_id"],
        "user_id": user_id,
        "timestamp": latest["timestamp"],
        "exercises_completed": latest["exercises_completed"],
        "fma_score": latest["fma_score"],
        "streak": patient.get("streak", 0),
        "last_session_date": patient.get("last_session_date", ""),
    }


@app.post("/session/{user_id}/complete")
async def complete_session(user_id: str, payload: dict):
    db = app.state.db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not configured")
    patient = await db["patients"].find_one({"patient_id": user_id})
    if not patient:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found")

    today = date.today()
    today_str = today.isoformat()
    last_str = patient.get("last_session_date", "")
    current_streak = patient.get("streak", 0)
    try:
        last_date = date.fromisoformat(last_str) if last_str else None
    except ValueError:
        last_date = None

    if last_date is None:
        new_streak = 1
    elif last_date == today:
        new_streak = current_streak
    elif last_date == today - timedelta(days=1):
        new_streak = current_streak + 1
    else:
        new_streak = 1

    new_session = {
        "session_id": payload.get("session_id", ""),
        "timestamp": int(time.time()),
        "exercises_completed": payload.get("exercises_completed", []),
        "fma_score": payload.get("fma_score", {}),
    }

    await db["patients"].update_one(
        {"patient_id": user_id},
        {
            "$push": {"sessions": new_session},
            "$set": {"last_session_date": today_str, "streak": new_streak},
        },
    )
    logger.info("Session completed for %s, new streak: %d", user_id, new_streak)
    return {"status": "ok", "user_id": user_id, "streak": new_streak}


# ----- Users endpoints -----

@app.get("/users/active")
async def get_active_users():
    db = app.state.db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not configured")
    cursor = db["patients"].find({"active": True}, {"patient_id": 1, "phone": 1, "name": 1, "_id": 0})
    users = []
    async for doc in cursor:
        users.append({"id": doc["patient_id"], "phone": doc["phone"], "name": doc["name"]})
    return users


# ----- Pipeline process management -----

_pipeline_process: subprocess.Popen | None = None
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


@app.post("/pipeline/start")
async def pipeline_start():
    global _pipeline_process
    if _pipeline_process is not None and _pipeline_process.poll() is None:
        return {"status": "already_running", "pid": _pipeline_process.pid}
    _pipeline_process = subprocess.Popen(
        [sys.executable, "pipeline.py"],
        cwd=_REPO_ROOT,
    )
    logger.info("Pipeline started (pid=%d)", _pipeline_process.pid)
    return {"status": "started", "pid": _pipeline_process.pid}


@app.post("/pipeline/stop")
async def pipeline_stop():
    global _pipeline_process
    if _pipeline_process is None or _pipeline_process.poll() is not None:
        _pipeline_process = None
        return {"status": "not_running"}
    _pipeline_process.terminate()
    try:
        _pipeline_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        _pipeline_process.kill()
    pid = _pipeline_process.pid
    _pipeline_process = None
    logger.info("Pipeline stopped (pid=%d)", pid)
    return {"status": "stopped", "pid": pid}


@app.get("/pipeline/status")
async def pipeline_status():
    if _pipeline_process is None or _pipeline_process.poll() is not None:
        return {"running": False}
    return {"running": True, "pid": _pipeline_process.pid}
