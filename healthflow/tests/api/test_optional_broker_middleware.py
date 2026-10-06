"""Tests for OptionalBrokerContextMiddleware.

Verifies the middleware opportunistically sets current_broker_id from
a valid bearer, leaves it unset for missing/invalid tokens, and never
401s a route on its own. The InvocationLogger captures the broker_id
at agent-call time via the same ContextVar, so this middleware is
what makes forensics work for the agent routes that don't
auth-depend on get_current_broker.

The middleware only trusts a token whose broker still exists and is
active — mirroring get_current_broker — so a deactivated broker's
still-valid access token cannot retain tenant context. A hermetic
session factory is injected so these stay isolated from the real DB.
"""
import uuid

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from healthflow.api.optional_broker_middleware import OptionalBrokerContextMiddleware
from healthflow.auth.security import create_access_token, hash_password
from healthflow.auth.tenant_context import current_broker_id
from healthflow.database.models import Base, Broker

pytestmark = pytest.mark.anyio


@pytest_asyncio.fixture
async def session_factory(tmp_path):
    """A hermetic on-disk SQLite factory the middleware can query."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'mw.db'}", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def _insert_broker(factory, *, is_active: bool) -> uuid.UUID:
    broker_id = uuid.uuid4()
    async with factory() as session:
        session.add(
            Broker(
                id=broker_id,
                email=f"{broker_id}@example.com",
                hashed_password=hash_password("irrelevant"),
                full_name="Probe Broker",
                is_active=is_active,
            )
        )
        await session.commit()
    return broker_id


def _make_probe_app(factory) -> FastAPI:
    """A tiny app whose only route reports the current ContextVar value."""
    app = FastAPI()
    app.add_middleware(OptionalBrokerContextMiddleware, session_factory=factory)

    @app.get("/whoami")
    def whoami():
        value = current_broker_id.get()
        return {"broker_id": str(value) if value else None}

    return app


async def _whoami(factory, headers=None):
    transport = ASGITransport(app=_make_probe_app(factory))
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/whoami", headers=headers or {})
    assert resp.status_code == 200
    return resp.json()


async def test_no_bearer_leaves_context_unset(session_factory):
    assert await _whoami(session_factory) == {"broker_id": None}


async def test_active_broker_bearer_sets_context(session_factory):
    broker_id = await _insert_broker(session_factory, is_active=True)
    token = create_access_token({"sub": str(broker_id), "role": "broker"})
    body = await _whoami(session_factory, {"Authorization": f"Bearer {token}"})
    assert body == {"broker_id": str(broker_id)}


async def test_deactivated_broker_bearer_does_not_set_context(session_factory):
    """A deactivated broker whose access token is still within its lifetime
    must NOT retain tenant context — this is the security guarantee."""
    broker_id = await _insert_broker(session_factory, is_active=False)
    token = create_access_token({"sub": str(broker_id), "role": "broker"})
    body = await _whoami(session_factory, {"Authorization": f"Bearer {token}"})
    assert body == {"broker_id": None}


async def test_unknown_broker_bearer_does_not_set_context(session_factory):
    """A signed token whose broker row does not exist sets no context."""
    token = create_access_token({"sub": str(uuid.uuid4()), "role": "broker"})
    body = await _whoami(session_factory, {"Authorization": f"Bearer {token}"})
    assert body == {"broker_id": None}


async def test_malformed_bearer_is_silently_ignored(session_factory):
    """Bad token → route still 200, ContextVar stays None. Auth requirements
    on protected routes are enforced by their own Depends, not here."""
    body = await _whoami(session_factory, {"Authorization": "Bearer not-a-jwt"})
    assert body == {"broker_id": None}


async def test_non_access_token_does_not_set_context(session_factory):
    """Only `type=access` tokens count — a hand-rolled token of any other
    type should leave the ContextVar untouched."""
    from datetime import datetime, timedelta, timezone

    import jwt

    from healthflow.auth.security import JWT_ALGORITHM, JWT_SECRET

    broker_id = await _insert_broker(session_factory, is_active=True)
    payload = {
        "sub": str(broker_id),
        "role": "broker",
        "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    body = await _whoami(session_factory, {"Authorization": f"Bearer {token}"})
    assert body == {"broker_id": None}


async def test_context_is_reset_between_requests(session_factory):
    """No bleed: two consecutive requests with different active brokers see
    only their own token's broker_id."""
    a = await _insert_broker(session_factory, is_active=True)
    b = await _insert_broker(session_factory, is_active=True)
    t_a = create_access_token({"sub": str(a), "role": "broker"})
    t_b = create_access_token({"sub": str(b), "role": "broker"})

    transport = ASGITransport(app=_make_probe_app(session_factory))
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r_a = await ac.get("/whoami", headers={"Authorization": f"Bearer {t_a}"})
        r_b = await ac.get("/whoami", headers={"Authorization": f"Bearer {t_b}"})
        r_none = await ac.get("/whoami")

    assert r_a.json()["broker_id"] == str(a)
    assert r_b.json()["broker_id"] == str(b)
    assert r_none.json()["broker_id"] is None
