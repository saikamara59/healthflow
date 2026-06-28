"""Conftest for decisions unit tests.

The sync TestClient (used in test_compare_wiring.py) cannot perform a real
async DB lookup inside OptionalBrokerContextMiddleware — the factory connects
to the dev healthflow.db and the random-UUID broker won't be there. Patch the
middleware dispatch so it sets current_broker_id directly from the JWT payload
(no DB hit), matching the "no real DB/API" intent of the wiring tests.

The patch is applied only to tests in this package; it does NOT affect the
async-client tests in test_routes.py (those use the conftest fixture `client`
which has a proper DB with real broker rows).
"""
import uuid

import pytest

from healthflow.auth.security import decode_token
from healthflow.auth.tenant_context import current_broker_id


@pytest.fixture(autouse=True)
def _patch_optional_broker_middleware(monkeypatch):
    """Replace the async middleware dispatch with a sync-friendly stub.

    Decodes the bearer token (if present and valid) and sets current_broker_id
    without touching the database. Only used by sync TestClient tests in this
    package — async-client tests never reach this fixture because they bypass
    OptionalBrokerContextMiddleware via the conftest `client` fixture.
    """

    from healthflow.api import optional_broker_middleware as _mod

    original_dispatch = _mod.OptionalBrokerContextMiddleware.dispatch

    async def _stub_dispatch(self, request, call_next):
        token_value = None
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            raw = auth.split(" ", 1)[1].strip()
            try:
                payload = decode_token(raw)
                if payload.get("type") == "access":
                    broker_id = uuid.UUID(str(payload["sub"]))
                    token_value = current_broker_id.set(broker_id)
            except Exception:
                pass
        try:
            return await call_next(request)
        finally:
            if token_value is not None:
                current_broker_id.reset(token_value)

    monkeypatch.setattr(_mod.OptionalBrokerContextMiddleware, "dispatch", _stub_dispatch)
    yield
    # monkeypatch restores automatically
