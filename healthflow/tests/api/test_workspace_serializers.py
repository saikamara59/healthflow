"""Derived workspace presentation state is not stored as a database status."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from healthflow.database.models import Appointment, Task
from healthflow.workspace import serializers


def test_open_past_due_task_is_presented_as_overdue():
    now = datetime.now(timezone.utc)
    task = Task(
        id=uuid4(), broker_id=uuid4(), title="Call Client", status="open",
        is_follow_up=False, due_at=now - timedelta(hours=1),
        created_at=now, updated_at=now,
    )

    response = serializers.task_response(task)

    assert response.is_overdue is True
    assert task.status == "open"


def test_completed_past_due_task_is_not_overdue():
    now = datetime.now(timezone.utc)
    task = Task(
        id=uuid4(), broker_id=uuid4(), title="Call Client", status="completed",
        is_follow_up=False, due_at=now - timedelta(hours=1),
        created_at=now, updated_at=now,
    )

    assert serializers.task_response(task).is_overdue is False


def test_past_scheduled_appointment_needs_follow_up_without_status_change():
    now = datetime.now(timezone.utc)
    appointment = Appointment(
        id=uuid4(), broker_id=uuid4(), title="Plan review", status="scheduled",
        starts_at=now - timedelta(hours=2), ends_at=now - timedelta(hours=1),
        created_at=now, updated_at=now,
    )

    response = serializers.appointment_response(appointment)

    assert response.presentation_status == "needs_follow_up"
    assert appointment.status == "scheduled"
