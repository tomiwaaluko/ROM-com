"""E2E tests for the Photon iMessage pipeline. All tests run with MOCK_MODE=true."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Shared fixtures & test data
# ---------------------------------------------------------------------------

VALID_CONTEXT_1: dict = {
    "patient_id": "pt_001",
    "phone": "+14125550101",
    "last_session_date": "2026-04-17T08:00:00Z",
    "last_exercise": "Target Reach",
    "streak_days": 2,
    "fma_subscale_score": 31.5,
    "mood_today": "Good",
    "missed_yesterday": False,
}

VALID_CONTEXT_2: dict = {
    "patient_id": "pt_002",
    "phone": "+14125550102",
    "last_session_date": "2026-04-16T08:00:00Z",
    "last_exercise": "Shoulder Rotation",
    "streak_days": 0,
    "fma_subscale_score": 24.0,
    "mood_today": None,
    "missed_yesterday": True,
}


@pytest.fixture(scope="module")
def photon_test_client() -> TestClient:
    """FastAPI TestClient with the Photon inbound router registered."""
    from kineticlab.photon.router import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Task H — Photon client tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_photon_client_mock_send() -> None:
    """MockPhotonClient.send() must return a string message_id."""
    from kineticlab.photon.mock import MockPhotonClient

    client = MockPhotonClient()
    msg_id = await client.send("+14125550100", "Test message")

    assert isinstance(msg_id, str)
    assert msg_id


@pytest.mark.asyncio
async def test_photon_client_mock_quick_replies() -> None:
    """MockPhotonClient.send() with quick_replies must not raise."""
    from kineticlab.photon.mock import MockPhotonClient

    client = MockPhotonClient()
    await client.send("+14125550100", "How are you?", quick_replies=["Yes", "No"])


def test_select_message_type_missed() -> None:
    """missed_yesterday=True → 'missed_nudge' regardless of other fields."""
    from kineticlab.photon.llm import select_message_type

    result = select_message_type({
        "missed_yesterday": True,
        "streak_days": 5,
        "mood_today": "Good",
    })
    assert result == "missed_nudge"


def test_select_message_type_streak() -> None:
    """missed_yesterday=False, streak_days≥3 → 'streak'."""
    from kineticlab.photon.llm import select_message_type

    result = select_message_type({
        "missed_yesterday": False,
        "streak_days": 5,
        "mood_today": "Good",
    })
    assert result == "streak"


def test_select_message_type_mood_poll() -> None:
    """missed_yesterday=False, streak<3, mood_today=None → 'mood_poll'."""
    from kineticlab.photon.llm import select_message_type

    result = select_message_type({
        "missed_yesterday": False,
        "streak_days": 1,
        "mood_today": None,
    })
    assert result == "mood_poll"


def test_select_message_type_daily() -> None:
    """missed_yesterday=False, streak<3, mood set → 'daily_reminder'."""
    from kineticlab.photon.llm import select_message_type

    result = select_message_type({
        "missed_yesterday": False,
        "streak_days": 1,
        "mood_today": "Good",
    })
    assert result == "daily_reminder"


@pytest.mark.asyncio
async def test_daily_reminder_template() -> None:
    """daily_reminder() must invoke client.send() with the correct recipient."""
    from kineticlab.photon.mock import MockPhotonClient
    from kineticlab.photon.templates import daily_reminder

    client = MockPhotonClient()
    client.send = AsyncMock(return_value="mock-msg-dr")

    await daily_reminder(client, "+14125550100", "Alex", "Target Reach", 3)

    client.send.assert_called_once()
    call_kwargs = client.send.call_args
    assert call_kwargs[1]["recipient"] == "+14125550100" or call_kwargs[0][0] == "+14125550100"


@pytest.mark.asyncio
async def test_scheduler_run_once() -> None:
    """run_once() with 2 valid contexts must complete without exception."""
    from kineticlab.photon.scheduler import run_once

    with patch(
        "kineticlab.photon.scheduler.generate_message",
        new=AsyncMock(return_value=("Time for today's session!", ["Ready", "Not today"])),
    ):
        await run_once([VALID_CONTEXT_1, VALID_CONTEXT_2])  # must not raise


def test_inbound_webhook_ready(photon_test_client: TestClient) -> None:
    """POST /photon/inbound with content='Ready' must return {status: ok}."""
    resp = photon_test_client.post(
        "/photon/inbound",
        json={
            "message_id": "msg_001",
            "sender": "+14125550100",
            "content": "Ready",
            "timestamp": "2026-04-18T08:00:00Z",
            "in_reply_to": "msg_000",
        },
    )
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_inbound_webhook_rough_mood(photon_test_client: TestClient) -> None:
    """POST /photon/inbound with content='Rough' must return {status: ok}."""
    resp = photon_test_client.post(
        "/photon/inbound",
        json={
            "message_id": "msg_002",
            "sender": "+14125550101",
            "content": "Rough",
            "timestamp": "2026-04-18T08:01:00Z",
            "in_reply_to": "msg_001",
        },
    )
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
