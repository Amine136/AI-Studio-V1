"""Dodo Payments — the international card rail.

Unlike the manual Tunisian flow, this one is fully automatic: we create a
hosted checkout session server-side (the client never sees an amount it could
tamper with — only a plan id), Dodo takes the card details on its own page,
and a webhook (``/webhooks/dodo`` in main.py) credits the ledger the moment a
payment succeeds. There is no admin review step.

Two failure modes deliberately behave differently:
- No API key configured -> checkout creation raises, buyer sees "unavailable".
- No webhook secret configured -> the webhook handler (not this module)
  refuses every delivery with 503. This mints credits, so unlike the
  no-key-is-a-safe-no-op idiom used for email/Discord elsewhere in this
  codebase, an unverifiable webhook must fail CLOSED.
"""

from __future__ import annotations

import logging
from typing import Any

from dodopayments import DodoPayments
from standardwebhooks.webhooks import Webhook, WebhookVerificationError

from app.config import settings

logger = logging.getLogger(__name__)

_client: DodoPayments | None = None


class DodoNotConfiguredError(RuntimeError):
    pass


def _get_client() -> DodoPayments:
    global _client
    if not settings.dodo_api_key:
        raise DodoNotConfiguredError("DODO_API_KEY is not configured")
    if _client is None:
        _client = DodoPayments(bearer_token=settings.dodo_api_key, environment=settings.dodo_environment)
    return _client


def create_checkout_session(*, uid: str, plan: dict[str, Any], return_url: str) -> str:
    """Create a one-time-payment checkout session for ``plan`` and return its
    hosted checkout URL. ``uid`` and the plan id travel as metadata so the
    webhook can identify who to credit and with what, without trusting
    anything the browser sends back on return."""
    product_id = settings.dodo_product_ids.get(str(plan["id"]))
    if not product_id:
        raise DodoNotConfiguredError(f"No Dodo product configured for plan '{plan['id']}'")

    client = _get_client()
    session = client.checkout_sessions.create(
        product_cart=[{"product_id": product_id, "quantity": 1}],
        return_url=return_url,
        metadata={"uid": uid, "plan_id": str(plan["id"])},
    )
    return session.checkout_url


def verify_webhook(raw_body: bytes, headers: dict[str, str]) -> dict[str, Any] | None:
    """Verify a Dodo webhook delivery and return its parsed JSON payload, or
    None if the secret isn't configured yet (caller must treat that as a hard
    failure, not a no-op — see module docstring).

    Raises ``WebhookVerificationError`` when a secret IS configured but the
    signature doesn't check out (bad/missing headers, expired timestamp,
    forged signature)."""
    if not settings.dodo_webhook_secret:
        return None
    wh = Webhook(settings.dodo_webhook_secret)
    return wh.verify(raw_body, headers)


__all__ = ["DodoNotConfiguredError", "WebhookVerificationError", "create_checkout_session", "verify_webhook"]
