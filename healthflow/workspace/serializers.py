"""Pure ORM-to-workspace response conversion."""

from datetime import datetime, timezone

from healthflow.database.models import Appointment, Contact, Organization, Task, WorkspaceActivity
from healthflow.workspace.schemas import (
    AppointmentResponse,
    ContactResponse,
    OrganizationResponse,
    TaskResponse,
    WorkspaceActivityResponse,
)


def _as_utc(value: datetime) -> datetime:
    """SQLite can return naive values for UTC timestamps stored by this app."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def contact_response(contact: Contact) -> ContactResponse:
    return ContactResponse.model_validate(contact)


def organization_response(
    organization: Organization,
    *,
    contacts: list[Contact] | None = None,
    include_contacts: bool = True,
) -> OrganizationResponse:
    active_contacts = [contact for contact in contacts or [] if contact.archived_at is None]
    return OrganizationResponse(
        id=organization.id,
        name=organization.name,
        kind=organization.kind,
        website=organization.website,
        phone=organization.phone,
        notes=organization.notes,
        archived_at=organization.archived_at,
        contact_count=len(active_contacts),
        contacts=[contact_response(contact) for contact in active_contacts] if include_contacts else [],
        created_at=organization.created_at,
        updated_at=organization.updated_at,
    )


def task_response(
    task: Task,
    *,
    client_name: str | None = None,
    organization_name: str | None = None,
    contact_name: str | None = None,
) -> TaskResponse:
    now = datetime.now(timezone.utc)
    return TaskResponse(
        id=task.id,
        client_id=task.client_id,
        organization_id=task.organization_id,
        contact_id=task.contact_id,
        title=task.title,
        notes=task.notes,
        priority=task.priority,
        status=task.status,
        is_follow_up=task.is_follow_up,
        due_at=task.due_at,
        completed_at=task.completed_at,
        is_overdue=(
            task.status == "open" and task.due_at is not None and _as_utc(task.due_at) < now
        ),
        client_name=client_name,
        organization_name=organization_name,
        contact_name=contact_name,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def appointment_response(
    appointment: Appointment,
    *,
    client_name: str | None = None,
    organization_name: str | None = None,
    contact_name: str | None = None,
) -> AppointmentResponse:
    presentation_status = appointment.status
    if appointment.status == "scheduled" and _as_utc(appointment.ends_at) < datetime.now(timezone.utc):
        presentation_status = "needs_follow_up"
    return AppointmentResponse(
        id=appointment.id,
        client_id=appointment.client_id,
        organization_id=appointment.organization_id,
        contact_id=appointment.contact_id,
        title=appointment.title,
        notes=appointment.notes,
        starts_at=appointment.starts_at,
        ends_at=appointment.ends_at,
        status=appointment.status,
        presentation_status=presentation_status,
        completed_at=appointment.completed_at,
        canceled_at=appointment.canceled_at,
        client_name=client_name,
        organization_name=organization_name,
        contact_name=contact_name,
        created_at=appointment.created_at,
        updated_at=appointment.updated_at,
    )


def activity_response(activity: WorkspaceActivity) -> WorkspaceActivityResponse:
    return WorkspaceActivityResponse.model_validate(activity)
