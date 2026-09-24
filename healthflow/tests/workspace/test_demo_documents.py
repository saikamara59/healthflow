"""Disposable synthetic Documents: exact reset and no archive revival."""
import pytest
from sqlalchemy import select

from healthflow.auth.tenant_context import current_broker_id
from healthflow.database.models import Broker, Client, Document, DocumentEvent, DocumentLink, Enrollment, _utcnow
from healthflow.workspace.demo_documents import DEMO_FIXTURE_MARKERS, seed_demo_documents, reset_demo_documents
from healthflow.workspace.document_storage import FakeDocumentStorage


async def setup_demo(db, monkeypatch):
    monkeypatch.setenv("SEED_DEMO", "1")
    broker = Broker(email="demo@healthflow.work", full_name="Demo", hashed_password="unused")
    admin = Broker(email="admin@example.test", full_name="Admin", hashed_password="unused", role="admin", is_active=True)
    db.add_all([broker, admin])
    await db.flush()
    db.add(Client(broker_id=broker.id, full_name="Eleanor Rigby", zip_code="10001", age=67, income_level="low"))
    await db.commit()
    return broker, admin


@pytest.mark.anyio
async def test_seed_idempotent_and_preserves_archive(db_session, monkeypatch):
    broker, _ = await setup_demo(db_session, monkeypatch)
    store = FakeDocumentStorage()
    assert await seed_demo_documents(db_session, store, broker.id) == 3
    documents = (await db_session.scalars(select(Document))).all()
    ids = {row.id for row in documents}
    documents[0].archived_at = _utcnow()
    await db_session.commit()
    objects = dict(store._objects)
    assert await seed_demo_documents(db_session, store, broker.id) == 0
    assert {row.id for row in (await db_session.scalars(select(Document))).all()} == ids
    assert documents[0].archived_at is not None
    assert store._objects == objects
    client = (await db_session.scalars(select(Client))).one()
    client.full_name = "Renamed synthetic Client"
    await db_session.commit()
    assert await seed_demo_documents(db_session, store, broker.id) == 0


@pytest.mark.anyio
async def test_reset_exact_fixture_preserves_other_objects_and_history(db_session, monkeypatch):
    broker, admin = await setup_demo(db_session, monkeypatch)
    store = FakeDocumentStorage()
    await seed_demo_documents(db_session, store, broker.id)
    selected = (await db_session.scalars(select(Document).where(Document.demo_fixture_marker == DEMO_FIXTURE_MARKERS[0]))).one()
    selected_id, key = selected.id, selected.object_key
    unrelated = Document(broker_id=broker.id, client_id=selected.client_id, display_filename="unrelated.pdf", verified_type="pdf", byte_length=1, object_key="unrelated")
    db_session.add(unrelated)
    enrollment = Enrollment(broker_id=broker.id, client_id=selected.client_id, plan_name="Synthetic")
    other_client = Client(broker_id=admin.id, full_name="Other invented person", zip_code="00000", age=20, income_level="low")
    db_session.add_all([enrollment, other_client])
    await db_session.flush()
    db_session.add(DocumentLink(broker_id=broker.id, client_id=selected.client_id, document_id=selected.id, enrollment_id=enrollment.id))
    other = Document(broker_id=admin.id, client_id=other_client.id, demo_fixture_marker=DEMO_FIXTURE_MARKERS[0], display_filename="other.pdf", verified_type="pdf", byte_length=1, object_key="other")
    db_session.add(other)
    await db_session.commit()
    store._objects["unrelated"] = b"untouched"
    store._objects["other"] = b"other broker"
    token = current_broker_id.set(admin.id)
    try:
        assert await reset_demo_documents(db_session, store, broker.id, [DEMO_FIXTURE_MARKERS[0]]) == 1
    finally:
        current_broker_id.reset(token)
    assert key not in store._objects
    assert store._objects["unrelated"] == b"untouched"
    assert store._objects["other"] == b"other broker"
    assert len((await db_session.scalars(select(Document))).all()) == 4
    assert (await db_session.scalars(select(DocumentLink))).all() == []
    events = (await db_session.scalars(select(DocumentEvent).where(DocumentEvent.document_id == selected_id))).all()
    assert {e.action for e in events} == {"seed", "demo_reset"}
    assert await seed_demo_documents(db_session, store, broker.id) == 1


@pytest.mark.anyio
async def test_reset_requires_admin_and_exact_markers(db_session, monkeypatch):
    broker, admin = await setup_demo(db_session, monkeypatch)
    store = FakeDocumentStorage()
    await seed_demo_documents(db_session, store, broker.id)
    token = current_broker_id.set(broker.id)
    try:
        with pytest.raises(PermissionError):
            await reset_demo_documents(db_session, store, broker.id, [DEMO_FIXTURE_MARKERS[0]])
    finally:
        current_broker_id.reset(token)
    token = current_broker_id.set(admin.id)
    try:
        for markers in ([], ["*"], ["unknown"], None, "*"):
            with pytest.raises(ValueError):
                await reset_demo_documents(db_session, store, broker.id, markers)
    finally:
        current_broker_id.reset(token)
    assert len(store._objects) == 3


@pytest.mark.anyio
async def test_seed_rejects_non_demo_and_preserves_archived_client(db_session, monkeypatch):
    broker, admin = await setup_demo(db_session, monkeypatch)
    store = FakeDocumentStorage()
    with pytest.raises(PermissionError):
        await seed_demo_documents(db_session, store, admin.id)
    monkeypatch.setenv("SEED_DEMO", "0")
    with pytest.raises(PermissionError):
        await seed_demo_documents(db_session, store, broker.id)
    monkeypatch.setenv("SEED_DEMO", "1")
    client = (await db_session.scalars(select(Client))).one()
    client.archived_at = _utcnow()
    await db_session.commit()
    assert await seed_demo_documents(db_session, store, broker.id) == 0
    assert store._objects == {}


@pytest.mark.anyio
async def test_seed_cleans_object_after_database_failure(db_session, monkeypatch):
    broker, _ = await setup_demo(db_session, monkeypatch)
    store = FakeDocumentStorage()

    async def fail():
        raise RuntimeError("database failure")

    monkeypatch.setattr(db_session, "commit", fail)
    with pytest.raises(RuntimeError):
        await seed_demo_documents(db_session, store, broker.id)
    assert store._objects == {}
    assert (await db_session.scalars(select(Document))).all() == []


@pytest.mark.anyio
async def test_reset_storage_failure_retains_metadata_and_durable_attempt(db_session, monkeypatch):
    broker, admin = await setup_demo(db_session, monkeypatch)
    store = FakeDocumentStorage()
    await seed_demo_documents(db_session, store, broker.id)

    def fail(key):
        raise OSError("unavailable")

    monkeypatch.setattr(store, "remove", fail)
    token = current_broker_id.set(admin.id)
    try:
        with pytest.raises(OSError):
            await reset_demo_documents(db_session, store, broker.id, [DEMO_FIXTURE_MARKERS[0]])
    finally:
        current_broker_id.reset(token)
    assert len((await db_session.scalars(select(Document))).all()) == 3
    attempts = (await db_session.scalars(select(DocumentEvent).where(DocumentEvent.action == "demo_reset"))).all()
    assert [row.outcome for row in attempts] == ["started"]


def test_deploy_packages_fixture_sources_and_keeps_upload_disabled():
    import tomllib
    from pathlib import Path
    root = Path(__file__).resolve().parents[3]
    assert "COPY demo_documents/ demo_documents/" in (root / "Dockerfile").read_text()
    config = tomllib.loads((root / "fly.toml").read_text())
    assert config["env"]["SEED_DEMO"] == "1"
    assert config["env"]["DOCUMENT_UPLOAD_ENABLED"] == "0"


def test_entrypoint_fails_after_ready_when_document_seed_fails(tmp_path):
    import os
    from pathlib import Path
    import subprocess
    root = Path(__file__).resolve().parents[3]
    for name, script in {
        "uvicorn": "#!/bin/sh\nexec sleep 30\n",
        "python": '#!/bin/sh\nif [ "$1" = "-c" ]; then exit 0; fi\nexit 1\n',
    }.items():
        path = tmp_path / name
        path.write_text(script)
        path.chmod(0o700)
    result = subprocess.run(["sh", str(root / "scripts/demo_entrypoint.sh")],
                            env={**os.environ, "SEED_DEMO": "1", "PATH": f"{tmp_path}:{os.environ['PATH']}"},
                            capture_output=True, text=True, timeout=5)
    assert result.returncode == 1
    assert "backend healthy" in result.stdout and "demo seeding failed" in result.stdout
    assert "handing off" not in result.stdout


@pytest.mark.anyio
async def test_admin_cli_preview_then_confirm_with_fake_store(db_session, db_session_factory, monkeypatch, capsys):
    from argparse import Namespace
    from healthflow.auth import security
    from healthflow.database import config
    from healthflow.workspace.document_storage import S3DocumentStorage
    from scripts.reset_demo_documents import reset
    broker, admin = await setup_demo(db_session, monkeypatch)
    store = FakeDocumentStorage()
    await seed_demo_documents(db_session, store, broker.id)
    original = dict(store._objects)
    monkeypatch.setattr(config, "async_session_factory", db_session_factory)
    monkeypatch.setattr(security, "verify_password", lambda password, hashed: password == "synthetic-test-password")
    calls = []

    def fake_store():
        calls.append(True)
        return store

    monkeypatch.setattr(S3DocumentStorage, "from_environment", fake_store)
    args = Namespace(admin_email=admin.email, fixture=[DEMO_FIXTURE_MARKERS[0]], confirm=False)
    with pytest.raises(PermissionError):
        await reset(args, "wrong")
    await reset(args, "synthetic-test-password")
    assert not calls and store._objects == original
    args.confirm = True
    await reset(args, "synthetic-test-password")
    assert calls == [True] and len(store._objects) == 3
    output = capsys.readouterr().out
    assert "Matched Documents: 1" in output and "Removed: 1; seeded: 1" in output
    assert "synthetic-test-password" not in output
    assert not any(key in output for key in original)
