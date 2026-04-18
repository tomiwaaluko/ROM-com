"""
Photon Spectrum iMessage API client.

Real mode:  requires PHOTON_API_KEY env var and reachable Photon endpoint.
Mock mode:  set MOCK_PHOTON=1 — prints to stdout, no network calls made.
"""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

PHOTON_API_KEY: str = os.environ.get("PHOTON_API_KEY", "")
PHOTON_BASE: str = os.environ.get(
    "PHOTON_BASE_URL", "https://api.photonspectrum.com/v1"  # confirm actual URL on-site
)
async def send_imessage(to: str, body: str) -> dict:
    """
    Send an iMessage via the Photon Spectrum API.

    Args:
        to:   E.164 phone number of the recipient (e.g. "+15105550123").
        body: Message text — must already pass clinical guardrail validation.

    Returns:
        Parsed JSON response from the Photon API.

    Raises:
        RuntimeError:          if PHOTON_API_KEY is not configured.
        httpx.HTTPStatusError: if the API returns a non-2xx status.
        httpx.RequestError:    if the request fails at the transport layer.
    """
    if not PHOTON_API_KEY:
        raise RuntimeError(
            "PHOTON_API_KEY is not set. "
            "Export the variable or set MOCK_PHOTON=1 to use mock mode."
        )

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{PHOTON_BASE}/messages",
            headers={"Authorization": f"Bearer {PHOTON_API_KEY}"},
            json={"to": to, "body": body, "platform": "imessage"},
        )
        r.raise_for_status()

    response = r.json()
    logger.info("iMessage sent to %s — Photon response: %s", to, response)
    return response


async def send_imessage_safe(to: str, body: str) -> dict:
    """
    Send an iMessage, swallowing and logging any errors instead of raising.

    In mock mode (MOCK_PHOTON=1) the real API is never called; a log line is
    printed to stdout and {"status": "mock_sent"} is returned immediately.

    Args:
        to:   E.164 phone number of the recipient.
        body: Message text — must already pass clinical guardrail validation.

    Returns:
        Photon API response dict on success,
        {"status": "mock_sent"} in mock mode, or
        {"status": "error", "detail": "<message>"} on failure.
    """
    if os.environ.get("MOCK_PHOTON") == "1":
        print(f"[MOCK PHOTON] To: {to} | Message: {body}")
        return {"status": "mock_sent"}

    try:
        return await send_imessage(to, body)
    except RuntimeError as exc:
        logger.error("Photon config error sending to %s: %s", to, exc)
        return {"status": "error", "detail": str(exc)}
    except httpx.HTTPStatusError as exc:
        logger.error(
            "Photon API error sending to %s: HTTP %s — %s",
            to,
            exc.response.status_code,
            exc.response.text,
        )
        return {"status": "error", "detail": str(exc)}
    except httpx.RequestError as exc:
        logger.error("Photon network error sending to %s: %s", to, exc)
        return {"status": "error", "detail": str(exc)}
