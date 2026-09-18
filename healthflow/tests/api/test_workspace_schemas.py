from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError


def test_task_create_rejects_naive_due_time():
    """A due time without a zone could be stored on the wrong UTC day."""
    from healthflow.workspace.schemas import TaskCreate

    with pytest.raises(ValidationError, match="timezone"):
        TaskCreate(title="Call Maria", due_at=datetime(2026, 9, 16, 17, 0))


def test_appointment_create_rejects_end_before_start():
    """Invalid intervals must not become Scheduled Appointments."""
    from healthflow.workspace.schemas import AppointmentCreate

    starts_at = datetime(2026, 9, 16, 17, 0, tzinfo=timezone.utc)
    with pytest.raises(ValidationError, match="after starts_at"):
        AppointmentCreate(
            title="Review",
            starts_at=starts_at,
            ends_at=starts_at - timedelta(minutes=1),
        )


def test_organization_create_rejects_unknown_kind():
    """Unknown categories would not filter consistently in the workspace."""
    from healthflow.workspace.schemas import OrganizationCreate

    with pytest.raises(ValidationError):
        OrganizationCreate(name="Harbor Health", kind="not-a-kind")


@pytest.mark.parametrize(
    ("schema_name", "field"),
    [
        ("OrganizationUpdate", "name"),
        ("OrganizationUpdate", "kind"),
        ("ContactUpdate", "full_name"),
        ("TaskUpdate", "title"),
        ("AppointmentUpdate", "title"),
        ("AppointmentUpdate", "starts_at"),
        ("AppointmentUpdate", "ends_at"),
    ],
)
def test_update_rejects_explicit_null_for_required_fields(schema_name, field):
    """Clearing a required field must fail validation before a database write."""
    from healthflow.workspace import schemas

    schema = getattr(schemas, schema_name)
    with pytest.raises(ValidationError):
        schema.model_validate({field: None})
