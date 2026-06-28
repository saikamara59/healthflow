import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.security import create_access_token, hash_password
from healthflow.database.models import Broker, DecisionRecord


async def _broker_and_token(db: AsyncSession):
    bid = uuid.uuid4()
    db.add(Broker(id=bid, email=f"dr-{bid.hex[:6]}@test.com",
                  hashed_password=hash_password("testpass123"), full_name="DR Tester"))
    await db.commit()
    return bid, create_access_token({"sub": str(bid), "type": "access"})


async def _insert_decision(db: AsyncSession, broker_id):
    did = uuid.uuid4()
    db.add(DecisionRecord(
        id=did, broker_id=broker_id, client_id=None, agent_type="compare",
        model_used="claude-haiku-4-5", duration_ms=900,
        content={"inputs": {"age": 67}, "recommended_plan": {"plan_name": "Aetna Prime"},
                 "alternatives": [], "recommendation_text": "best value", "basis": "ranked 3"},
    ))
    await db.commit()
    return did


@pytest.mark.anyio
async def test_get_decision_returns_record_for_owner(client: AsyncClient, db_session: AsyncSession):
    bid, token = await _broker_and_token(db_session)
    did = await _insert_decision(db_session, bid)
    resp = await client.get(f"/decisions/{did}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == str(did)
    assert data["recommended_plan"] == {"plan_name": "Aetna Prime"}
    assert data["recommendation_text"] == "best value"
    assert data["broker_id"] == str(bid)


@pytest.mark.anyio
async def test_get_decision_other_broker_gets_404(client: AsyncClient, db_session: AsyncSession):
    owner_id, _ = await _broker_and_token(db_session)
    did = await _insert_decision(db_session, owner_id)
    _, other_token = await _broker_and_token(db_session)
    resp = await client.get(f"/decisions/{did}", headers={"Authorization": f"Bearer {other_token}"})
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_get_decision_unknown_id_404(client: AsyncClient, db_session: AsyncSession):
    _, token = await _broker_and_token(db_session)
    resp = await client.get(f"/decisions/{uuid.uuid4()}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_get_decision_requires_auth(client: AsyncClient):
    resp = await client.get(f"/decisions/{uuid.uuid4()}")
    assert resp.status_code == 401
