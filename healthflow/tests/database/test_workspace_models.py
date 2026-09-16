from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select


@pytest.mark.asyncio
async def test_workspace_records_persist_with_safe_default_states(db_session):
    """Removing workspace models or their default states breaks daily work."""
    from healthflow.database.models import (
        Appointment,
        Broker,
        BrokerPreference,
        Contact,
        Organization,
        Task,
        WorkspaceActivity,
    )

    broker = Broker(
        email="workspace-models@example.com",
        hashed_password="hash",
        full_name="Workspace Broker",
        is_active=True,
    )
    db_session.add(broker)
    await db_session.flush()

    organization = Organization(
        broker_id=broker.id,
        name="Harbor Health",
        kind="carrier",
    )
    db_session.add(organization)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    contact = Contact(
        broker_id=broker.id,
        organization_id=organization.id,
        full_name="Dana Ruiz",
        email="dana@example.com",
    )
    task = Task(broker_id=broker.id, title="Call Maria")
    appointment = Appointment(
        broker_id=broker.id,
        title="Enrollment review",
        starts_at=now + timedelta(hours=1),
        ends_at=now + timedelta(hours=2),
    )
    preference = BrokerPreference(
        broker_id=broker.id,
        timezone_name="America/New_York",
    )
    db_session.add_all([contact, task, appointment, preference])
    await db_session.flush()

    activity = WorkspaceActivity(
        broker_id=broker.id,
        entity_type="task",
        entity_id=task.id,
        action="completed",
        summary="Completed Call Maria",
    )
    db_session.add(activity)
    await db_session.flush()

    saved_task = (await db_session.execute(select(Task))).scalar_one()
    saved_appointment = (await db_session.execute(select(Appointment))).scalar_one()
    saved_activity = (await db_session.execute(select(WorkspaceActivity))).scalar_one()

    assert saved_task.status == "open"
    assert saved_task.is_follow_up is False
    assert saved_appointment.status == "scheduled"
    assert preference.timezone_name == "America/New_York"
    assert saved_activity.entity_id == task.id
