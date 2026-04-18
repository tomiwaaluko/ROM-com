# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KineticLab ROM-COM is a clinical rehabilitation companion system with two structurally independent tracks. See `.claude/CLAUDE.md` for full project spec and ownership.

## Commands

This repo is pre-implementation at H0. No build scripts exist yet — they will be scaffolded in Phase 1 (H0–H4). Once generated, expect:

- **Run LiveAvatar service**: `python -m liveavatar.main` (with `MOCK_AVATAR=1` for mock mode)
- **Run Photon scheduler**: `python -m photon.main` (with `MOCK_PHOTON=1` for mock mode)
- **Run tests**: `pytest` (E2E latency target: < 2s for LiveAvatar pipeline)

Pre-commit hooks live at `.claude/hooks/pre-commit` and enforce: no hardcoded API keys, clinical guardrails in every LLM file, mock fallbacks present, no FDA claims.

## Architecture

Two async Python services sharing **read-only** session data from Sakshi's MongoDB REST API — no runtime state sharing between tracks.

### Track A — LiveAvatar (real-time, < 2s end-to-end)
```
Patient speech → ASR (Whisper/Deepgram) → LLM + clinical guardrails → HeyGen LiveAvatar Lite → ElevenLabs TTS streaming → avatar response
```

### Track B — Photon (async, cron-driven)
```
APScheduler (8 AM daily) → GET /session/{user_id}/latest → LLM message generator → Photon Spectrum iMessage → reply routing → optionally trigger LiveAvatar
```

### Shared session data schema (read-only — never write to this)
```json
{
  "session_id": "abc123",
  "user_id": "user_1",
  "exercises_completed": ["target_reach", "trajectory_trace"],
  "fma_score": { "domain_a": 24, "domain_c": 7, "domain_e": 4, "total": 35 },
  "streak": 5,
  "last_session_date": "2026-04-16"
}
```

### Integration endpoints
```
Session data:     GET  http://localhost:8000/session/{user_id}/latest
Session complete: POST http://localhost:8000/session/complete
Trigger avatar:   POST http://localhost:5000/avatar/start?user_id={id}
```

## Key Skill Files

These files in `.claude/skills/` are the authoritative specs — read them before implementing:

| File | Purpose |
|------|---------|
| `clinical_prompt_guardrails.md` | Verbatim system prompt prefix required in **every** LLM call across both tracks |
| `liveavatar_api.md` | HeyGen API client skeleton, ASR wiring, latency budget breakdown, mock fallback |
| `photon_spectrum_api.md` | Photon client skeleton, 5 message templates, LLM generator, cron logic, reply routing |
| `elevenlabs_streaming.md` | TTS streaming client, pre-cached cue system for demo stability |

## Non-Negotiables

- Every LLM system prompt must include clinical guardrails verbatim (from `clinical_prompt_guardrails.md`)
- Mock fallbacks (`MOCK_AVATAR`, `MOCK_PHOTON`) must work at all times — verify before every commit
- Session data is **read-only** — never POST/PUT/DELETE to Sakshi's data layer
- No FDA validation claims in any copy, prompt, or UI
- Photon messages must never induce guilt or anxiety
- FMA-UE scores framed as "research-grade subscale proxy" only
- LiveAvatar latency: < 2s end-to-end (ASR → LLM → avatar)
