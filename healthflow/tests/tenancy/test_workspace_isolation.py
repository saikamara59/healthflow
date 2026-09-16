import pytest
from sqlalchemy import select

from healthflow.auth.tenant_context import current_broker_id, system_context
from healthflow.database.models import (
    Appointment,
    Broker,
    BrokerPreference,
    Contact,
    Organization,
    Task,
    WorkspaceActivity,
)
from healthflow.database.phi_audit import _AUDITED_MODELS
from healthflow.database.tenant_filter import TENANT_SCOPED_MODELS


def test_workspace_records_require_broker_scoping():
    """Unscoped workspace queries could expose another Broker's records."""
    assert {
        BrokerPreference,
        Organization,
        Contact,
        Task,
        Appointment,
        WorkspaceActivity,
    } <= TENANT_SCOPED_MODELS


def test_phi_bearing_workspace_records_are_audited():
    """Reads and writes of workspace PHI must leave access evidence."""
    assert {
        Organization,
        Contact,
        Task,
        Appointment,
        WorkspaceActivity,
    } <= _AUDITED_MODELS


@pytest.mark.asyncio
async def test_task_queries_show_only_the_current_brokers_records(db_session_factory):
    async with db_session_factory() as session:
        with system_context("seed workspace tenant-isolation test"):
            broker_a = Broker(email="workspace-a@example.com", hashed_password="hash", full_name="A")
            broker_b = Broker(email="workspace-b@example.com", hashed_password="hash", full_name="B")
            session.add_all([broker_a, broker_b])
            await session.flush()
            task_a = Task(broker_id=broker_a.id, title="A's task")
            task_b = Task(broker_id=broker_b.id, title="B's task")
            session.add_all([task_a, task_b])
            await session.commit()

        for broker, expected_task in ((broker_a, task_a), (broker_b, task_b)):
            token = current_broker_id.set(broker.id)
            try:
                result = await session.execute(select(Task))
                assert [task.id for task in result.scalars().all()] == [expected_task.id]
            finally:
                current_broker_id.reset(token)
