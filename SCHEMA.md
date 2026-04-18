# KineticLab WebSocket Schema v1

Backend: `ws://localhost:8000/ws`
All messages are JSON with shape: `{type, payload, timestamp}`

---

## Client → Server

| Type | Payload | Purpose |
|---|---|---|
| `ping` | `{}` | Health check — server replies with `pong` |
| `calibration_start` | `{user_id: str}` | Begin ROM baseline capture |
| `calibration_complete` | `{rom_profile: {joint: [min, max]}}` | Finalize user's ROM |
| `exercise_start` | `{exercise: "target_reach" \| "trajectory_trace" \| "mirror_therapy" \| "forearm_rotation" \| "bimanual"}` | Begin exercise session |
| `exercise_stop` | `{}` | End current exercise |

## Server → Client

| Type | Payload | Purpose |
|---|---|---|
| `pong` | `{}` | Reply to ping |
| `gesture` | `{name: str, confidence: float (0-1), normalized_rom: float (0-1)}` | Classified gesture from pose pipeline |
| `rom_update` | `{joint: str, min: float, max: float}` | Live ROM baseline update during calibration |
| `exercise_event` | `{target_hit: str, accuracy: float (0-1)}` | Exercise milestone (target extinguished, path traced) |
| `fma_score` | `{domain_a: int, domain_c: int, domain_e: int, total: int}` | End-of-session FMA-UE subscale |
| `error` | `{code: str, message: str}` | Error codes: LANDMARK_LOST, LOW_CONFIDENCE, CALIBRATION_FAILED |

---

## Internal HTTP endpoints (not WebSocket)

`POST /internal/gesture` — Andrea's classifier pushes gesture predictions here.
Body matches the `gesture` payload above.
Server broadcasts to all connected WebSocket clients.

`GET /health` — Returns `{uptime_seconds, active_connections}` for debugging.

---

## Change control

Schema is frozen after Phase 1 (H6). Changes after that require sign-off from both backend (Sakshi) and frontend (Tomiwa). Breaking changes require bumping to v2 and updating this file.
