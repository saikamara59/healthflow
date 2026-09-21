"""Request and response contracts for Broker-owned workspace records."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, field_validator, model_validator


OrganizationKind = Literal["carrier", "provider_office", "employer", "agency", "other"]
TaskStatus = Literal["open", "completed"]
TaskPriority = Literal["low", "medium", "high"]
AppointmentStatus = Literal["scheduled", "completed", "canceled"]
EnrollmentStatus = Literal["preparing", "ready_to_submit", "submitted", "confirmed", "canceled"]
IssueStatus = Literal["open", "in_progress", "waiting_on_outside_party", "resolved"]
AppealStatus = Literal["draft"]


class LinkedRecordFields(BaseModel):
    client_id: UUID | None = None
    organization_id: UUID | None = None
    contact_id: UUID | None = None
    issue_id: UUID | None = None


class EnrollmentCreate(BaseModel):
    client_id: UUID
    plan_name: str = Field(min_length=1, max_length=300)
    effective_date: date | None = None
    notes: str | None = Field(default=None, max_length=6000)


class EnrollmentUpdate(BaseModel):
    client_id: UUID | None = None
    plan_name: str | None = Field(default=None, min_length=1, max_length=300)
    effective_date: date | None = None
    notes: str | None = Field(default=None, max_length=6000)

    @field_validator("client_id", "plan_name", mode="before")
    @classmethod
    def required_fields_cannot_be_cleared(cls, value):
        if value is None:
            raise ValueError("Required field cannot be null")
        return value


class EnrollmentSubmit(BaseModel):
    external_submission_confirmed: bool = False


class IssueCreate(BaseModel):
    client_id: UUID
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=6000)
    deadline: date | None = None


class IssueUpdate(BaseModel):
    client_id: UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=6000)
    deadline: date | None = None
    status: IssueStatus | None = None

    @field_validator("client_id", "title", "status", mode="before")
    @classmethod
    def required_fields_cannot_be_cleared(cls, value):
        if value is None:
            raise ValueError("Required field cannot be null")
        return value


class AppealCreate(BaseModel):
    issue_id: UUID
    title: str = Field(min_length=1, max_length=300)
    draft_text: str | None = Field(default=None, max_length=20000)


class AppealUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    draft_text: str | None = Field(default=None, max_length=20000)

    @field_validator("title", mode="before")
    @classmethod
    def title_cannot_be_cleared(cls, value):
        if value is None:
            raise ValueError("Required field cannot be null")
        return value


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: OrganizationKind
    website: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=50)
    notes: str | None = Field(default=None, max_length=4000)


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: OrganizationKind | None = None
    website: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=50)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("name", "kind", mode="before")
    @classmethod
    def required_fields_cannot_be_cleared(cls, value):
        if value is None:
            raise ValueError("Required field cannot be null")
        return value


class ContactCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=50)


class ContactUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=50)

    @field_validator("full_name", mode="before")
    @classmethod
    def full_name_cannot_be_cleared(cls, value):
        if value is None:
            raise ValueError("Required field cannot be null")
        return value


class TaskCreate(LinkedRecordFields):
    title: str = Field(min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=6000)
    priority: TaskPriority | None = None
    due_at: AwareDatetime | None = None
    is_follow_up: bool = False


class TaskUpdate(LinkedRecordFields):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=6000)
    priority: TaskPriority | None = None
    due_at: AwareDatetime | None = None
    is_follow_up: bool | None = None

    @field_validator("title", mode="before")
    @classmethod
    def title_cannot_be_cleared(cls, value):
        if value is None:
            raise ValueError("Required field cannot be null")
        return value


class AppointmentCreate(LinkedRecordFields):
    title: str = Field(min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=6000)
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def end_follows_start(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class AppointmentUpdate(LinkedRecordFields):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=6000)
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None

    @field_validator("title", "starts_at", "ends_at", mode="before")
    @classmethod
    def required_fields_cannot_be_cleared(cls, value):
        if value is None:
            raise ValueError("Required field cannot be null")
        return value


class ContactResponse(BaseModel):
    id: UUID
    organization_id: UUID
    full_name: str
    role: str | None
    email: str | None
    phone: str | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class OrganizationResponse(BaseModel):
    id: UUID
    name: str
    kind: OrganizationKind
    website: str | None
    phone: str | None
    notes: str | None
    archived_at: datetime | None
    contact_count: int = 0
    contacts: list[ContactResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskResponse(LinkedRecordFields):
    id: UUID
    title: str
    notes: str | None
    priority: TaskPriority | None
    status: TaskStatus
    is_follow_up: bool
    due_at: datetime | None
    completed_at: datetime | None
    is_overdue: bool
    client_name: str | None
    organization_name: str | None
    contact_name: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AppointmentResponse(LinkedRecordFields):
    id: UUID
    title: str
    notes: str | None
    starts_at: datetime
    ends_at: datetime
    status: AppointmentStatus
    presentation_status: Literal["scheduled", "completed", "canceled", "needs_follow_up"]
    completed_at: datetime | None
    canceled_at: datetime | None
    client_name: str | None
    organization_name: str | None
    contact_name: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EnrollmentResponse(BaseModel):
    id: UUID
    client_id: UUID
    client_name: str
    plan_name: str
    effective_date: date | None
    notes: str | None
    status: EnrollmentStatus
    ready_at: datetime | None
    submitted_at: datetime | None
    confirmed_at: datetime | None
    canceled_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AppealResponse(BaseModel):
    id: UUID
    issue_id: UUID
    title: str
    draft_text: str | None
    status: AppealStatus
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IssueResponse(BaseModel):
    id: UUID
    client_id: UUID
    client_name: str
    title: str
    description: str | None
    deadline: date | None
    status: IssueStatus
    resolved_at: datetime | None
    appeals: list[AppealResponse] = Field(default_factory=list)
    follow_ups: list[TaskResponse] = Field(default_factory=list)
    appointments: list[AppointmentResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceActivityResponse(BaseModel):
    id: UUID
    client_id: UUID | None
    entity_type: str
    entity_id: UUID
    action: str
    summary: str
    details: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class BrokerPreferenceUpdate(BaseModel):
    timezone_name: str = Field(min_length=1, max_length=64)


class BrokerPreferenceResponse(BaseModel):
    timezone_name: str
    is_configured: bool


class TodayResponse(BaseModel):
    timezone_name: str
    local_date: str
    overdue_tasks: list[TaskResponse]
    due_today_tasks: list[TaskResponse]
    appointments_today: list[AppointmentResponse]
    appointments_next_seven_days: list[AppointmentResponse]


class RecentClientResponse(BaseModel):
    id: UUID
    full_name: str
    updated_at: datetime


class OverviewResponse(BaseModel):
    clients: int
    organizations: int
    open_tasks: int
    overdue_tasks: int
    appointments_next_seven_days: int
    recent_activity: list[WorkspaceActivityResponse]
    recent_clients: list[RecentClientResponse]


class SearchResult(BaseModel):
    kind: Literal["client", "organization", "contact", "task", "appointment"]
    id: UUID
    title: str
    subtitle: str
    href: str
