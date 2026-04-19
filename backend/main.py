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

_calibrate_pending: bool = False
_calibrate_user: str = "user"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(photon_router)

@app.get("/")
async def root():
    return {"status": "ok"}

@app.get("/health")
async def health():
    return {"uptime_seconds": round(time.time() - START_TIME, 2), "active_connections": len(manager.active_connections)}

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
