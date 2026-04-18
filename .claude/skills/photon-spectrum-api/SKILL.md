---
name: photon-spectrum-api
description: Photon Spectrum iMessage API integration for daily recovery reminders.
  Use this skill when building, debugging, or extending the Photon client, writing
  message templates, implementing the cron scheduler, wiring the LLM message
  generator, or handling two-way reply routing from patients.
---

## What it does
Sends personalized, AI-generated daily reminders directly to patients via iMessage —
a platform they already use, requiring zero app download or behavior change.

## Why iMessage
- No new app to learn — critical for stroke/TBI population
- Higher open rates than email or push notifications
- Delivers in < 1s on Photon's edge network (99.9% uptime)
- Supports native polls, buttons, and structured responses

## Data flow
```
Scheduler (daily cron)
  → Pull session data from MongoDB (Sakshi's endpoint)
  → LLM generates personalized message
  → Photon Spectrum iMessage API → patient's phone
  → Patient replies
  → System logs response → optionally triggers LiveAvatar session
```

## API client skeleton
```python
import httpx
import os

PHOTON_API_KEY = os.environ["PHOTON_API_KEY"]
PHOTON_BASE = "https://api.photonspectrum.com/v1"  # confirm actual URL on-site

async def send_imessage(to: str, body: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{PHOTON_BASE}/messages",
            headers={"Authorization": f"Bearer {PHOTON_API_KEY}"},
            json={"to": to, "body": body, "platform": "imessage"}
        )
        r.raise_for_status()
        return r.json()
```

## Mock fallback (activate when API unavailable)
```python
MOCK_PHOTON = os.environ.get("MOCK_PHOTON", "false") == "true"

async def send_imessage_safe(to: str, body: str) -> dict:
    if MOCK_PHOTON:
        print(f"[MOCK PHOTON] To: {to} | Message: {body}")
        return {"status": "mock_sent"}
    return await send_imessage(to, body)
```

## 5 Message type templates

| Type                  | Template                                                                                     |
|-----------------------|----------------------------------------------------------------------------------------------|
| Daily reminder        | "Good morning {name}. Today's goal: {exercise}. You did it yesterday — let's go."           |
| Streak reinforcement  | "Day {streak} in a row. That's real consistency. Today: {exercise}, {duration} min."         |
| Missed session nudge  | "You skipped yesterday — no problem. Want to do a short 2-minute session now?"              |
| Weekly summary        | "This week: {completed}/7 sessions. Your {metric} improved. Full recap inside."             |
| Quick poll            | "How are you feeling today? 💪 Good / 😐 Okay / 😓 Rough"                                  |

## LLM message generator
```python
async def generate_message(session_data: dict, message_type: str) -> str:
    # Always prepend clinical guardrails — see skills/clinical_prompt_guardrails.md
    prompt = f"""
Generate a {message_type} iMessage for a stroke rehabilitation patient.
Session data: {session_data}
Rules:
- Maximum 2 sentences
- Warm but not patronizing
- Never mention failure or weakness
- Never induce guilt or anxiety
- Use first name if available
Return only the message text, no quotes or preamble.
"""
    # Call LLM (GPT-4o or Claude) here
    ...
```

## Two-way reply routing
```python
def handle_reply(reply_text: str, user_id: str):
    text = reply_text.lower().strip()
    if "not today" in text or "no" in text:
        log_skip(user_id)       # notify caregiver if 3 consecutive skips
    elif "ready" in text or "yes" in text:
        trigger_liveavatar_session(user_id)
    elif "exercise" in text or "what" in text:
        send_todays_plan(user_id)
```

## Cron scheduler (APScheduler)
```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()

@scheduler.scheduled_job("cron", hour=8, minute=0)  # 8 AM daily
async def daily_reminder_job():
    users = await get_all_active_users()   # from MongoDB
    for user in users:
        session = await get_latest_session(user["id"])
        msg = await generate_message(session, "daily_reminder")
        await send_imessage_safe(user["phone"], msg)
```

## Build risks
- Confirm iMessage API access on-site at H0 (requires Mac server or Photon managed infra)
- Patient phone number collection/consent needed at onboarding
- Test all 5 message templates for tone guardrails before H8
- Cron job must pull from Sakshi's MongoDB endpoint — coordinate endpoint URL at H0
