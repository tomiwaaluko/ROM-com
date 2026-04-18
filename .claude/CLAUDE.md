# KineticLab — Sreekar's Workstream

## Role
Sreekar owns: LiveAvatar patient-facing companion, Photon iMessage reminders,
ElevenLabs voice, ASR integration (Whisper/Deepgram), clinical prompt guardrails,
PM/UX, pitch script, Devpost writeup.

## Why subagents, not agent teams
LiveAvatar and Photon are structurally independent. They share the session data
schema (read-only) and the clinical prompt guardrails file. They do not share
runtime state during build. Subagents in parallel means no coordination overhead,
no inter-agent handoff contracts, and no mid-task blocking.

## API access gate — verify at H0
Before committing to Phase 2, confirm on-site:
- [ ] HeyGen LiveAvatar Lite/BYOLLM API access (confirm endpoint is not enterprise-gated)
- [ ] Photon Spectrum iMessage API access (confirm Mac server infra or managed infra available)

If either is unavailable → mock-first build. Skeleton clients with swapped-in mock
responses. Phase 2 proceeds identically; real API swapped in when access is confirmed.

## Phase breakdown

| Phase | Hours | Task A (LiveAvatar)                              | Task B (Photon)                          |
|-------|-------|--------------------------------------------------|------------------------------------------|
| 1     | H0–H4  | HeyGen Lite API client skeleton + mock fallback  | Photon iMessage client skeleton + mock fallback |
| 2     | H4–H8  | Clinical prompt layer + session LLM system prompt | 5 message type templates + LLM generator |
| 3     | H8–H18 | ASR wiring (Whisper/Deepgram → avatar response)  | Cron scheduler + session data pull logic |
| 4     | H18–H24 | E2E test: ASR → LLM → avatar < 2s              | E2E test: cron → LLM → iMessage → reply routing |

Each phase = one orchestrator call, two parallel subagent Tasks.
Review and commit between phases before next batch runs.

## Stack

| Layer            | Tool                          |
|------------------|-------------------------------|
| Avatar rendering | HeyGen LiveAvatar (Lite/BYOLLM) |
| Intelligence     | GPT-4o or Claude (claude-sonnet-4-20250514) |
| Voice output     | ElevenLabs                    |
| Speech input     | Whisper / Deepgram            |
| iMessage delivery | Photon Spectrum              |
| Scheduler        | Python APScheduler            |
| Session data     | MongoDB (Sakshi) via REST     |

## Session data schema (read-only — never write to this)
```json
{
  "session_id": "abc123",
  "user_id": "user_1",
  "timestamp": 1234567890,
  "exercises_completed": ["target_reach", "trajectory_trace"],
  "fma_score": { "domain_a": 24, "domain_c": 7, "domain_e": 4, "total": 35 },
  "streak": 5,
  "last_session_date": "2026-04-16"
}
```

## Integration endpoints
```
Session data (Sakshi):  GET  http://localhost:8000/session/{user_id}/latest
Session complete:       POST http://localhost:8000/session/complete
Trigger LiveAvatar:     POST http://localhost:5000/avatar/start?user_id={id}
```

## Non-negotiables
- Never claim FDA validation in any copy, prompt, or UI
- Clinical guardrails must be present in every LLM system prompt
- Mock fallback must work at all times — verify before every commit
- LiveAvatar latency target: < 2s end-to-end (ASR → LLM → avatar)
- Photon messages must never induce guilt or anxiety
- FMA-UE scores framed as "research-grade subscale proxy" only

## Freeze point
H24 — pitch, Devpost, and rehearsals only after this point.
Rehearsals at H30, H32, H34. Sreekar must be sharp for the pitch.
