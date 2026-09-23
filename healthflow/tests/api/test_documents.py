"""Protected synthetic Documents: API authorization and durable stream outcomes."""

import io
import threading
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from starlette.requests import ClientDisconnect

from healthflow.database.models import Document, DocumentEvent, _utcnow
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
