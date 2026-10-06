"""Pure ORM-to-workspace response conversion."""

from datetime import datetime, timezone

from healthflow.database.models import (
    Appeal,
    Appointment,
    Contact,
    Enrollment,
    Issue,
    Organization,
    Task,
    WorkspaceActivity,
)
from healthflow.workspace.schemas import (
    AppealResponse,
    AppointmentResponse,
    ContactResponse,
    EnrollmentResponse,
    IssueResponse,
    OrganizationResponse,
    TaskResponse,
    WorkspaceActivityResponse,
)


def _as_utc(value: datetime) -> datetime:
    """SQLite can return naive values for UTC timestamps stored by this app."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _optional_utc(value: datetime | None) -> datetime | None:
    return _as_utc(value) if value is not None else None


def contact_response(contact: Contact) -> ContactResponse:
    return ContactResponse(
        id=contact.id,
        organization_id=contact.organization_id,
        full_name=contact.full_name,
        role=contact.role,
        email=contact.email,
        phone=contact.phone,
        archived_at=_optional_utc(contact.archived_at),
        created_at=_as_utc(contact.created_at),
        updated_at=_as_utc(contact.updated_at),
    )


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
        archived_at=_optional_utc(organization.archived_at),
        contact_count=len(active_contacts),
        contacts=[contact_response(contact) for contact in active_contacts] if include_contacts else [],
        created_at=_as_utc(organization.created_at),
        updated_at=_as_utc(organization.updated_at),
    )


def task_response(
    task: Task,
    *,
    client_name: str | None = None,
    client_archived: bool = False,
    organization_name: str | None = None,
    contact_name: str | None = None,
) -> TaskResponse:
    now = datetime.now(timezone.utc)
    return TaskResponse(
        id=task.id,
        approval_id=task.approval_id,
        client_id=task.client_id,
        organization_id=task.organization_id,
        contact_id=task.contact_id,
        issue_id=task.issue_id,
        title=task.title,
        notes=task.notes,
        priority=task.priority,
        status=task.status,
        is_follow_up=task.is_follow_up,
        due_at=_optional_utc(task.due_at),
        completed_at=_optional_utc(task.completed_at),
        is_overdue=(
            task.status == "open" and task.due_at is not None and _as_utc(task.due_at) < now
        ),
        client_name=client_name,
        client_archived=client_archived,
        organization_name=organization_name,
        contact_name=contact_name,
        created_at=_as_utc(task.created_at),
        updated_at=_as_utc(task.updated_at),
    )


def appointment_response(
    appointment: Appointment,
    *,
    client_name: str | None = None,
    client_archived: bool = False,
    organization_name: str | None = None,
    contact_name: str | None = None,
) -> AppointmentResponse:
    presentation_status = appointment.status
    if appointment.status == "scheduled" and _as_utc(appointment.ends_at) < datetime.now(timezone.utc):
        presentation_status = "needs_follow_up"
    return AppointmentResponse(
        id=appointment.id,
        approval_id=appointment.approval_id,
        client_id=appointment.client_id,
        organization_id=appointment.organization_id,
        contact_id=appointment.contact_id,
        issue_id=appointment.issue_id,
        title=appointment.title,
        notes=appointment.notes,
        starts_at=_as_utc(appointment.starts_at),
        ends_at=_as_utc(appointment.ends_at),
        status=appointment.status,
        presentation_status=presentation_status,
        completed_at=_optional_utc(appointment.completed_at),
        canceled_at=_optional_utc(appointment.canceled_at),
        client_name=client_name,
        client_archived=client_archived,
        organization_name=organization_name,
        contact_name=contact_name,
        created_at=_as_utc(appointment.created_at),
        updated_at=_as_utc(appointment.updated_at),
    )


def enrollment_response(enrollment: Enrollment, *, client_name: str) -> EnrollmentResponse:
    return EnrollmentResponse(
        id=enrollment.id,
        client_id=enrollment.client_id,
        client_name=client_name,
        plan_name=enrollment.plan_name,
        effective_date=enrollment.effective_date,
        notes=enrollment.notes,
        status=enrollment.status,
        ready_at=_optional_utc(enrollment.ready_at),
        submitted_at=_optional_utc(enrollment.submitted_at),
        confirmed_at=_optional_utc(enrollment.confirmed_at),
        canceled_at=_optional_utc(enrollment.canceled_at),
        created_at=_as_utc(enrollment.created_at),
        updated_at=_as_utc(enrollment.updated_at),
    )


def appeal_response(appeal: Appeal) -> AppealResponse:
    return AppealResponse(
        id=appeal.id,
        issue_id=appeal.issue_id,
        title=appeal.title,
        draft_text=appeal.draft_text,
        status=appeal.status,
        created_at=_as_utc(appeal.created_at),
        updated_at=_as_utc(appeal.updated_at),
    )


def issue_response(
    issue: Issue,
    *,
    client_name: str,
    client_archived: bool = False,
    appeals: list[AppealResponse] | None = None,
    follow_ups: list[TaskResponse] | None = None,
    appointments: list[AppointmentResponse] | None = None,
) -> IssueResponse:
    return IssueResponse(
        id=issue.id,
        client_id=issue.client_id,
        client_name=client_name,
        client_archived=client_archived,
        title=issue.title,
        description=issue.description,
        deadline=issue.deadline,
        status=issue.status,
        resolved_at=_optional_utc(issue.resolved_at),
        appeals=appeals or [],
        follow_ups=follow_ups or [],
        appointments=appointments or [],
        created_at=_as_utc(issue.created_at),
        updated_at=_as_utc(issue.updated_at),
    )


def activity_response(activity: WorkspaceActivity) -> WorkspaceActivityResponse:
    return WorkspaceActivityResponse(
        id=activity.id,
        client_id=activity.client_id,
        entity_type=activity.entity_type,
        entity_id=activity.entity_id,
        action=activity.action,
        summary=activity.summary,
        details=activity.details,
        created_at=_as_utc(activity.created_at),
    )
