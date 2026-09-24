"""Protected synthetic Documents: API authorization and durable stream outcomes."""

import io
import asyncio
import threading
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from starlette.requests import ClientDisconnect

from healthflow.database.models import Appeal, Document, DocumentEvent, DocumentLink, Enrollment, Issue, _utcnow
from healthflow.main import app, lifespan
from healthflow.tests.api.test_enrollments import _client_record, _headers
from healthflow.tests.fixtures.documents import fixture_bytes
from healthflow.workspace.document_storage import FakeDocumentStorage


@pytest_asyncio.fixture
async def records(client):
    owner = await _headers(client, "documents-owner@example.com")
    other = await _headers(client, "documents-other@example.com")
    record = await _client_record(client, owner, "Synthetic Client")
    return owner, other, record["id"]


@pytest.fixture
def service(db_session_factory):
    from healthflow.api.documents_router import get_document_service
    from healthflow.workspace.document_service import DocumentService

    service = DocumentService(FakeDocumentStorage(), session_factory=db_session_factory,
                              upload_enabled=True)
    app.dependency_overrides[get_document_service] = lambda: service
    yield service
    app.dependency_overrides.pop(get_document_service, None)


async def upload(client, records, filename="Synthetic.pdf"):
    owner, _, client_id = records
    return await client.post(f"/clients/{client_id}/documents", headers=owner,
                             files={"file": (filename, fixture_bytes(filename))})


async def events(db_session):
    return [(e.action, e.outcome) for e in
            (await db_session.execute(select(DocumentEvent).order_by(DocumentEvent.occurred_at))).scalars()]


async def document_targets(db_session, document):
    enrollment = Enrollment(broker_id=document.broker_id, client_id=document.client_id, plan_name="Synthetic")
    issue = Issue(broker_id=document.broker_id, client_id=document.client_id, title="Synthetic")
    db_session.add_all([enrollment, issue])
    await db_session.flush()
    appeal = Appeal(broker_id=document.broker_id, issue_id=issue.id, title="Synthetic")
    db_session.add(appeal)
    await db_session.commit()
    return {"enrollment": enrollment.id, "issue": issue.id, "appeal": appeal.id}


@pytest.mark.asyncio
async def test_link_history_archive_restore_keep_one_object(client, records, service, db_session):
    service.storage.put = Mock(wraps=service.storage.put)
    service.storage.remove = Mock(wraps=service.storage.remove)
    data = (await upload(client, records)).json()
    document = await db_session.get(Document, UUID(data["id"]))
    targets = await document_targets(db_session, document)
    base, auth = f"/documents/{data['id']}", records[0]
    links = {}
    for kind, target in targets.items():
        response = await client.post(base + "/links", headers=auth,
                                     json={"target_type": kind, "target_id": str(target)})
        assert response.status_code == 201, response.text
        links[kind] = response.json()["id"]
        listing = await client.get("/documents", headers=auth,
                                   params={"target_type": kind, "target_id": str(target)})
        assert [row["id"] for row in listing.json()] == [data["id"]]
    assert (await client.delete(base + f"/links/{links['enrollment']}", headers=auth)).status_code == 204
    active = (await client.get(base + "/links", headers=auth)).json()
    assert {row["target_type"] for row in active} == {"issue", "appeal"}
    history = (await client.get(base + "/links?include_ended=true", headers=auth)).json()
    assert len(history) == 3 and sum(row["ended_at"] is not None for row in history) == 1
    assert (await client.post(base + "/archive", headers=auth)).status_code == 200
    assert (await client.get(base + "/links", headers=auth)).json() == []
    assert len((await client.get(base + "/links?include_ended=true", headers=auth)).json()) == 3
    assert (await client.get(f"/clients/{records[2]}/documents", headers=auth)).json() == []
    for kind, target in targets.items():
        assert (await client.get("/documents", headers=auth,
                                 params={"target_type": kind, "target_id": str(target)})).json() == []
    assert [row["id"] for row in (await client.get("/documents/archived", headers=auth)).json()] == [data["id"]]
    assert (await client.post(base + "/restore", headers=auth)).status_code == 200
    for kind, target in targets.items():
        listing = (await client.get("/documents", headers=auth,
                                    params={"target_type": kind, "target_id": str(target)})).json()
        assert len(listing) == (0 if kind == "enrollment" else 1)
    relink = await client.post(base + "/links", headers=auth,
                               json={"target_type": "enrollment", "target_id": str(targets["enrollment"])})
    assert relink.status_code == 201 and relink.json()["id"] != links["enrollment"]
    assert len(service.storage._objects) == 1
    service.storage.put.assert_called_once()
    service.storage.remove.assert_not_called()
    assert await events(db_session) == [(action, "success") for action in
                                        ["upload", "link", "link", "link", "unlink", "archive", "restore", "link"]]
    rows = (await db_session.execute(select(DocumentEvent))).scalars().all()
    assert all(row.actor_id == document.broker_id and row.client_id == document.client_id
               and row.document_id == document.id for row in rows)


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["link", "unlink", "archive", "restore"])
async def test_transition_audit_failure_rolls_back(client, records, service, db_session, action):
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    data = (await upload(client, records)).json()
    document = await db_session.get(Document, UUID(data["id"]))
    targets = await document_targets(db_session, document)
    base, auth = f"/documents/{data['id']}", records[0]
    payload = {"target_type": "issue", "target_id": str(targets["issue"])}
    if action == "unlink":
        link = (await client.post(base + "/links", headers=auth, json=payload)).json()
    if action == "restore":
        await client.post(base + "/archive", headers=auth)
    before = await events(db_session)
    def fail_audit(session, context, instances):
        if any(isinstance(row, DocumentEvent) and row.action == action for row in session.new):
            raise RuntimeError("audit unavailable")
    event.listen(Session, "before_flush", fail_audit)
    try:
        if action == "unlink":
            response = await client.delete(base + f"/links/{link['id']}", headers=auth)
        else:
            response = await client.post(base + ("/links" if action == "link" else f"/{action}"),
                                         headers=auth, json=payload if action == "link" else None)
        assert response.status_code == 503
    finally:
        event.remove(Session, "before_flush", fail_audit)
    await db_session.refresh(document)
    assert (document.archived_at is not None) == (action == "restore")
    links = (await db_session.execute(select(DocumentLink))).scalars().all()
    assert len(links) == (1 if action == "unlink" else 0)
    assert all(link.ended_at is None for link in links)
    assert await events(db_session) == before


@pytest.mark.asyncio
async def test_document_transition_retries_and_archived_link_guard(client, records, service, db_session):
    data = (await upload(client, records)).json()
    document = await db_session.get(Document, UUID(data["id"]))
    targets = await document_targets(db_session, document)
    base, auth = f"/documents/{data['id']}", records[0]
    payload = {"target_type": "issue", "target_id": str(targets["issue"])}
    created = (await client.post(base + "/links", headers=auth, json=payload)).json()
    for _ in range(2):
        assert (await client.delete(base + f"/links/{created['id']}", headers=auth)).status_code == 204
        assert (await client.post(base + "/archive", headers=auth)).status_code == 200
    assert (await client.post(base + "/links", headers=auth, json=payload)).status_code == 409
    assert len((await client.get(base + "/links?include_ended=true", headers=auth)).json()) == 1
    for _ in range(2):
        assert (await client.post(base + "/restore", headers=auth)).status_code == 200
    assert await events(db_session) == [(action, "success") for action in
                                        ["upload", "link", "unlink", "archive", "restore"]]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["enrollment", "issue", "appeal"])
@pytest.mark.parametrize("dialect", ["sqlite", "asyncpg", "psycopg", "unrelated"])
async def test_only_active_link_integrity_errors_become_conflicts(service, kind, dialect):
    from types import SimpleNamespace
    from sqlalchemy.exc import IntegrityError
    from fastapi import HTTPException

    original = Exception("unrelated foreign key or audit failure")
    constraint = f"uq_document_links_active_{kind}"
    if dialect == "sqlite":
        original = Exception(f"UNIQUE constraint failed: document_links.document_id, document_links.{kind}_id")
    elif dialect == "asyncpg":
        cause = Exception()
        cause.constraint_name = constraint
        original.__cause__ = cause
    elif dialect == "psycopg":
        original.diag = SimpleNamespace(constraint_name=constraint)
    session = SimpleNamespace(commit=AsyncMock(side_effect=IntegrityError("", {}, original)), rollback=AsyncMock())
    with pytest.raises(HTTPException) as caught:
        await service._commit_transition(session, target_type=kind)
    assert caught.value.status_code == (503 if dialect == "unrelated" else 409)
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_duplicate_link_requests_use_database_uniqueness(client, records, service, db_session, tmp_path, monkeypatch):
    # Independent file-backed connections exercise the real unique index race;
    # the suite's shared in-memory connection cannot model concurrent transactions.
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from healthflow.database.config import get_db
    from healthflow.database.models import Base, Broker, Client

    data = (await upload(client, records)).json()
    document = await db_session.get(Document, UUID(data["id"]))
    targets = await document_targets(db_session, document)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'race.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        for model in (Broker, Client, Document, Enrollment, Issue, Appeal):
            for row in (await db_session.execute(select(model))).scalars():
                await session.merge(row)
        await session.commit()
    previous = app.dependency_overrides[get_db]
    async def race_db():
        async with factory() as session:
            yield session
    app.dependency_overrides[get_db] = race_db
    original_link = service.link
    both_ready = asyncio.Event()
    arrivals = 0
    async def concurrent_link(*args):
        nonlocal arrivals
        arrivals += 1
        if arrivals == 2:
            both_ready.set()
        await asyncio.wait_for(both_ready.wait(), timeout=5)
        return await original_link(*args)
    # Synchronize before reads: metadata-read audit INSERTs acquire SQLite's
    # write lock, so a barrier after those reads would deadlock the test itself.
    monkeypatch.setattr(service, "link", concurrent_link)
    try:
        responses = await asyncio.gather(*[
            client.post(f"/documents/{data['id']}/links", headers=records[0],
                        json={"target_type": "issue", "target_id": str(targets["issue"])}) for _ in range(2)],
                                         return_exceptions=True)
        assert sorted(response.status_code for response in responses) == [201, 409]
        async with factory() as session:
            assert len((await session.execute(select(DocumentLink))).scalars().all()) == 1
            assert len((await session.execute(select(DocumentEvent))).scalars().all()) == 1
    finally:
        app.dependency_overrides[get_db] = previous
        await engine.dispose()


@pytest.mark.asyncio
async def test_default_upload_disabled(client, records):
    owner, _, _ = records
    response = await upload(client, records)
    assert response.status_code == 503
    assert (await client.get("/documents/capabilities", headers=owner)).json() == {"upload_enabled": False}


@pytest.mark.asyncio
async def test_demo_upload_conflict_fails_startup(monkeypatch):
    monkeypatch.setenv("SEED_DEMO", "1")
    monkeypatch.setenv("DOCUMENT_UPLOAD_ENABLED", "true")
    with pytest.raises(ValueError, match="SEED_DEMO"):
        async with lifespan(app):
            pytest.fail("conflicting configuration accepted")


@pytest.mark.asyncio
@pytest.mark.parametrize("filename,disposition", [("Synthetic.pdf", "inline"), ("Synthetic.jpg", "inline"),
                                                 ("Synthetic.png", "inline"), ("Synthetic.doc", "attachment"),
                                                 ("Synthetic.docx", "attachment")])
async def test_upload_and_open(client, records, service, db_session, filename, disposition):
    owner, other, client_id = records
    assert (await client.get("/documents/capabilities", headers=owner)).json() == {"upload_enabled": True}
    response = await upload(client, records, filename)
    assert response.status_code == 201, response.text
    data = response.json()
    assert "object_key" not in data
    assert len(service.storage._objects) == 1
    key = next(iter(service.storage._objects))
    UUID(key)
    raw = (await db_session.execute(text("SELECT display_filename FROM documents"))).scalar_one()
    assert filename not in raw
    path = f"/documents/{data['id']}/content"
    assert (await client.get(path)).status_code == 401
    assert (await client.get(path, headers=other)).status_code == 404
    assert (await client.get(f"/documents/{uuid4()}/content", headers=other)).status_code == 404
    opened = await client.get(path, headers=owner)
    assert opened.status_code == 200
    assert opened.content == fixture_bytes(filename)
    assert opened.headers["cache-control"] == "private, no-store"
    assert opened.headers["x-content-type-options"] == "nosniff"
    assert opened.headers["content-disposition"].startswith(disposition)
    assert key not in str(opened.headers)
    assert ("upload", "success") in await events(db_session)
    assert (await events(db_session))[-2:] == [("open", "started"), ("open", "completed")]
    assert len((await client.get(f"/clients/{client_id}/documents", headers=owner)).json()) == 1
    document = (await db_session.execute(select(Document))).scalar_one()
    document.archived_at = _utcnow()
    await db_session.commit()
    assert (await client.get(f"/clients/{client_id}/documents", headers=owner)).json() == []
    assert len((await client.get("/documents/archived", headers=owner)).json()) == 1
    assert (await client.get("/documents/archived", headers=other)).json() == []
    assert (await client.get(path, headers=owner)).content == fixture_bytes(filename)


@pytest.mark.asyncio
async def test_upload_ownership_and_validation(client, records, service):
    owner, other, client_id = records
    for target in (client_id, str(uuid4())):
        rejected = await client.post(f"/clients/{target}/documents", headers=other,
                                     files={"file": ("Synthetic.pdf", fixture_bytes("Synthetic.pdf"))})
        assert rejected.status_code == 404
    await client.delete(f"/clients/{client_id}", headers=owner)
    assert (await upload(client, records)).status_code == 409
    assert service.storage._objects == {}


@pytest.mark.asyncio
async def test_bad_type_and_exact_file_limit(client, records, service):
    owner, _, client_id = records
    response = await client.post(f"/clients/{client_id}/documents", headers=owner,
                                 files={"file": ("Synthetic.pdf", b"invalid")})
    assert response.status_code == 422
    service.max_bytes = 10
    assert (await upload(client, records)).status_code == 413
    assert service.storage._objects == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("fake_length", [None, "1"])
async def test_receive_cap_stops_chunked_multipart_before_unbounded_spooling(client, records, fake_length):
    from healthflow.api.documents_router import DocumentUploadLimitMiddleware

    consumed = 0
    parsed = 0
    limit = 1024 + 65536
    async def receive():
        nonlocal consumed
        consumed += 4096
        return {"type": "http.request", "body": b"x" * 4096, "more_body": True}
    async def parser(scope, receive, send):
        nonlocal parsed
        while True:
            parsed += len((await receive())["body"])
    sent = []
    async def send(message):
        sent.append(message)
    middleware = DocumentUploadLimitMiddleware(parser, max_bytes=1024)
    scope = {"type": "http", "method": "POST", "path": f"/clients/{records[2]}/documents",
             "headers": [] if fake_length is None else [(b"content-length", fake_length.encode())]}
    await middleware(scope, receive, send)
    assert sent[0]["status"] == 413
    assert parsed <= limit
    assert consumed <= limit + 4096


@pytest.mark.asyncio
async def test_missing_object_is_failed_open(client, records, service, db_session):
    data = (await upload(client, records)).json()
    service.storage._objects.clear()
    response = await client.get(f"/documents/{data['id']}/content", headers=records[0])
    assert response.status_code == 503
    assert (await events(db_session))[-2:] == [("open", "started"), ("open", "failed")]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["put", "commit", "cleanup"])
async def test_failed_upload_leaves_no_metadata(client, records, service, db_session, monkeypatch, caplog, failure):
    from sqlalchemy.ext.asyncio import AsyncSession
    if failure == "put":
        service.storage.put = Mock(side_effect=OSError("sensitive-file-name"))
    else:
        real_commit = AsyncSession.commit
        async def fail_document_commit(session):
            if any(isinstance(item, Document) for item in session.new):
                raise RuntimeError("sensitive-file-name")
            await real_commit(session)
        monkeypatch.setattr(AsyncSession, "commit", fail_document_commit)
    service.storage.remove = Mock(wraps=service.storage.remove)
    if failure == "cleanup":
        service.storage.remove.side_effect = OSError("sensitive-file-name")
    assert (await upload(client, records)).status_code == 503
    assert (await db_session.execute(select(Document))).scalars().all() == []
    service.storage.remove.assert_called_once()
    if failure != "cleanup":
        assert service.storage._objects == {}
    else:
        assert "cleanup_failed" in caplog.text
    assert "sensitive-file-name" not in caplog.text


@pytest.mark.asyncio
async def test_audit_failure_never_accesses_content(client, records, service, monkeypatch):
    from sqlalchemy.ext.asyncio import AsyncSession
    data = (await upload(client, records)).json()
    monkeypatch.setattr(AsyncSession, "commit", AsyncMock(side_effect=RuntimeError("audit offline")))
    service.storage.get = Mock(wraps=service.storage.get)
    response = await client.get(f"/documents/{data['id']}/content", headers=records[0])
    assert response.status_code == 503
    service.storage.get.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("interruption", ["send", "read", "disconnect"])
async def test_interrupted_stream_records_failed(client, records, service, db_session, interruption):
    data = (await upload(client, records)).json()
    document = await db_session.get(Document, UUID(data["id"]))
    body = io.BytesIO(fixture_bytes("Synthetic.pdf"))
    if interruption == "read":
        body.read = Mock(side_effect=OSError("read interrupted"))
    service.storage.get = Mock(return_value=body)
    response = await service.open(db_session, document.broker_id, document.id)
    async def receive():
        return {"type": "http.disconnect"}
    async def send(message):
        if interruption == "send" and message["type"] == "http.response.body":
            raise OSError("send interrupted")
    scope = {"type": "http", "asgi": {"spec_version": "2.0" if interruption == "disconnect" else "2.4"}}
    try:
        await response(scope, receive, send)
    except (OSError, RuntimeError, ClientDisconnect):
        pass
    assert body.closed
    assert (await events(db_session))[-2:] == [("open", "started"), ("open", "failed")]


@pytest.mark.asyncio
@pytest.mark.parametrize("fake_length", [None, "1"])
async def test_real_multipart_parser_caps_and_closes_spools(client, records, service, monkeypatch, fake_length):
    import tempfile
    import starlette.formparsers

    monkeypatch.setattr(app.state, "document_max_bytes", 1024, raising=False)
    spools = []
    sizes = []
    class ObservedSpool(tempfile.SpooledTemporaryFile):
        def close(self):
            if not self.closed:
                sizes.append(self.tell())
            super().close()
    def spool(*args, **kwargs):
        result = ObservedSpool(*args, **kwargs)
        spools.append(result)
        return result
    monkeypatch.setattr(starlette.formparsers, "SpooledTemporaryFile", spool)
    yielded = 0
    async def multipart():
        nonlocal yielded
        yield b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="Synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n'
        for _ in range(1000):
            yielded += 4096
            yield b"x" * 4096
        yield b"\r\n--boundary--\r\n"
    headers = {**records[0], "content-type": "multipart/form-data; boundary=boundary",
               "origin": "http://localhost:5173"}
    if fake_length:
        headers["content-length"] = fake_length
    response = await client.post(f"/clients/{records[2]}/documents", headers=headers, content=multipart())
    assert response.status_code == 413, response.text
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "origin" in response.headers["vary"].lower()
    assert yielded < 100000
    assert spools and all(s.closed for s in spools)
    assert max(sizes) <= 1024 + 65536
    assert service.storage._objects == {}


@pytest.mark.asyncio
async def test_parser_and_storage_work_off_event_loop(client, records, service, monkeypatch):
    import healthflow.workspace.document_validation as validation

    event_thread = threading.get_ident()
    worker_threads = []
    def observe(function):
        def wrapped(*args, **kwargs):
            worker_threads.append(threading.get_ident())
            return function(*args, **kwargs)
        return wrapped
    monkeypatch.setattr(validation, "_verify", observe(validation._verify))
    monkeypatch.setattr(service.storage, "put", observe(service.storage.put))
    monkeypatch.setattr(service.storage, "get", observe(service.storage.get))
    data = (await upload(client, records)).json()
    response = await client.get(f"/documents/{data['id']}/content", headers=records[0])
    assert response.status_code == 200
    assert len(worker_threads) == 3
    assert all(thread != event_thread for thread in worker_threads)


@pytest.mark.asyncio
async def test_outcome_audit_failure_preserves_started_and_logs_only_metadata(client, records, service, db_session, caplog):
    data = (await upload(client, records)).json()
    service.session_factory = Mock(side_effect=RuntimeError("secret filename and credentials"))
    response = await client.get(f"/documents/{data['id']}/content", headers=records[0])
    assert response.status_code == 200
    assert response.content == fixture_bytes("Synthetic.pdf")
    assert (await events(db_session))[-1] == ("open", "started")
    assert "document_outcome_audit_failed" in caplog.text
    assert "secret filename and credentials" not in caplog.text
