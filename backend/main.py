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
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong", "payload": {}, "timestamp": time.time()})
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