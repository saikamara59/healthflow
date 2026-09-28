"""Behavioral regressions for archive eligibility and upload transaction boundaries."""

import asyncio
import io
import threading
from uuid import UUID

import pytest
import pytest_asyncio
from fastapi import HTTPException, UploadFile
from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from healthflow.api.client_router import archive_client, restore_client
from healthflow.database.models import Base, Broker, Client, Document, WorkspaceActivity
from healthflow.tests.api import test_documents
from healthflow.tests.api.test_enrollments import _client_record
from healthflow.tests.fixtures.documents import fixture_bytes

records = test_documents.records
service = test_documents.service


@pytest.mark.asyncio
async def test_archived_client_search_excludes_before_candidate_limit(client, records, db_session):
    auth, _, client_id = records
    for index in range(30):
        row = await _client_record(client, auth, f"Archivepressure {index}")
        await client.post(f"/clients/{row['id']}/archive", headers=auth)
    active = await _client_record(client, auth, "Archivepressure active")
    result = await client.get('/workspace/search?q=Archivepressure&limit=1', headers=auth)
    assert result.status_code == 200, result.text
    assert [row['id'] for row in result.json()] == [active['id']]
    await client.post(f"/clients/{active['id']}/archive", headers=auth)
    assert (await client.get('/workspace/search?q=Archivepressure', headers=auth)).json() == []
    await client.post(f"/clients/{active['id']}/restore", headers=auth)
    assert [row['id'] for row in (await client.get('/workspace/search?q=Archivepressure', headers=auth)).json()] == [active['id']]


@pytest.mark.asyncio
async def test_repeated_client_archive_delete_and_restore_have_one_activity(client, records, db_session):
    auth, _, client_id = records
    first = (await client.post(f'/clients/{client_id}/archive', headers=auth)).json()
    await client.delete(f'/clients/{client_id}', headers=auth)
    again = (await client.post(f'/clients/{client_id}/archive', headers=auth)).json()
    assert again['archived_at'] == first['archived_at']
    for _ in range(2):
        assert (await client.post(f'/clients/{client_id}/restore', headers=auth)).status_code == 200
    actions = (await db_session.scalars(select(WorkspaceActivity.action).where(
        WorkspaceActivity.client_id == UUID(client_id), WorkspaceActivity.action.in_(['archived', 'restored']),
    ))).all()
    assert sorted(actions) == ['archived', 'restored']


@pytest_asyncio.fixture
async def race_records(tmp_path, db_session):
    # Real independent connections and WAL snapshots, not shared-memory transactions.
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'archive-race.db'}")
    async with engine.begin() as connection:
        await connection.execute(text('PRAGMA journal_mode=WAL'))
        await connection.run_sync(Base.metadata.create_all)
    # Disable sqlite3 legacy transaction behavior: reads now really retain WAL
    # snapshots, so a missing pre-storage transaction release is observable.
    await engine.dispose()
    @event.listens_for(engine.sync_engine, 'connect')
    def explicit_transactions(connection, _):
        connection.isolation_level = None
    @event.listens_for(engine.sync_engine, 'begin')
    def begin(connection):
        connection.exec_driver_sql('BEGIN')
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        broker = Broker(email='synthetic-race@example.com', hashed_password='unused', full_name='Synthetic Broker')
        session.add(broker)
        await session.flush()
        record = Client(broker_id=broker.id, full_name='Synthetic race', zip_code='10001', age=40,
                        income_level='medium', doctors=[], prescriptions=[], procedures=[])
        session.add(record)
        await session.commit()
        broker_id, client_id = broker.id, record.id
    yield factory, broker_id, client_id
    await engine.dispose()


@pytest.mark.asyncio
async def test_issue_history_exposes_client_archive_eligibility(client, records):
    auth, _, client_id = records
    issue = (await client.post('/issues', headers=auth, json={'client_id': client_id, 'title': 'History'})).json()
    assert issue['client_archived'] is False
    await client.post(f'/clients/{client_id}/archive', headers=auth)
    assert (await client.get('/issues', headers=auth)).json()[0]['client_archived'] is True
    assert (await client.get(f"/issues/{issue['id']}", headers=auth)).json()['client_archived'] is True
    await client.post(f'/clients/{client_id}/restore', headers=auth)
    assert (await client.get(f"/issues/{issue['id']}", headers=auth)).json()['client_archived'] is False


@pytest.mark.asyncio
async def test_concurrent_archive_restore_records_only_actual_transitions(race_records):
    factory, broker_id, client_id = race_records
    async def transition(action):
        async with factory() as session:
            broker = await session.get(Broker, broker_id)
            response = await action(str(client_id), broker, session)
            await session.commit()
            return response
    archived = await asyncio.gather(transition(archive_client), transition(archive_client))
    assert archived[0].archived_at == archived[1].archived_at
    await asyncio.gather(transition(restore_client), transition(restore_client))
    async with factory() as session:
        actions = (await session.scalars(select(WorkspaceActivity.action))).all()
        assert sorted(actions) == ['archived', 'restored']


@pytest.mark.asyncio
async def test_client_archive_during_storage_put_rejects_upload(race_records, service, monkeypatch):
    factory, broker_id, client_id = race_records
    service.session_factory = factory
    entered, release = threading.Event(), threading.Event()
    original_put = service.storage.put
    def paused_put(*args):
        original_put(*args)
        entered.set()
        assert release.wait(10), 'test did not release storage PUT'
    monkeypatch.setattr(service.storage, 'put', paused_put)
    async with factory() as uploading:
        pending = asyncio.create_task(service.upload(uploading, broker_id, client_id,
            UploadFile(io.BytesIO(fixture_bytes('Synthetic.pdf')), filename='Synthetic.pdf')))
        try:
            assert await asyncio.to_thread(entered.wait, 5)
            async with factory() as archiving:
                broker = await archiving.get(Broker, broker_id)
                await archive_client(str(client_id), broker, archiving)
                await archiving.commit()
            release.set()
            with pytest.raises(HTTPException) as caught:
                await pending
            assert caught.value.status_code == 409
            async with factory() as checking:
                assert (await checking.scalars(select(Document))).all() == []
            assert service.storage._objects == {}
        finally:
            release.set()
            if not pending.done():
                await pending


@pytest.mark.asyncio
@pytest.mark.parametrize('cancelled', [False, True])
async def test_commit_then_error_keeps_committed_document_bytes(race_records, service, monkeypatch, cancelled):
    factory, broker_id, client_id = race_records
    service.session_factory = factory
    async with factory() as session:
        real_commit = session.commit
        async def commit_then_error():
            metadata_commit = any(isinstance(row, Document) for row in session.new)
            await real_commit()
            if metadata_commit:
                raise asyncio.CancelledError() if cancelled else RuntimeError('secret provider text')
        monkeypatch.setattr(session, 'commit', commit_then_error)
        with pytest.raises(asyncio.CancelledError if cancelled else HTTPException):
            await service.upload(session, broker_id, client_id,
                UploadFile(io.BytesIO(fixture_bytes('Synthetic.pdf')), filename='Synthetic.pdf'))
    async with factory() as checking:
        document = (await checking.scalars(select(Document))).one()
        assert service.storage.get(document.object_key).read() == fixture_bytes('Synthetic.pdf')


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['verification', 'rollback'])
async def test_unknown_commit_outcome_retains_bytes(race_records, service, monkeypatch, caplog, failure):
    factory, broker_id, client_id = race_records
    service.session_factory = factory
    async def unavailable():
        raise RuntimeError('secret provider text')
    async with factory() as session:
        real_commit = session.commit
        async def fail_metadata_commit():
            if any(isinstance(row, Document) for row in session.new):
                await unavailable()
            await real_commit()
        monkeypatch.setattr(session, 'commit', fail_metadata_commit)
        if failure == 'rollback':
            monkeypatch.setattr(session, 'rollback', unavailable)
        else:
            def unavailable_factory():
                raise RuntimeError('secret provider text')
            service.session_factory = unavailable_factory
        with pytest.raises(HTTPException):
            await service.upload(session, broker_id, client_id,
                UploadFile(io.BytesIO(fixture_bytes('Synthetic.pdf')), filename='Synthetic.pdf'))
        assert len(service.storage._objects) == 1
        assert 'secret provider text' not in caplog.text


@pytest.mark.asyncio
async def test_upload_commit_serializes_before_later_archive(race_records, service, monkeypatch):
    factory, broker_id, client_id = race_records
    service.session_factory = factory
    ready, release = asyncio.Event(), asyncio.Event()
    async with factory() as session:
        real_commit = session.commit
        async def paused_commit():
            if any(isinstance(row, Document) for row in session.new):
                ready.set()
                await release.wait()
            await real_commit()
        monkeypatch.setattr(session, 'commit', paused_commit)
        pending = asyncio.create_task(service.upload(session, broker_id, client_id,
            UploadFile(io.BytesIO(fixture_bytes('Synthetic.pdf')), filename='Synthetic.pdf')))
        async def archive():
            async with factory() as archiving:
                broker = await archiving.get(Broker, broker_id)
                await archive_client(str(client_id), broker, archiving)
                await archiving.commit()
        await asyncio.wait_for(ready.wait(), 5)
        archiving = asyncio.create_task(archive())
        try:
            completed, _ = await asyncio.wait([archiving], timeout=0.1)
            assert not completed, 'archive passed the uncommitted upload Client lock'
        finally:
            release.set()
        document = await pending
        await archiving
        assert service.storage.get(document.object_key).read() == fixture_bytes('Synthetic.pdf')
    async with factory() as checking:
        assert (await checking.get(Client, client_id)).archived_at is not None
        assert await checking.get(Document, document.id) is not None


@pytest.mark.asyncio
async def test_cancel_before_metadata_commit_cleans_uncommitted_bytes(race_records, service, monkeypatch):
    factory, broker_id, client_id = race_records
    service.session_factory = factory
    async with factory() as session:
        real_commit = session.commit
        async def cancel_metadata_commit():
            if any(isinstance(row, Document) for row in session.new):
                raise asyncio.CancelledError()
            await real_commit()
        monkeypatch.setattr(session, 'commit', cancel_metadata_commit)
        with pytest.raises(asyncio.CancelledError):
            await service.upload(session, broker_id, client_id,
                UploadFile(io.BytesIO(fixture_bytes('Synthetic.pdf')), filename='Synthetic.pdf'))
    assert service.storage._objects == {}
    async with factory() as checking:
        assert (await checking.scalars(select(Document))).all() == []
