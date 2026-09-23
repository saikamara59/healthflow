import uuid

import pytest
from sqlalchemy import select

from healthflow.database.models import (
    Appeal, DecisionRecord, Enrollment, Issue, WorkspaceActivity,
)


async def _register_and_login(client, email="crud@example.com"):
    """Helper to register a broker and get an auth token."""
    await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "securepass123!",
            "full_name": "CRUD Broker",
        },
    )
    # Production /auth/register creates accounts as pending; flip via test router.
    await client.post("/__test/activate-broker", json={"email": email})
    login_resp = await client.post(
        "/auth/login",
        json={"email": email, "password": "securepass123!"},
    )
    return login_resp.json()["access_token"]


@pytest.mark.asyncio
async def test_create_client(client):
    token = await _register_and_login(client, "create-client@example.com")
    response = await client.post(
        "/clients",
        json={
            "full_name": "Jane Doe",
            "zip_code": "10001",
            "age": 45,
            "income_level": "medium",
            "doctors": [{"name": "Dr. Chen", "npi": "1234567890"}],
            "prescriptions": ["Metformin"],
            "procedures": ["MRI"],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["full_name"] == "Jane Doe"
    assert data["zip_code"] == "10001"
    assert data["age"] == 45
    assert "id" in data
    assert "broker_id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_list_clients(client):
    token = await _register_and_login(client, "list-clients@example.com")
    # Create two clients
    await client.post(
        "/clients",
        json={
            "full_name": "Client One",
            "zip_code": "10001",
            "age": 30,
            "income_level": "low",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    await client.post(
        "/clients",
        json={
            "full_name": "Client Two",
            "zip_code": "90210",
            "age": 50,
            "income_level": "high",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    response = await client.get(
        "/clients",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    names = {c["full_name"] for c in data}
    assert "Client One" in names
    assert "Client Two" in names


@pytest.mark.asyncio
async def test_get_client_by_id(client):
    token = await _register_and_login(client, "get-client@example.com")
    create_resp = await client.post(
        "/clients",
        json={
            "full_name": "Get Me",
            "zip_code": "60601",
            "age": 40,
            "income_level": "medium",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    client_id = create_resp.json()["id"]

    response = await client.get(
        f"/clients/{client_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json()["full_name"] == "Get Me"


@pytest.mark.asyncio
async def test_get_nonexistent_client(client):
    token = await _register_and_login(client, "noexist@example.com")
    import uuid
    fake_id = str(uuid.uuid4())
    response = await client.get(
        f"/clients/{fake_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_client(client):
    token = await _register_and_login(client, "update-client@example.com")
    create_resp = await client.post(
        "/clients",
        json={
            "full_name": "Before Update",
            "zip_code": "10001",
            "age": 35,
            "income_level": "low",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    client_id = create_resp.json()["id"]

    response = await client.put(
        f"/clients/{client_id}",
        json={"full_name": "After Update", "age": 36},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["full_name"] == "After Update"
    assert data["age"] == 36
    # Unchanged fields should stay the same
    assert data["zip_code"] == "10001"
    assert data["income_level"] == "low"


@pytest.mark.asyncio
async def test_delete_client(client):
    token = await _register_and_login(client, "delete-client@example.com")
    create_resp = await client.post(
        "/clients",
        json={
            "full_name": "Delete Me",
            "zip_code": "10001",
            "age": 25,
            "income_level": "low",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    client_id = create_resp.json()["id"]

    response = await client.delete(
        f"/clients/{client_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 204

    auth = {"Authorization": f"Bearer {token}"}
    assert client_id not in {row["id"] for row in (await client.get("/clients", headers=auth)).json()}
    assert (await client.get("/clients?archived=true", headers=auth)).json()[0]["id"] == client_id
    assert (await client.get(f"/clients/{client_id}", headers=auth)).json()["archived_at"]
    assert (await client.post(f"/clients/{client_id}/restore", headers=auth)).status_code == 200
    assert (await client.get("/clients?linkable=true", headers=auth)).json()[0]["id"] == client_id


@pytest.mark.asyncio
async def test_archive_client_preserves_workspace_records_and_audits(client, db_session):
    token = await _register_and_login(client, "delete-linked-client@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    created = await client.post("/clients", json={
        "full_name": "Linked Client", "zip_code": "10001", "age": 35,
        "income_level": "medium", "doctors": [], "prescriptions": [], "procedures": [],
    }, headers=headers)
    client_id = created.json()["id"]
    task = await client.post("/tasks", json={"title": "Follow up", "client_id": client_id}, headers=headers)
    appointment = await client.post("/appointments", json={
        "title": "Meeting", "client_id": client_id,
        "starts_at": "2030-01-15T10:00:00Z", "ends_at": "2030-01-15T11:00:00Z",
    }, headers=headers)
    await client.post(f"/tasks/{task.json()['id']}/complete", headers=headers)
    history = await client.post("/history", json={
        "client_id": client_id, "action_type": "comparison",
        "request_data": {}, "response_summary": {},
    }, headers=headers)
    assert history.status_code == 201
    decision_id = uuid.uuid4()
    db_session.add(DecisionRecord(
        id=decision_id, broker_id=uuid.UUID(created.json()["broker_id"]),
        client_id=uuid.UUID(client_id), agent_type="compare", content={},
    ))
    await db_session.commit()
    task_id, appointment_id = task.json()["id"], appointment.json()["id"]
    assert (await client.get(f"/tasks/{task_id}", headers=headers)).json()["client_id"] == client_id
    assert (await client.get(f"/appointments/{appointment_id}", headers=headers)).json()["client_id"] == client_id
    assert (await client.post(f"/clients/{client_id}/archive", headers=headers)).status_code == 200
    assert (await client.get("/clients?linkable=true", headers=headers)).json() == []
    assert (await client.get(f"/tasks/{task_id}", headers=headers)).json()["client_id"] == client_id
    assert (await client.get(f"/appointments/{appointment_id}", headers=headers)).json()["client_id"] == client_id
    assert (await client.get("/history", headers=headers)).json()[0]["client_id"] == client_id
    db_session.expire_all()
    record = (await db_session.execute(
        select(DecisionRecord).where(DecisionRecord.id == decision_id)
    )).scalar_one()
    assert record.client_id == uuid.UUID(client_id)
    assert (await client.post(f"/clients/{client_id}/restore", headers=headers)).status_code == 200
    db_session.expire_all()
    activities = (await db_session.execute(select(WorkspaceActivity).where(
        WorkspaceActivity.entity_id == uuid.UUID(client_id),
        WorkspaceActivity.action.in_(["archived", "restored"]),
    ))).scalars().all()
    assert {item.action for item in activities} == {"archived", "restored"}
    for item in activities:
        assert item.entity_type == "client"
        assert item.client_id == uuid.UUID(client_id)
        assert item.details == {"outcome": "success"}
        assert "Linked Client" not in item.summary
        assert "Linked Client" not in str(item.details)


@pytest.mark.asyncio
async def test_archive_client_preserves_phase2_record_ids(client, db_session):
    token = await _register_and_login(client, "delete-phase2-client@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    created = await client.post(
        "/clients",
        json={
            "full_name": "Phase 2 Client",
            "zip_code": "10001",
            "age": 35,
            "income_level": "medium",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
        headers=headers,
    )
    client_id = created.json()["id"]
    enrollment = await client.post(
        "/enrollments",
        json={"client_id": client_id, "plan_name": "Audited Plan"},
        headers=headers,
    )
    issue = await client.post(
        "/issues",
        json={"client_id": client_id, "title": "Audited Issue"},
        headers=headers,
    )
    appeal = await client.post(
        "/appeals",
        json={"issue_id": issue.json()["id"], "title": "Audited Appeal"},
        headers=headers,
    )

    enrollment_id, issue_id, appeal_id = (uuid.UUID(response.json()["id"]) for response in (enrollment, issue, appeal))
    assert (await client.delete(f"/clients/{client_id}", headers=headers)).status_code == 204
    db_session.expire_all()
    for model, record_id, fk, expected in (
        (Enrollment, enrollment_id, "client_id", uuid.UUID(client_id)),
        (Issue, issue_id, "client_id", uuid.UUID(client_id)),
        (Appeal, appeal_id, "issue_id", issue_id),
    ):
        row = (await db_session.execute(select(model).where(model.id == record_id))).scalar_one()
        assert getattr(row, fk) == expected
    assert (await client.post(f"/clients/{client_id}/restore", headers=headers)).status_code == 200
    db_session.expire_all()
    assert (await db_session.execute(select(Enrollment).where(Enrollment.id == enrollment_id))).scalar_one().client_id == uuid.UUID(client_id)
    assert (await db_session.execute(select(Issue).where(Issue.id == issue_id))).scalar_one().client_id == uuid.UUID(client_id)
    assert (await db_session.execute(select(Appeal).where(Appeal.id == appeal_id))).scalar_one().issue_id == issue_id


@pytest.mark.asyncio
async def test_ownership_check_get(client):
    """Broker A cannot view Broker B's client."""
    token_a = await _register_and_login(client, "broker-a@example.com")
    token_b = await _register_and_login(client, "broker-b@example.com")

    # Broker A creates a client
    create_resp = await client.post(
        "/clients",
        json={
            "full_name": "A's Client",
            "zip_code": "10001",
            "age": 40,
            "income_level": "medium",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
        headers={"Authorization": f"Bearer {token_a}"},
    )
    client_id = create_resp.json()["id"]

    # Broker B tries to access it
    response = await client.get(
        f"/clients/{client_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    # 404 (not 403) per the multi-tenancy spec: don't leak existence of
    # another broker's records.
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_ownership_check_update(client):
    """Broker A cannot update Broker B's client."""
    token_a = await _register_and_login(client, "owner-a@example.com")
    token_b = await _register_and_login(client, "owner-b@example.com")

    create_resp = await client.post(
        "/clients",
        json={
            "full_name": "A's Client",
            "zip_code": "10001",
            "age": 40,
            "income_level": "medium",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
        headers={"Authorization": f"Bearer {token_a}"},
    )
    client_id = create_resp.json()["id"]

    response = await client.put(
        f"/clients/{client_id}",
        json={"full_name": "Hacked Name"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    # 404 (not 403) per the multi-tenancy spec: don't leak existence of
    # another broker's records.
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_ownership_check_delete(client):
    """Broker A cannot delete Broker B's client."""
    token_a = await _register_and_login(client, "del-a@example.com")
    token_b = await _register_and_login(client, "del-b@example.com")

    create_resp = await client.post(
        "/clients",
        json={
            "full_name": "A's Client",
            "zip_code": "10001",
            "age": 40,
            "income_level": "medium",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
        headers={"Authorization": f"Bearer {token_a}"},
    )
    client_id = create_resp.json()["id"]

    response = await client.delete(
        f"/clients/{client_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    # 404 (not 403) per the multi-tenancy spec: don't leak existence of
    # another broker's records.
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_only_owner_can_archive_or_restore_client(client):
    owner = await _register_and_login(client, "archive-owner@example.com")
    other = await _register_and_login(client, "archive-other@example.com")
    created = await client.post("/clients", json=_SAMPLE_CLIENT,
                                headers={"Authorization": f"Bearer {owner}"})
    client_id = created.json()["id"]
    outsider = {"Authorization": f"Bearer {other}"}
    for action in ("archive", "restore"):
        assert (await client.post(f"/clients/{client_id}/{action}", headers=outsider)).status_code == 404
    assert (await client.post(f"/clients/{client_id}/archive", headers={"Authorization": f"Bearer {owner}"})).status_code == 200
    assert (await client.get("/clients?archived=true", headers=outsider)).json() == []
    assert (await client.post(f"/clients/{client_id}/restore", headers=outsider)).status_code == 404


@pytest.mark.asyncio
async def test_create_client_without_auth(client):
    response = await client.post(
        "/clients",
        json={
            "full_name": "No Auth",
            "zip_code": "10001",
            "age": 30,
            "income_level": "low",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
    )
    assert response.status_code == 401


# ── admin cross-tenant read bypass ───────────────────────────────────────────


async def _make_admin(client, db_session, email="admin@example.com"):
    """Register a broker, promote to admin, return a fresh access token."""
    from sqlalchemy import update as sa_update
    from healthflow.database.models import Broker

    await _register_and_login(client, email=email)
    await db_session.execute(
        sa_update(Broker).where(Broker.email == email).values(role="admin")
    )
    await db_session.commit()
    login = await client.post(
        "/auth/login", json={"email": email, "password": "securepass123!"}
    )
    return login.json()["access_token"]


_SAMPLE_CLIENT = {
    "full_name": "Cross-tenant Visible",
    "zip_code": "10001",
    "age": 64,
    "income_level": "medium",
    "doctors": [],
    "prescriptions": [],
    "procedures": [],
}


@pytest.mark.asyncio
async def test_admin_list_clients_sees_every_brokers_book(client, db_session):
    """An admin GET /clients returns clients owned by other brokers."""
    broker_token = await _register_and_login(client, "owner@example.com")
    create = await client.post(
        "/clients",
        json=_SAMPLE_CLIENT,
        headers={"Authorization": f"Bearer {broker_token}"},
    )
    assert create.status_code == 201
    owner_client_id = create.json()["id"]

    admin_token = await _make_admin(client, db_session)
    resp = await client.get(
        "/clients", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert resp.status_code == 200
    ids = {c["id"] for c in resp.json()}
    assert owner_client_id in ids


@pytest.mark.asyncio
async def test_admin_get_client_by_id_works_cross_tenant(client, db_session):
    """An admin can fetch any client by id, not just their own."""
    broker_token = await _register_and_login(client, "owner2@example.com")
    create = await client.post(
        "/clients",
        json=_SAMPLE_CLIENT,
        headers={"Authorization": f"Bearer {broker_token}"},
    )
    assert create.status_code == 201
    target_id = create.json()["id"]

    admin_token = await _make_admin(client, db_session, email="admin2@example.com")
    resp = await client.get(
        f"/clients/{target_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == target_id


@pytest.mark.asyncio
async def test_admin_cannot_update_other_brokers_clients(client, db_session):
    """Write paths stay tenant-scoped — admin's role does not grant edit rights."""
    broker_token = await _register_and_login(client, "owner3@example.com")
    create = await client.post(
        "/clients",
        json=_SAMPLE_CLIENT,
        headers={"Authorization": f"Bearer {broker_token}"},
    )
    target_id = create.json()["id"]

    admin_token = await _make_admin(client, db_session, email="admin3@example.com")
    resp = await client.put(
        f"/clients/{target_id}",
        json={"full_name": "Hijacked"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    # Tenant filter prunes the SELECT inside the PUT handler → 404 (no row found)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_admin_read_bypass_does_not_allow_archive_or_restore(client, db_session):
    owner = await _register_and_login(client, "archive-admin-owner@example.com")
    created = await client.post("/clients", json=_SAMPLE_CLIENT,
                                headers={"Authorization": f"Bearer {owner}"})
    client_id = created.json()["id"]
    admin = await _make_admin(client, db_session, "archive-admin@example.com")
    headers = {"Authorization": f"Bearer {admin}"}
    assert (await client.get(f"/clients/{client_id}", headers=headers)).status_code == 200
    for action in ("archive", "restore"):
        assert (await client.post(f"/clients/{client_id}/{action}", headers=headers)).status_code == 404


@pytest.mark.asyncio
async def test_plain_broker_still_isolated(client):
    """Regression: a non-admin broker only sees their own clients."""
    token_a = await _register_and_login(client, "iso-a@example.com")
    await client.post(
        "/clients",
        json=_SAMPLE_CLIENT,
        headers={"Authorization": f"Bearer {token_a}"},
    )
    token_b = await _register_and_login(client, "iso-b@example.com")
    resp = await client.get(
        "/clients", headers={"Authorization": f"Bearer {token_b}"}
    )
    assert resp.status_code == 200
    assert resp.json() == []
