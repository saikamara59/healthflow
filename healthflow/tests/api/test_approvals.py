"""Approvals: changes software proposes that wait for the owning Broker (ADR 0003)."""

import asyncio
from uuid import UUID

import pytest
from sqlalchemy import select, text

from healthflow.database.models import PhiAccessLog

from healthflow.workspace.approvals import propose_approval


async def _broker(client, email: str) -> tuple[dict[str, str], UUID]:
    await client.post(
        "/auth/register",
        json={"email": email, "password": "securepass123!", "full_name": "Approval Broker"},
    )
    await client.post("/__test/activate-broker", json={"email": email})
    login = await client.post("/auth/login", json={"email": email, "password": "securepass123!"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    profile = await client.get("/auth/profile", headers=headers)
    return headers, UUID(profile.json()["id"])


async def _client_record(client, headers, name="Marjorie Calloway") -> str:
    response = await client.post("/clients", headers=headers, json={
        "full_name": name, "zip_code": "10025", "age": 67, "income_level": "medium",
        "doctors": [], "prescriptions": [], "procedures": [],
    })
    return response.json()["id"]


async def _propose_task(db_session, broker_id, client_id, **overrides):
    values = {"title": "Call Marjorie about the plan review", "client_id": client_id,
              "due_at": "2030-01-15T14:00:00+00:00", "is_follow_up": True, **overrides}
    approval = await propose_approval(
        db_session, broker_id=broker_id, kind="task", values=values,
        proposer_agent="ask_healthflow", proposer_model="claude-sonnet",
        excerpt="Remind me to call Marjorie tomorrow morning",
    )
    await db_session.commit()
    return approval


@pytest.mark.asyncio
async def test_proposed_task_waits_in_the_owning_brokers_pending_queue(client, db_session):
    headers, broker_id = await _broker(client, "approvals-pending@example.com")
    client_id = await _client_record(client, headers)

    approval = await _propose_task(db_session, broker_id, client_id)

    pending = (await client.get("/approvals?state=pending", headers=headers)).json()
    assert [item["id"] for item in pending] == [str(approval.id)]
    assert pending[0]["state"] == "pending"
    assert pending[0]["kind"] == "task"
    assert pending[0]["proposed"]["title"] == "Call Marjorie about the plan review"
    assert pending[0]["excerpt"] == "Remind me to call Marjorie tomorrow morning"
    assert pending[0]["proposer"] == {"agent": "ask_healthflow", "model": "claude-sonnet",
                                      "source_type": None, "source_id": None}


@pytest.mark.asyncio
async def test_approving_as_proposed_creates_the_task_linked_to_its_approval(client, db_session):
    headers, broker_id = await _broker(client, "approvals-approve@example.com")
    client_id = await _client_record(client, headers)
    approval = await _propose_task(db_session, broker_id, client_id)

    decided = await client.post(f"/approvals/{approval.id}/approve", headers=headers,
                                json={"via": "approvals_page"})

    assert decided.status_code == 200, decided.text
    body = decided.json()
    assert body["state"] == "approved"
    assert body["decided_by"] == str(broker_id)
    assert body["decided_via"] == "approvals_page"
    assert body["decided_at"] is not None
    assert body["approved"]["title"] == "Call Marjorie about the plan review"
    task = (await client.get(f"/tasks/{body['created_record_id']}", headers=headers)).json()
    assert task["title"] == "Call Marjorie about the plan review"
    assert task["client_id"] == client_id
    assert task["is_follow_up"] is True
    assert task["approval_id"] == str(approval.id)
    assert (await client.get("/approvals?state=pending", headers=headers)).json() == []


@pytest.mark.asyncio
async def test_approval_appears_in_workspace_activity(client, db_session):
    headers, broker_id = await _broker(client, "approvals-activity@example.com")
    client_id = await _client_record(client, headers)
    approval = await _propose_task(db_session, broker_id, client_id)

    body = (await client.post(f"/approvals/{approval.id}/approve", headers=headers,
                              json={"via": "ask_healthflow"})).json()

    activity = (await client.get("/workspace/activity", headers=headers)).json()
    entry = next(item for item in activity if item["entity_id"] == body["created_record_id"])
    assert entry["action"] == "approved"
    assert entry["summary"] == "Approved task: Call Marjorie about the plan review"
    assert entry["client_id"] == client_id


@pytest.mark.asyncio
async def test_adjusted_approval_keeps_the_original_proposal(client, db_session):
    headers, broker_id = await _broker(client, "approvals-adjust@example.com")
    client_id = await _client_record(client, headers)
    approval = await _propose_task(db_session, broker_id, client_id)

    body = (await client.post(f"/approvals/{approval.id}/approve", headers=headers, json={
        "via": "approvals_page", "values": {"due_at": "2030-01-16T15:30:00+00:00"},
    })).json()

    assert body["proposed"]["due_at"] == "2030-01-15T14:00:00Z"
    assert body["approved"]["due_at"] == "2030-01-16T15:30:00Z"
    task = (await client.get(f"/tasks/{body['created_record_id']}", headers=headers)).json()
    assert task["due_at"].startswith("2030-01-16T15:30:00")
    detail = (await client.get(f"/approvals/{approval.id}", headers=headers)).json()
    assert detail["proposed"]["due_at"] == "2030-01-15T14:00:00Z"
    assert detail["approved"]["due_at"] == "2030-01-16T15:30:00Z"


@pytest.mark.asyncio
async def test_rejecting_requires_a_reason_and_creates_nothing(client, db_session):
    headers, broker_id = await _broker(client, "approvals-reject@example.com")
    client_id = await _client_record(client, headers)
    approval = await _propose_task(db_session, broker_id, client_id)

    missing = await client.post(f"/approvals/{approval.id}/reject", headers=headers,
                                json={"via": "approvals_page", "reason": "   "})
    assert missing.status_code == 422

    body = (await client.post(f"/approvals/{approval.id}/reject", headers=headers, json={
        "via": "approvals_page", "reason": "Client already called me back",
    })).json()

    assert body["state"] == "rejected"
    assert body["rejection_reason"] == "Client already called me back"
    assert body["decided_by"] == str(broker_id)
    assert body["created_record_id"] is None
    assert body["approved"] is None
    assert (await client.get("/tasks", headers=headers)).json() == []
    decided = (await client.get("/approvals?state=decided", headers=headers)).json()
    assert [item["id"] for item in decided] == [str(approval.id)]


@pytest.mark.asyncio
async def test_a_decided_approval_cannot_be_decided_again(client, db_session):
    headers, broker_id = await _broker(client, "approvals-twice@example.com")
    client_id = await _client_record(client, headers)
    approval = await _propose_task(db_session, broker_id, client_id)
    path = f"/approvals/{approval.id}"

    first = await client.post(f"{path}/approve", headers=headers, json={"via": "approvals_page"})
    second = await client.post(f"{path}/approve", headers=headers, json={"via": "ask_healthflow"})
    late_reject = await client.post(f"{path}/reject", headers=headers,
                                    json={"via": "approvals_page", "reason": "Changed my mind"})

    assert first.status_code == 200
    assert second.status_code == 409
    assert late_reject.status_code == 409
    assert len((await client.get("/tasks", headers=headers)).json()) == 1
    detail = (await client.get(path, headers=headers)).json()
    assert detail["state"] == "approved"
    assert detail["decided_via"] == "approvals_page"


@pytest.mark.asyncio
async def test_simultaneous_approvals_create_only_one_record(client, db_session):
    headers, broker_id = await _broker(client, "approvals-race@example.com")
    client_id = await _client_record(client, headers)
    approval = await _propose_task(db_session, broker_id, client_id)
    path = f"/approvals/{approval.id}/approve"

    results = await asyncio.gather(
        client.post(path, headers=headers, json={"via": "approvals_page"}),
        client.post(path, headers=headers, json={"via": "ask_healthflow"}),
    )

    assert sorted(response.status_code for response in results) == [200, 409]
    assert len((await client.get("/tasks", headers=headers)).json()) == 1


@pytest.mark.asyncio
async def test_approval_for_an_archived_client_is_blocked_until_restored(client, db_session):
    headers, broker_id = await _broker(client, "approvals-archived@example.com")
    client_id = await _client_record(client, headers)
    approval = await _propose_task(db_session, broker_id, client_id)
    await client.post(f"/clients/{client_id}/archive", headers=headers)

    blocked = await client.post(f"/approvals/{approval.id}/approve", headers=headers,
                                json={"via": "approvals_page"})

    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "Restore Marjorie Calloway before creating new work for them."
    assert (await client.get(f"/approvals/{approval.id}", headers=headers)).json()["state"] == "pending"
    await client.post(f"/clients/{client_id}/restore", headers=headers)
    approved = await client.post(f"/approvals/{approval.id}/approve", headers=headers,
                                 json={"via": "approvals_page"})
    assert approved.status_code == 200


@pytest.mark.asyncio
async def test_approval_with_a_past_time_is_blocked_until_adjusted(client, db_session):
    headers, broker_id = await _broker(client, "approvals-past@example.com")
    client_id = await _client_record(client, headers)
    approval = await _propose_task(db_session, broker_id, client_id, due_at="2020-01-15T14:00:00+00:00")

    blocked = await client.post(f"/approvals/{approval.id}/approve", headers=headers,
                                json={"via": "approvals_page"})

    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "The proposed time has already passed. Choose a new time or reject it."
    assert (await client.get(f"/approvals/{approval.id}", headers=headers)).json()["state"] == "pending"
    adjusted = await client.post(f"/approvals/{approval.id}/approve", headers=headers, json={
        "via": "approvals_page", "values": {"due_at": "2030-02-01T14:00:00+00:00"},
    })
    assert adjusted.status_code == 200


@pytest.mark.asyncio
async def test_approving_an_appointment_proposal_creates_the_appointment(client, db_session):
    headers, broker_id = await _broker(client, "approvals-appointment@example.com")
    client_id = await _client_record(client, headers)
    approval = await propose_approval(
        db_session, broker_id=broker_id, kind="appointment",
        values={"title": "Plan review with Marjorie", "client_id": client_id,
                "starts_at": "2030-01-16T15:00:00+00:00", "ends_at": "2030-01-16T15:30:00+00:00"},
        proposer_agent="ask_healthflow", excerpt="Book a review with Marjorie Thursday at 10",
        note="Overlaps: Plan review with Otis, 10:00 to 10:30 AM",
    )
    await db_session.commit()

    backwards = await client.post(f"/approvals/{approval.id}/approve", headers=headers, json={
        "via": "approvals_page", "values": {"ends_at": "2030-01-16T14:00:00+00:00"},
    })
    assert backwards.status_code == 422

    body = (await client.post(f"/approvals/{approval.id}/approve", headers=headers,
                              json={"via": "approvals_page"})).json()
    assert body["note"] == "Overlaps: Plan review with Otis, 10:00 to 10:30 AM"
    appointment = (await client.get(f"/appointments/{body['created_record_id']}", headers=headers)).json()
    assert appointment["title"] == "Plan review with Marjorie"
    assert appointment["approval_id"] == str(approval.id)


@pytest.mark.asyncio
async def test_other_brokers_cannot_see_or_decide_an_approval(client, db_session):
    owner, owner_id = await _broker(client, "approvals-owner@example.com")
    outsider, _ = await _broker(client, "approvals-outsider@example.com")
    client_id = await _client_record(client, owner)
    approval = await _propose_task(db_session, owner_id, client_id)
    path = f"/approvals/{approval.id}"

    assert (await client.get("/approvals?state=pending", headers=outsider)).json() == []
    assert (await client.get(path, headers=outsider)).status_code == 404
    assert (await client.post(f"{path}/approve", headers=outsider,
                              json={"via": "approvals_page"})).status_code == 404
    assert (await client.post(f"{path}/reject", headers=outsider,
                              json={"via": "approvals_page", "reason": "Not mine"})).status_code == 404
    assert (await client.get(path, headers=owner)).json()["state"] == "pending"


@pytest.mark.asyncio
async def test_approval_referencing_another_brokers_client_is_blocked(client, db_session):
    _, owner_id = await _broker(client, "approvals-foreign-owner@example.com")
    other, _ = await _broker(client, "approvals-foreign-other@example.com")
    foreign_client_id = await _client_record(client, other, name="Other Broker Client")
    approval = await _propose_task(db_session, owner_id, foreign_client_id)
    owner_headers, _ = await _broker(client, "approvals-foreign-owner@example.com")

    blocked = await client.post(f"/approvals/{approval.id}/approve", headers=owner_headers,
                                json={"via": "approvals_page"})

    assert blocked.status_code == 404
    assert (await client.get("/tasks", headers=owner_headers)).json() == []


@pytest.mark.asyncio
async def test_approval_text_is_encrypted_at_rest(client, db_session):
    headers, broker_id = await _broker(client, "approvals-encrypted@example.com")
    client_id = await _client_record(client, headers)
    approval = await _propose_task(db_session, broker_id, client_id)
    await client.post(f"/approvals/{approval.id}/reject", headers=headers,
                      json={"via": "approvals_page", "reason": "Marjorie switched brokers"})

    row = (await db_session.execute(text(
        "SELECT excerpt, proposed_values, rejection_reason FROM approvals WHERE id = :id"
    ), {"id": str(approval.id)})).one()

    for stored in row:
        assert stored.startswith("v1:")
        assert "Marjorie" not in stored


@pytest.mark.asyncio
async def test_reading_approvals_is_recorded_in_the_phi_access_log(client, db_session):
    headers, broker_id = await _broker(client, "approvals-audit@example.com")
    client_id = await _client_record(client, headers)
    approval = await _propose_task(db_session, broker_id, client_id)

    await client.get(f"/approvals/{approval.id}", headers=headers)

    entries = (await db_session.execute(select(PhiAccessLog).where(
        PhiAccessLog.table_name == "approvals", PhiAccessLog.operation == "read",
        PhiAccessLog.endpoint == f"GET /approvals/{approval.id}",
    ))).scalars().all()
    assert len(entries) == 1
    assert entries[0].broker_id == broker_id
    assert entries[0].row_ids == [str(approval.id)]
