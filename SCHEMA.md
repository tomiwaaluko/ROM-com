# KineticLab WebSocket Schema v1.1

Backend: `ws://localhost:8000/ws`
All WebSocket messages are JSON with shape: `{type, payload, timestamp}`

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
| `audio_cue` | `{name: str, url: str}` | Trigger frontend to play a cached narration MP3 (Phase 2) |
| `error` | `{code: str, message: str}` | Error codes: LANDMARK_LOST, LOW_CONFIDENCE, CALIBRATION_FAILED |

---

## Internal HTTP endpoints

### Live
- `POST /internal/gesture` — Andrea's classifier pushes gesture predictions here. Body matches the `gesture` payload above. Server broadcasts to all connected WebSocket clients.
- `GET /health` — Returns `{uptime_seconds, active_connections}` for debugging.
- `GET /` — Returns `{status: "ok"}` for liveness checks.

### Coming in Phase 2 (Sakshi, H10–H12)
- `GET /audio/{cue_name}` — Serves pre-generated ElevenLabs MP3 from `kineticlab/audio/cache/`. Zero live TTS calls at runtime.

### Reserved — owned by Sreekar (Photon track)
- `POST /photon/inbound` — Photon Spectrum iMessage webhook receiver. Implementation in `kineticlab/photon/router.py`. Mounted into the FastAPI app via `app.include_router(router)`.

### Coming in Phase 3 (Sakshi, H12–H24, MongoDB Atlas)
- `GET /session/{user_id}/latest` — Returns latest session document for a user. Read by Sreekar's Photon scheduler to personalize daily reminders.
- `POST /session/complete` — Called at end of exercise session to persist results (exercises completed, FMA-UE score, streak, ROM profile). Data store: MongoDB Atlas.

---

## Change control

- **v1.1** is additive-only — new message types (`audio_cue`) and new endpoints (`/audio/*`, `/session/*`, `/photon/inbound`). No breaking changes to v1.
- Changes after Phase 2 (H12) require sign-off from Sakshi (backend) and Tomiwa (frontend consumer).
- Breaking changes bump to v2 and require a new section in this file documenting the migration.
---

## LiveAvatar session lifecycle (Sakshi, shipped)

Backend owns the session lifecycle. Frontend (Tomiwa) owns the LiveKit video stream and data channel for speak commands.

### `POST /avatar/start`
Create a new LiveAvatar session. No body.

**Response 200:**
```json
{
  "session_id": "200e020e-e19e-4a0c-bcd9-c5ebf2177d2c",
  "livekit_url": "wss://heygen-feapbkvq.livekit.cloud",
  "livekit_client_token": "eyJhbGci...",
  "ws_url": "wss://webrtc-signaling.heygen.io/v2-alpha/...",
  "max_session_duration": 1200
}
```

**Frontend flow after this call:**
1. `npm install @livekit/client`
2. Join the LiveKit room using `livekit_url` + `livekit_client_token`
3. Subscribe to the remote video track → render in a `<video>` element
4. To make the avatar speak: send `{type: "speak", data: {text: "..."}}` via the LiveKit data channel — text comes from the `/ws` WebSocket (Gemini's `clinical_response()` output)

**Error 502:** LiveAvatar upstream failed. Retry or surface friendly error.

### `POST /avatar/stop`
Stop a session to release credits. Always call when the avatar view closes.

**Body:**
```json
{ "session_id": "200e020e-e19e-4a0c-bcd9-c5ebf2177d2c" }
```

**Response 200:**
```json
{ "session_id": "...", "stopped": true }
```

Idempotent — calling with an unknown session_id returns `{stopped: false, note: "..."}` without error.

### `GET /avatar/status` (debug)
Lists active avatar sessions this backend is tracking. Useful during integration testing.

**Response:**
```json
{ "active_sessions": ["uuid1", "uuid2"], "count": 2 }
```

### Environment variables required
- `LIVEAVATAR_API_KEY` — your LiveAvatar API key
- `LIVEAVATAR_AVATAR_ID` — UUID of the avatar
- `LIVEAVATAR_VOICE_ID` (optional) — voice to use; defaults to avatar's built-in voice
- `LIVEAVATAR_SANDBOX` (optional) — `"true"` for free sandbox mode, default production

### Credit management
LiveAvatar charges per-minute of active session. Always pair `/avatar/start` with `/avatar/stop`. Sessions auto-expire after `max_session_duration` seconds (20 min at time of writing).
