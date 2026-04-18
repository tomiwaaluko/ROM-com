import time
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
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
