"""
Session data client — access to Sakshi's MongoDB REST layer.

Read-only for all session endpoints. The only permitted write is
POST /session/{user_id}/complete, which marks a session as finished.

BASE URL is configurable via SESSION_BASE_URL so tests and staging can
point at a local mock without code changes.
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import httpx

logger = logging.getLogger(__name__)

SESSION_BASE_URL: str = os.environ.get("SESSION_BASE_URL", "http://localhost:8000")
_TIMEOUT = httpx.Timeout(10.0)


@asynccontextmanager
async def _client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """Yield a configured AsyncClient with a 10-second timeout."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        yield client


async def get_latest_session(user_id: str) -> dict:
    """
    Fetch the most recent session record for a patient.

    Args:
        user_id: Internal user identifier (e.g. "user_1").

    Returns:
        Session dict with keys: session_id, user_id, timestamp,
        exercises_completed, fma_score, streak, last_session_date.

    Raises:
        RuntimeError: on HTTP errors or network/timeout failures.
    """
    url = f"{SESSION_BASE_URL}/session/{user_id}/latest"
    try:
        async with _client() as client:
            r = await client.get(url)
            r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"Failed to fetch session for user {user_id!r}: "
            f"HTTP {exc.response.status_code} from {url}"
        ) from exc
    except httpx.RequestError as exc:
        raise RuntimeError(
            f"Network error fetching session for user {user_id!r} at {url}: {exc}"
        ) from exc

    data = r.json()
    logger.debug("Fetched session for user %s: %s", user_id, data)
    return data


async def get_all_active_users() -> list[dict]:
    """
    Return all active users who should receive daily reminders.

    Calls GET {SESSION_BASE_URL}/users/active (Sakshi owns this endpoint).
    Each dict in the returned list contains at minimum:
        "id"    — internal user identifier (str)
        "phone" — E.164 phone number (str, e.g. "+15105550123")

    Raises:
        NotImplementedError: if the endpoint returns 404 (not yet deployed).
        RuntimeError:        on other HTTP errors or network failures.
    """
    url = f"{SESSION_BASE_URL}/users/active"
    try:
        async with _client() as client:
            r = await client.get(url)
            r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            # Endpoint not yet deployed by Sakshi — caller (scheduler.py)
            # catches NotImplementedError and logs a clear warning.
            raise NotImplementedError(
                "GET /users/active returned 404 — endpoint not yet deployed. "
                "Coordinate with Sakshi at the H0 integration checkpoint."
            ) from exc
        raise RuntimeError(
            f"Failed to fetch active users: HTTP {exc.response.status_code} from {url}"
        ) from exc
    except httpx.RequestError as exc:
        raise RuntimeError(
            f"Network error fetching active users at {url}: {exc}"
        ) from exc

    users = r.json()
    logger.debug("Fetched %d active user(s) from %s.", len(users), url)
    return users


async def post_session_complete(user_id: str, payload: dict) -> dict:
    """
    Mark a session as complete.

    This is the only write operation permitted by the integration contract.
    All other session endpoints are read-only.

    Args:
        user_id: Internal user identifier.
        payload: Arbitrary completion payload (e.g. {"session_id": "abc123"}).

    Returns:
        Parsed JSON confirmation from the backend.

    Raises:
        RuntimeError: on HTTP errors or network/timeout failures.
    """
    url = f"{SESSION_BASE_URL}/session/{user_id}/complete"
    try:
        async with _client() as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"Failed to post session complete for user {user_id!r}: "
            f"HTTP {exc.response.status_code} from {url}"
        ) from exc
    except httpx.RequestError as exc:
        raise RuntimeError(
            f"Network error posting session complete for user {user_id!r} at {url}: {exc}"
        ) from exc

    data = r.json()
    logger.info("Session complete posted for user %s.", user_id)
    return data
