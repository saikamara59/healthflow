"""Composite-write protection: broker A cannot create rows referencing broker B's data."""
import pytest

from healthflow.auth.security import hash_password
from healthflow.database.models import Broker, Client
from healthflow.tests.api import test_documents

records = test_documents.records
service = test_documents.service


async def _make_broker(session, email: str) -> Broker:
    broker = Broker(
        email=email,
        hashed_password=hash_password("WriteTest123!"),
        full_name=email,
    )
    session.add(broker)
    await session.flush()
    return broker


async def _login(client, email: str, password: str = "WriteTest123!") -> str:
    res = await client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


@pytest.mark.anyio
async def test_broker_cannot_create_history_for_other_brokers_client(client, db_session):
    """POST /history with another broker's client_id must return 404, not write the row."""
    broker_a = await _make_broker(db_session, "wa@healthflow.test")
    _broker_b = await _make_broker(db_session, "wb@healthflow.test")
    a_client = Client(
        broker_id=broker_a.id, full_name="A's Client",
        zip_code="10001", age=40, income_level="medium",
        doctors=[], prescriptions=[], procedures=[],
    )
    db_session.add(a_client)
    await db_session.commit()

    b_token = await _login(client, "wb@healthflow.test")
    res = await client.post(
        "/history",
        headers={"Authorization": f"Bearer {b_token}"},
        json={
            "client_id": str(a_client.id),
            "action_type": "compare_plans",
            "request_data": {},
            "response_summary": {},
        },
    )
    assert res.status_code == 404, f"Cross-broker write leak: {res.status_code} {res.text}"


@pytest.mark.anyio
async def test_analytics_endpoint_returns_only_current_brokers_aggregates(client, db_session):
    """GET /feedback/analytics must aggregate only the requesting broker's feedback."""
    _broker_a = await _make_broker(db_session, "ana-a@healthflow.test")
    _broker_b = await _make_broker(db_session, "ana-b@healthflow.test")
    await db_session.commit()

    a_token = await _login(client, "ana-a@healthflow.test")
    b_token = await _login(client, "ana-b@healthflow.test")

    # A submits 2 feedback rows; B submits 5 with different agent_type.
    for _ in range(2):
        res = await client.post(
            "/feedback",
            headers={"Authorization": f"Bearer {a_token}"},
            json={"output_id": "o1", "agent_type": "compare",
                  "accuracy": 5, "clarity": 5, "helpfulness": 5, "comment": ""},
        )
        assert res.status_code == 201, res.text
    for _ in range(5):
        res = await client.post(
            "/feedback",
            headers={"Authorization": f"Bearer {b_token}"},
            json={"output_id": "o2", "agent_type": "translate",
                  "accuracy": 3, "clarity": 3, "helpfulness": 3, "comment": ""},
        )
        assert res.status_code == 201, res.text

    # A's analytics should see only "compare" with total_feedback=2.
    res = await client.get(
        "/feedback/analytics",
        headers={"Authorization": f"Bearer {a_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_feedback"] == 2
    assert {a["agent_type"] for a in body["agents"]} == {"compare"}

    # B's analytics should see only "translate" with total_feedback=5.
    res = await client.get(
        "/feedback/analytics",
        headers={"Authorization": f"Bearer {b_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_feedback"] == 5
    assert {a["agent_type"] for a in body["agents"]} == {"translate"}


@pytest.mark.anyio
async def test_document_links_require_same_broker_and_client(client, db_session, records, service):
    from uuid import UUID, uuid4
    from sqlalchemy import select
    from healthflow.database.models import Appeal, Document, DocumentLink, Enrollment, Issue
    from healthflow.tests.api.test_documents import document_targets, upload
    from healthflow.tests.api.test_enrollments import _client_record

    owner, other, client_id = records
    data = (await upload(client, records)).json()
    document = await db_session.get(Document, UUID(data["id"]))
    valid = await document_targets(db_session, document)
    other_client = await _client_record(client, owner, "Other synthetic Client")
    foreign_client = await _client_record(client, other, "Foreign synthetic Client")
    foreign = await db_session.get(Client, UUID(foreign_client["id"]))
    forbidden = []
    for broker_id, target_client in [(document.broker_id, UUID(other_client["id"])),
                                     (foreign.broker_id, foreign.id)]:
        issue = Issue(broker_id=broker_id, client_id=target_client, title="Synthetic")
        enrollment = Enrollment(broker_id=broker_id, client_id=target_client, plan_name="Synthetic")
        db_session.add_all([issue, enrollment])
        await db_session.flush()
        # Even an owned Appeal cannot bypass its Issue's Broker/Client scope.
        appeal = Appeal(broker_id=document.broker_id, issue_id=issue.id, title="Synthetic")
        db_session.add(appeal)
        await db_session.flush()
        forbidden.extend([("issue", issue.id), ("enrollment", enrollment.id), ("appeal", appeal.id)])
    await db_session.commit()
    base = f"/documents/{document.id}"
    for kind, target in forbidden:
        response = await client.post(base + "/links", headers=owner,
                                     json={"target_type": kind, "target_id": str(target)})
        assert response.status_code == 404
    for kind, target in valid.items():
        payload = {"target_type": kind, "target_id": str(target)}
        assert (await client.post(base + "/links", headers=other, json=payload)).status_code == 404
        assert (await client.get("/documents", headers=other, params=payload)).status_code == 404
    assert (await db_session.execute(select(DocumentLink))).scalars().all() == []
    for suffix in ("archive", "restore"):
        assert (await client.post(base + f"/{suffix}", headers=other)).status_code == 404
    assert (await client.get(base + "/links?include_ended=true", headers=other)).status_code == 404
    created = (await client.post(base + "/links", headers=owner,
                                 json={"target_type": "issue", "target_id": str(valid["issue"])})).json()
    assert (await client.delete(base + f"/links/{created['id']}", headers=other)).status_code == 404
    assert (await client.delete(f"/documents/{uuid4()}/links/{created['id']}", headers=owner)).status_code == 404
    await client.post(f"/clients/{client_id}/archive", headers=owner)
    assert (await client.post(base + "/links", headers=owner,
                              json={"target_type": "appeal", "target_id": str(valid["appeal"])})).status_code == 409
