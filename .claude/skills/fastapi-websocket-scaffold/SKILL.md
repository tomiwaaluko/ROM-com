---
name: fastapi-websocket-scaffold
description: Scaffolds FastAPI backend with WebSocket endpoint for real-time gesture streaming from Python pose pipeline to React frontend. Use when starting the KineticLab backend or regenerating the server skeleton.
---

# FastAPI WebSocket Scaffold

## When to use
- Initial backend setup
- Adding new WebSocket message types
- Resetting server after schema changes

## Message schema (agreed with frontend)
All messages are JSON with this shape:
{
  "type": "gesture | calibration | session | error",
  "payload": {},
  "timestamp": 1234567890.123
}

## Required files
- backend/main.py — FastAPI app + /ws endpoint
- backend/schemas.py — Pydantic models for each message type
- backend/connection_manager.py — handles multiple client connections
- backend/.env.example — template for env vars

## Endpoints
- GET / — health check, returns {"status": "ok"}
- GET /health — returns server uptime + active connections
- WS /ws — main bidirectional stream

## CORS
Allow http://localhost:5173 (Vite default) and http://localhost:3000.

## Testing
After scaffold, run: uvicorn main:app --reload --port 8000
Test with Bruno: connect to ws://localhost:8000/ws, send a ping message.
