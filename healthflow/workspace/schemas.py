"""Request and response contracts for Broker-owned workspace records."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, model_validator


OrganizationKind = Literal["carrier", "provider_office", "employer", "agency", "other"]
TaskStatus = Literal["open", "completed"]
TaskPriority = Literal["low", "medium", "high"]
AppointmentStatus = Literal["scheduled", "completed", "canceled"]


class LinkedRecordFields(BaseModel):
    client_id: UUID | None = None
    organization_id: UUID | None = None
    contact_id: UUID | None = None


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
