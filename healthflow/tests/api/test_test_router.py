"""Tests for the env-gated /__test/reset endpoint.

Each test reloads healthflow.main after setting the env var, then builds
a fresh AsyncClient against the reloaded app. We can't reuse the shared
`client` fixture from conftest.py because it captures `app` at import time.

Note: this suite covers env-gating and that the endpoint returns 200.
The actual seeding correctness is covered by:
  - healthflow/tests/test_seed_data.py (seed_for_worker unit tests)
  - the e2e test stack (frontend/tests/e2e/) which exercises the seeded
    broker via real login

We don't assert post-reset DB state here because the endpoint uses the
production async_session_factory directly (so DDL and DML stay on the
same engine inside docker), while pytest fixtures use a separate
in-memory engine — the two diverge in tests.
"""
from importlib import reload
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from healthflow.auth.tenant_context import system_context
from healthflow.database.models import (
    Appeal,
    Appointment,
    Approval,
    Broker,
    BrokerPreference,
    Client,
    Contact,
    Enrollment,
    Issue,
    Organization,
    Task,
    WorkspaceActivity,
)
from healthflow.seed_data import worker_email


@pytest.fixture(autouse=True)
def isolated_database_url(monkeypatch, tmp_path):
    """Point the reloaded production config at a temporary database.

    Without this, DATABASE_URL falls back to sqlite:///healthflow.db and every
    reset seeds test-key-encrypted clients into the developer's local database.
    """
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'reset.sqlite'}")


async def _build_client(db_session_factory):
    """Reload healthflow.main and return an AsyncClient against the fresh app.

    Calls create_all and schema bridges on the reloaded engine to mirror what
    app startup does — ASGITransport bypasses lifespan, so tables and columns
    must be initialized here directly.
    """
    import healthflow.database.config as db_config
    reload(db_config)
    import healthflow.api.test_router as test_router_module
    reload(test_router_module)
    import healthflow.main as main_module
    reload(main_module)
    app = main_module.app

    from healthflow.database.models import Base
    from healthflow.database.schema_migrations import (
        ensure_client_archive_column, ensure_phase2_issue_links,
    )
    async with db_config.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(ensure_phase2_issue_links)
        await conn.run_sync(ensure_client_archive_column)

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test"), app


@pytest.mark.anyio
async def test_reset_endpoint_returns_404_when_test_mode_off(monkeypatch, db_session_factory):
    monkeypatch.delenv("HEALTHFLOW_TEST_MODE", raising=False)
    monkeypatch.delenv("HEALTHFLOW_ENABLE_TEST_ROUTES", raising=False)
    client_, app = await _build_client(db_session_factory)
    try:
        response = await client_.post("/__test/reset", json={"worker_id": "e2e-worker-0"})
        assert response.status_code == 404
    finally:
        await client_.aclose()
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_reset_endpoint_returns_200_with_valid_worker_id(monkeypatch, db_session_factory):
    monkeypatch.setenv("HEALTHFLOW_TEST_MODE", "1")
    client_, app = await _build_client(db_session_factory)
    try:
        response = await client_.post("/__test/reset", json={"worker_id": "e2e-worker-0"})
        assert response.status_code == 200
        assert response.json() == {"status": "reset", "worker_id": "e2e-worker-0"}
    finally:
        await client_.aclose()
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_reset_initialization_bridges_old_clients_table(monkeypatch, tmp_path, db_session_factory):
    from healthflow.database.models import Base

    database_url = f"sqlite+aiosqlite:///{tmp_path / 'legacy-reset.sqlite'}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("HEALTHFLOW_TEST_MODE", "1")
    engine = create_async_engine(database_url)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(text("ALTER TABLE clients DROP COLUMN archived_at"))
    await engine.dispose()

    client_, app = await _build_client(db_session_factory)
    try:
        response = await client_.post("/__test/reset", json={"worker_id": "e2e-worker-77"})
        assert response.status_code == 200
        import healthflow.database.config as db_config
        async with db_config.engine.begin() as connection:
            columns = await connection.run_sync(
                lambda sync_connection: [column["name"] for column in inspect(sync_connection).get_columns("clients")]
            )
        assert columns.count("archived_at") == 1
    finally:
        await client_.aclose()
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_reset_endpoint_rejects_missing_body(monkeypatch, db_session_factory):
    monkeypatch.setenv("HEALTHFLOW_TEST_MODE", "1")
    client_, app = await _build_client(db_session_factory)
    try:
        response = await client_.post("/__test/reset")
        assert response.status_code == 422
    finally:
        await client_.aclose()
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_reset_endpoint_rejects_malformed_worker_id(monkeypatch, db_session_factory):
    monkeypatch.setenv("HEALTHFLOW_TEST_MODE", "1")
    client_, app = await _build_client(db_session_factory)
    try:
        response = await client_.post("/__test/reset", json={"worker_id": "not-a-worker"})
        assert response.status_code == 422
    finally:
        await client_.aclose()
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_reset_removes_workspace_records_before_reseeding_clients(monkeypatch, db_session_factory):
    monkeypatch.setenv("HEALTHFLOW_TEST_MODE", "1")
    client_, app = await _build_client(db_session_factory)
    import healthflow.api.test_router as test_router_module

    monkeypatch.setattr(test_router_module, "async_session_factory", db_session_factory)
    worker_id = "e2e-worker-999"
    try:
        first_reset = await client_.post("/__test/reset", json={"worker_id": worker_id})
        assert first_reset.status_code == 200

        async with db_session_factory() as session:
            with system_context("seed workspace records before e2e reset"):
                broker = (
                    await session.execute(select(Broker).where(Broker.email == worker_email(worker_id)))
                ).scalar_one()
                seeded_client = (
                    await session.execute(select(Client).where(Client.broker_id == broker.id))
                ).scalars().first()
                organization = Organization(broker_id=broker.id, name="Reset Co", kind="carrier")
                session.add(organization)
                await session.flush()
                contact = Contact(
                    broker_id=broker.id, organization_id=organization.id, full_name="Reset Contact"
                )
                task = Task(broker_id=broker.id, title="Reset Task")
                appointment = Appointment(
                    broker_id=broker.id,
                    title="Reset Meeting",
                    starts_at=datetime(2026, 9, 17, 14, tzinfo=timezone.utc),
                    ends_at=datetime(2026, 9, 17, 15, tzinfo=timezone.utc),
                )
                preference = BrokerPreference(broker_id=broker.id, timezone_name="America/New_York")
                enrollment = Enrollment(
                    broker_id=broker.id,
                    client_id=seeded_client.id,
                    plan_name="Reset Plan",
                )
                issue = Issue(
                    broker_id=broker.id,
                    client_id=seeded_client.id,
                    title="Reset Issue",
                )
                approval = Approval(
                    broker_id=broker.id, client_id=seeded_client.id, kind="task",
                    proposer_agent="ask_healthflow", excerpt="Reset proposal",
                    proposed_values={"title": "Reset Task"}, state="approved",
                )
                session.add(approval)
                await session.flush()
                task.approval_id = approval.id
                session.add_all([contact, task, appointment, preference, enrollment, issue])
                await session.flush()
                session.add(Appeal(broker_id=broker.id, issue_id=issue.id, title="Reset Appeal"))
                session.add(
                    WorkspaceActivity(
                        broker_id=broker.id,
                        entity_type="task",
                        entity_id=task.id,
                        action="completed",
                        summary="Reset Task completed",
                    )
                )
                await session.commit()

        second_reset = await client_.post("/__test/reset", json={"worker_id": worker_id})
        assert second_reset.status_code == 200
        async with db_session_factory() as session:
            with system_context("verify workspace e2e reset"):
                for model in (
                    WorkspaceActivity,
                    Appeal,
                    Appointment,
                    Task,
                    Approval,
                    Issue,
                    Enrollment,
                    Contact,
                    Organization,
                    BrokerPreference,
                ):
                    assert (await session.execute(select(model))).scalars().all() == []
    finally:
        await client_.aclose()
        app.dependency_overrides.clear()
