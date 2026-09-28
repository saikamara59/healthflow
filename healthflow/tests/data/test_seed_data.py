"""Tests for per-worker seed provisioning."""
import pytest
from sqlalchemy import select

from healthflow.database.models import Broker, Client, Document, DocumentEvent, DocumentLink, Enrollment
from healthflow.seed_data import (
    TEST_CLIENTS,
    seed_for_worker,
    worker_email,
)


def test_worker_email_is_deterministic():
    assert worker_email("e2e-worker-0") == "e2e-worker-0@healthflow.test"
    assert worker_email("e2e-worker-3") == "e2e-worker-3@healthflow.test"


@pytest.mark.anyio
async def test_seed_for_worker_creates_broker_and_clients(db_session):
    broker = await seed_for_worker(db_session, "e2e-worker-0")
    await db_session.commit()

    assert broker.email == "e2e-worker-0@healthflow.test"
    assert broker.full_name == "E2E Worker 0"

    clients = (
        await db_session.execute(select(Client).where(Client.broker_id == broker.id))
    ).scalars().all()
    assert len(clients) == len(TEST_CLIENTS)
    assert {c.full_name for c in clients} == {c["full_name"] for c in TEST_CLIENTS}


@pytest.mark.anyio
async def test_seed_for_worker_is_idempotent_on_broker(db_session):
    broker_a = await seed_for_worker(db_session, "e2e-worker-0")
    await db_session.commit()
    broker_b = await seed_for_worker(db_session, "e2e-worker-0")
    await db_session.commit()

    assert broker_a.id == broker_b.id

    brokers = (
        await db_session.execute(
            select(Broker).where(Broker.email == "e2e-worker-0@healthflow.test")
        )
    ).scalars().all()
    assert len(brokers) == 1


@pytest.mark.anyio
async def test_seed_for_worker_replaces_existing_clients(db_session):
    broker = await seed_for_worker(db_session, "e2e-worker-0")
    await db_session.commit()

    extra = Client(
        broker_id=broker.id,
        full_name="Stale Client",
        zip_code="00000",
        age=30,
        income_level="low",
        doctors=[],
        prescriptions=[],
        procedures=[],
    )
    db_session.add(extra)
    await db_session.commit()

    await seed_for_worker(db_session, "e2e-worker-0")
    await db_session.commit()

    clients = (
        await db_session.execute(select(Client).where(Client.broker_id == broker.id))
    ).scalars().all()
    names = {c.full_name for c in clients}
    assert names == {c["full_name"] for c in TEST_CLIENTS}
    assert "Stale Client" not in names


@pytest.mark.anyio
async def test_seed_for_worker_isolates_brokers(db_session):
    broker_a = await seed_for_worker(db_session, "e2e-worker-0")
    broker_b = await seed_for_worker(db_session, "e2e-worker-1")
    await db_session.commit()

    assert broker_a.id != broker_b.id
    a_clients = (
        await db_session.execute(select(Client).where(Client.broker_id == broker_a.id))
    ).scalars().all()
    b_clients = (
        await db_session.execute(select(Client).where(Client.broker_id == broker_b.id))
    ).scalars().all()
    assert len(a_clients) == len(TEST_CLIENTS)
    assert len(b_clients) == len(TEST_CLIENTS)
    assert {c.id for c in a_clients}.isdisjoint({c.id for c in b_clients})


@pytest.mark.anyio
@pytest.mark.parametrize("via_router", [False, True])
async def test_document_reset_worker_scope_and_history(db_session, db_session_factory, monkeypatch, via_router):
    from sqlalchemy import event
    from healthflow.api import test_router
    from healthflow.workspace.document_storage import FakeDocumentStorage
    store = FakeDocumentStorage()
    owners = [await seed_for_worker(db_session, f"e2e-worker-{index}") for index in (80, 81)]
    ids = []
    for broker in owners:
        client = (await db_session.scalars(select(Client).where(Client.broker_id == broker.id))).first()
        document = Document(broker_id=broker.id, client_id=client.id, display_filename="test.pdf", verified_type="pdf", byte_length=1, object_key=str(broker.id))
        db_session.add(document)
        await db_session.flush()
        ids.append(document.id)
        if via_router:
            enrollment = Enrollment(broker_id=broker.id, client_id=client.id, plan_name="Synthetic")
            db_session.add(enrollment)
            await db_session.flush()
            db_session.add(DocumentLink(broker_id=broker.id, client_id=client.id, document_id=document.id, enrollment_id=enrollment.id))
        db_session.add(DocumentEvent(broker_id=broker.id, document_id=document.id, client_id=client.id, actor_kind="system", action="seed", outcome="success"))
        store._objects[document.object_key] = b"synthetic"
    await db_session.commit()
    statements = []
    engine = db_session.bind.sync_engine

    def capture(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("DELETE"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        if via_router:
            monkeypatch.setattr(test_router, "async_session_factory", db_session_factory)
            await test_router.reset_db(test_router.ResetRequest(worker_id="e2e-worker-80"))
        else:
            await seed_for_worker(db_session, "e2e-worker-80")
            await db_session.commit()
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    remaining = (await db_session.scalars(select(Document))).all()
    assert [row.id for row in remaining] == [ids[1]]
    assert len((await db_session.scalars(select(DocumentEvent))).all()) == 2
    assert len(store._objects) == 2
    assert next(i for i, stmt in enumerate(statements) if "DELETE FROM document_links " in stmt) < next(i for i, stmt in enumerate(statements) if "DELETE FROM documents " in stmt) < next(i for i, stmt in enumerate(statements) if "DELETE FROM clients " in stmt)
    if via_router:
        assert len((await db_session.scalars(select(DocumentLink))).all()) == 1
        assert next(i for i, stmt in enumerate(statements) if "DELETE FROM document_links " in stmt) < next(i for i, stmt in enumerate(statements) if "DELETE FROM enrollments " in stmt)
