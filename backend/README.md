# KineticLab Backend

FastAPI + WebSocket server for real-time gesture streaming. Routes pose-classifier output (Andrea's module) to exercise scenes (Tomiwa's React app).

## Stack
- FastAPI 0.115
- Uvicorn with auto-reload
- Pydantic v2 for message schemas
- Python 3.10+

## Quick start

    cd backend
    source venv/bin/activate
    uvicorn main:app --reload --port 8000

Server runs at http://localhost:8000

## Testing

Health check:

    curl http://localhost:8000/
    curl http://localhost:8000/health

Simulate a gesture broadcast (what Andrea's classifier will do):

    curl -X POST http://localhost:8000/internal/gesture \
      -H "Content-Type: application/json" \
      -d '{"name":"reach_forward","confidence":0.92,"normalized_rom":0.73}'

Test WebSocket from repo root:

    cd ..
    python test_ws.py

## File layout

- main.py — FastAPI app, routes, WebSocket endpoint
- schemas.py — Pydantic message models
- connection_manager.py — WebSocket connection tracking + broadcast
- .env.example — env var template (copy to .env with real values)

## Message schema

See ../SCHEMA.md for full WebSocket message contract.

## Env vars

Copy .env.example to .env and fill in values for MongoDB, ElevenLabs, Gemini, Auth0. Safe to run without .env for the WebSocket core — env vars are only needed once MLH integrations are wired in (Phase 3).

## Phase ownership

- Phase 1 (H0–H6): scaffold + WebSocket — done
- Phase 3 (H12–H24): MongoDB session logging, ElevenLabs narration cache, Gemini summaries, Auth0
- Phase 4 (H24–H36): final Devpost submission, integration audit
