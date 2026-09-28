"""Document metadata, typed Link history, and durable event persistence."""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, text
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateIndex

from healthflow.database.models import (
    Appeal, Broker, Client, Document, DocumentEvent, DocumentLink, Enrollment, Issue,
)


@pytest_asyncio.fixture
async def document_records(db_session):
    # Enforce real FK integrity as well as the Link CHECK/unique constraints.
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    broker = Broker(email="documents@example.test", hashed_password="hash", full_name="Broker")
    db_session.add(broker)
    await db_session.flush()
    client = Client(broker_id=broker.id, full_name="Synthetic Client", zip_code="10001",
                    age=40, income_level="medium")
    db_session.add(client)
    await db_session.flush()
    enrollment = Enrollment(broker_id=broker.id, client_id=client.id, plan_name="Test plan")
    issue = Issue(broker_id=broker.id, client_id=client.id, title="Test issue")
    document = Document(broker_id=broker.id, client_id=client.id, display_filename="Synthetic.pdf",
                        verified_type="application/pdf", byte_length=123, object_key=str(uuid.uuid4()))
    db_session.add_all([enrollment, issue, document])
    await db_session.flush()
    appeal = Appeal(broker_id=broker.id, issue_id=issue.id, title="Test appeal")
    db_session.add(appeal)
    await db_session.commit()
    return db_session, {
        "broker_id": broker.id, "client_id": client.id, "document_id": document.id,
        "enrollment_id": enrollment.id, "issue_id": issue.id, "appeal_id": appeal.id,
    }


def link_values(ids, *targets):
    return {key: ids[key] for key in ("broker_id", "client_id", "document_id", *targets)}


@pytest.mark.anyio
async def test_document_filename_roundtrip_is_encrypted(document_records):
    session, ids = document_records
    session.expunge_all()
    document = (await session.execute(select(Document))).scalar_one()
    assert document.display_filename == "Synthetic.pdf"
    assert document.created_at is not None
    assert document.archived_at is None
    assert document.demo_fixture_marker is None
    raw = (await session.execute(text("SELECT display_filename FROM documents WHERE broker_id=:broker"),
                                 {"broker": str(ids["broker_id"])})).scalar_one()
    assert raw != "Synthetic.pdf"
    assert "Synthetic" not in raw


@pytest.mark.anyio
@pytest.mark.parametrize("targets", [(), ("enrollment_id", "issue_id"),
                                    ("enrollment_id", "appeal_id"),
                                    ("issue_id", "appeal_id"),
                                    ("enrollment_id", "issue_id", "appeal_id")])
async def test_link_requires_exactly_one_target(document_records, targets):
    session, ids = document_records
    with pytest.raises(IntegrityError, match="ck_document_link_one_target"):
        session.add(DocumentLink(**link_values(ids, *targets)))
        await session.flush()
    await session.rollback()


@pytest.mark.anyio
@pytest.mark.parametrize("target", ["enrollment_id", "issue_id", "appeal_id"])
async def test_active_link_unique_but_ended_link_can_be_relinked(document_records, target):
    session, ids = document_records
    original = DocumentLink(**link_values(ids, target))
    session.add(original)
    await session.commit()
    original_id = original.id
    with pytest.raises(IntegrityError):
        session.add(DocumentLink(**link_values(ids, target)))
        await session.flush()
    await session.rollback()
    original = await session.get(DocumentLink, original_id)
    original.ended_at = datetime.now(timezone.utc)
    await session.commit()
    replacement = DocumentLink(**link_values(ids, target))
    session.add(replacement)
    await session.commit()
    links = (await session.execute(select(DocumentLink))).scalars().all()
    assert len(links) == 2
    assert replacement.id != original_id
    assert replacement.ended_at is None
    assert original.ended_at is not None
    assert all(link.created_at is not None for link in links)


@pytest.mark.anyio
@pytest.mark.parametrize("target", ["enrollment_id", "issue_id", "appeal_id"])
async def test_link_rejects_missing_target(document_records, target):
    session, ids = document_records
    values = link_values(ids, target)
    values[target] = uuid.uuid4()
    with pytest.raises(IntegrityError, match="FOREIGN KEY"):
        session.add(DocumentLink(**values))
        await session.flush()
    await session.rollback()


def test_document_and_link_ownership_and_target_foreign_keys():
    for model in (Document, DocumentLink):
        for field, table in (("broker_id", "brokers"), ("client_id", "clients")):
            column = model.__table__.c[field]
            assert not column.nullable
            assert {fk.target_fullname for fk in column.foreign_keys} == {f"{table}.id"}
    for field, table in (("document_id", "documents"), ("enrollment_id", "enrollments"),
                         ("issue_id", "issues"), ("appeal_id", "appeals")):
        assert {fk.target_fullname for fk in DocumentLink.__table__.c[field].foreign_keys} == {f"{table}.id"}
    assert not DocumentLink.__table__.c.document_id.nullable


@pytest.mark.anyio
async def test_demo_marker_is_unique_only_when_present_and_within_broker(document_records):
    session, ids = document_records
    def document(broker_id, marker, client_id=None):
        return Document(broker_id=broker_id, client_id=client_id or ids["client_id"],
                        display_filename="Synthetic.pdf", verified_type="application/pdf",
                        byte_length=123, object_key=str(uuid.uuid4()), demo_fixture_marker=marker)
    session.add_all([document(ids["broker_id"], None), document(ids["broker_id"], "fixture-1")])
    await session.commit()
    with pytest.raises(IntegrityError):
        session.add(document(ids["broker_id"], "fixture-1"))
        await session.flush()
    await session.rollback()
    other = Broker(email="other-docs@example.test", hashed_password="hash", full_name="Other")
    session.add(other)
    await session.flush()
    other_client = Client(broker_id=other.id, full_name="Other Synthetic Client", zip_code="10001",
                          age=40, income_level="medium")
    session.add(other_client)
    await session.flush()
    session.add(document(other.id, "fixture-1", other_client.id))
    await session.commit()


@pytest.mark.parametrize("dialect", [sqlite.dialect(), postgresql.dialect()])
def test_partial_unique_index_ddl_for_sqlite_and_postgresql(dialect):
    indexes = [index for model in (Document, DocumentLink) for index in model.__table__.indexes if index.unique]
    assert len(indexes) == 4
    for index in indexes:
        ddl = str(CreateIndex(index).compile(dialect=dialect))
        assert "CREATE UNIQUE INDEX" in ddl
        if index.table.name == "documents":
            assert "(broker_id, demo_fixture_marker)" in ddl
            assert "WHERE demo_fixture_marker IS NOT NULL" in ddl
        else:
            assert "WHERE ended_at IS NULL" in ddl
            assert len(index.columns) == 2
            assert list(index.columns)[0].name == "document_id"


@pytest.mark.anyio
async def test_explicit_event_survives_document_deletion(document_records):
    session, ids = document_records
    assert DocumentEvent.__table__.c.document_id.nullable
    assert not DocumentEvent.__table__.c.document_id.foreign_keys
    saved = DocumentEvent(broker_id=ids["broker_id"], client_id=ids["client_id"], actor_kind="broker",
                          document_id=ids["document_id"], actor_id=ids["broker_id"],
                          action="file-open", outcome="started")
    client_event = DocumentEvent(broker_id=ids["broker_id"], client_id=ids["client_id"], actor_kind="broker",
                                actor_id=ids["broker_id"], action="client-archive", outcome="success")
    session.add_all([saved, client_event])
    await session.commit()
    await session.execute(delete(Document).where(Document.id == ids["document_id"]))
    await session.commit()
    session.expunge_all()
    events = (await session.execute(select(DocumentEvent))).scalars().all()
    assert len(events) == 2
    assert {entry.document_id for entry in events} == {ids["document_id"], None}
    assert all(entry.occurred_at is not None for entry in events)


@pytest.mark.anyio
@pytest.mark.parametrize("actor_kind,has_actor", [("broker", False), ("system", True), ("unknown", False)])
async def test_event_requires_unambiguous_actor(document_records, actor_kind, has_actor):
    session, ids = document_records
    with pytest.raises(IntegrityError, match="ck_document_event_actor"):
        session.add(DocumentEvent(broker_id=ids["broker_id"], actor_kind=actor_kind,
                                  actor_id=ids["broker_id"] if has_actor else None,
                                  action="file-open", outcome="denied"))
        await session.flush()
    await session.rollback()


@pytest.mark.anyio
async def test_event_supports_unknown_client_and_explicit_system_actor(document_records):
    session, ids = document_records
    session.add_all([
        DocumentEvent(broker_id=ids["broker_id"], actor_kind="broker", actor_id=ids["broker_id"],
                      action="file-open", outcome="denied"),
        DocumentEvent(broker_id=ids["broker_id"], actor_kind="system", action="demo-reset", outcome="success"),
    ])
    await session.commit()
    events = (await session.execute(select(DocumentEvent))).scalars().all()
    assert len(events) == 2
    assert all(entry.client_id is None and entry.document_id is None for entry in events)
    assert not DocumentEvent.__table__.c.broker_id.nullable
    assert all(not column.foreign_keys for column in DocumentEvent.__table__.columns)
