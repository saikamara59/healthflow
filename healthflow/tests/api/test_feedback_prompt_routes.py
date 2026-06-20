import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.security import create_access_token, hash_password
from healthflow.database.models import (
    ActionHistory,
    Broker,
    Client,
    Feedback,
    PromptVariant,
)


async def _broker_with_role(db: AsyncSession, role: str):
    """Create a broker with the given role; return (broker, access_token)."""
    broker_id = uuid.uuid4()
    broker = Broker(
        id=broker_id,
        email=f"pr-{broker_id.hex[:6]}@test.com",
        hashed_password=hash_password("testpass123"),
        full_name="Prompt Tester",
        role=role,
    )
    db.add(broker)
    await db.commit()
    token = create_access_token({"sub": str(broker_id), "type": "access"})
    return broker, token


@pytest.mark.anyio
async def test_generate_prompt_admin_returns_few_shot(
    client: AsyncClient, db_session: AsyncSession
):
    admin, token = await _broker_with_role(db_session, "admin")

    # Seed one top-rated compare output: action_history + 5/5/5 feedback.
    client_row = Client(
        id=uuid.uuid4(),
        broker_id=admin.id,
        full_name="C",
        zip_code="90210",
        age=40,
        income_level="medium",
    )
    db_session.add(client_row)
    await db_session.flush()
    action_id = uuid.uuid4()
    db_session.add(
        ActionHistory(
            id=action_id,
            broker_id=admin.id,
            client_id=client_row.id,
            action_type="compare",
            request_data={"zip_code": "90210"},
            response_summary={"plans": ["Silver PPO"]},
        )
    )
    db_session.add(
        Feedback(
            id=uuid.uuid4(),
            broker_id=admin.id,
            output_id=str(action_id),
            agent_type="compare",
            accuracy=5,
            clarity=5,
            helpfulness=5,
        )
    )
    await db_session.commit()

    resp = await client.post(
        "/feedback/generate-prompt",
        json={"agent_type": "compare", "top_n": 3},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["agent_type"] == "compare"
    assert "Silver PPO" in data["few_shot"]


@pytest.mark.anyio
async def test_generate_prompt_forbidden_for_non_admin(
    client: AsyncClient, db_session: AsyncSession
):
    _, token = await _broker_with_role(db_session, "broker")
    resp = await client.post(
        "/feedback/generate-prompt",
        json={"agent_type": "compare"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_create_variant_admin_splits_traffic(
    client: AsyncClient, db_session: AsyncSession
):
    admin, token = await _broker_with_role(db_session, "admin")

    # Seed an existing 100% control variant for compare.
    control = PromptVariant(
        id=uuid.uuid4(),
        agent_type="compare",
        variant_name="control",
        prompt_template="You are a plan-comparison agent.",
        is_active=True,
        traffic_pct=100,
    )
    db_session.add(control)
    await db_session.commit()

    resp = await client.post(
        "/feedback/variants",
        json={
            "agent_type": "compare",
            "prompt_template": "You are a better plan-comparison agent.",
            "traffic_pct": 30,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["agent_type"] == "compare"
    assert data["traffic_pct"] == 30
    assert "prompt_template" not in data  # kept out of the lightweight response

    # The new variant persisted and control was shrunk to make room (70%).
    # expire_all() forces a fresh read: the route updated control via a
    # separate session, and this session (expire_on_commit=False) still holds
    # the stale 100% instance in its identity map.
    db_session.expire_all()
    rows = (
        await db_session.execute(
            select(PromptVariant).where(PromptVariant.agent_type == "compare")
        )
    ).scalars().all()
    by_name = {v.variant_name: v.traffic_pct for v in rows}
    assert by_name["control"] == 70
    assert sum(by_name.values()) == 100


@pytest.mark.anyio
async def test_create_variant_forbidden_for_non_admin(
    client: AsyncClient, db_session: AsyncSession
):
    _, token = await _broker_with_role(db_session, "broker")
    resp = await client.post(
        "/feedback/variants",
        json={
            "agent_type": "compare",
            "prompt_template": "x",
            "traffic_pct": 30,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_create_variant_invalid_traffic_pct(
    client: AsyncClient, db_session: AsyncSession
):
    _, token = await _broker_with_role(db_session, "admin")
    resp = await client.post(
        "/feedback/variants",
        json={
            "agent_type": "compare",
            "prompt_template": "x",
            "traffic_pct": 100,  # out of allowed 1-95 range
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_prompt_routes_require_auth(client: AsyncClient):
    resp = await client.post(
        "/feedback/generate-prompt", json={"agent_type": "compare"}
    )
    assert resp.status_code == 401

    resp = await client.post(
        "/feedback/variants",
        json={"agent_type": "compare", "prompt_template": "x", "traffic_pct": 30},
    )
    assert resp.status_code == 401
