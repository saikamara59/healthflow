"""Broker-private, one-time Appointments for native Scheduling."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Appointment, Broker, Client, Contact, Organization
from healthflow.workspace.activity import record_workspace_activity
from healthflow.workspace.linking import require_owned_links
from healthflow.workspace.schemas import AppointmentCreate, AppointmentResponse, AppointmentUpdate
from healthflow.workspace.serializers import _as_utc, appointment_response


appointments_router = APIRouter(prefix="/appointments", tags=["appointments"])


async def _appointment(db: AsyncSession, appointment_id: UUID) -> Appointment:
    appointment = (
        await db.execute(select(Appointment).where(Appointment.id == appointment_id))
    ).scalar_one_or_none()
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return appointment


async def _response(db: AsyncSession, appointment: Appointment) -> AppointmentResponse:
    linked_names: dict[str, str | None] = {
        "client_name": None,
        "organization_name": None,
        "contact_name": None,
    }
    for model, record_id, field, attribute in (
        (Client, appointment.client_id, "client_name", "full_name"),
        (Organization, appointment.organization_id, "organization_name", "name"),
        (Contact, appointment.contact_id, "contact_name", "full_name"),
    ):
        if record_id is not None:
            record = (await db.execute(select(model).where(model.id == record_id))).scalar_one_or_none()
            if record is not None:
                linked_names[field] = getattr(record, attribute)
    return appointment_response(appointment, **linked_names)


@appointments_router.post("", response_model=AppointmentResponse, status_code=201)
async def create_appointment(
    data: AppointmentCreate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AppointmentResponse:
    await require_owned_links(
        db,
        client_id=data.client_id,
        organization_id=data.organization_id,
        contact_id=data.contact_id,
    )
    appointment = Appointment(broker_id=broker.id, **data.model_dump())
    db.add(appointment)
    await db.flush()
    return await _response(db, appointment)


@appointments_router.get("", response_model=list[AppointmentResponse])
async def list_appointments(
    starts_after: AwareDatetime | None = None,
    starts_before: AwareDatetime | None = None,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[AppointmentResponse]:
    statement = select(Appointment).order_by(Appointment.starts_at, Appointment.id)
    if starts_after is not None:
        statement = statement.where(Appointment.starts_at >= starts_after)
    if starts_before is not None:
        statement = statement.where(Appointment.starts_at < starts_before)
    appointments = (await db.execute(statement)).scalars().all()
    return [await _response(db, appointment) for appointment in appointments]


@appointments_router.get("/{appointment_id}", response_model=AppointmentResponse)
async def get_appointment(
    appointment_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AppointmentResponse:
    return await _response(db, await _appointment(db, appointment_id))


@appointments_router.put("/{appointment_id}", response_model=AppointmentResponse)
async def update_appointment(
    appointment_id: UUID,
    data: AppointmentUpdate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AppointmentResponse:
    appointment = await _appointment(db, appointment_id)
    changes = data.model_dump(exclude_unset=True)
    if {"client_id", "organization_id", "contact_id"} & changes.keys():
        await require_owned_links(
            db,
            client_id=changes.get("client_id", appointment.client_id),
            organization_id=changes.get("organization_id", appointment.organization_id),
            contact_id=changes.get("contact_id", appointment.contact_id),
        )
    starts_at = changes.get("starts_at", appointment.starts_at)
    ends_at = changes.get("ends_at", appointment.ends_at)
    if _as_utc(ends_at) <= _as_utc(starts_at):
        raise HTTPException(status_code=422, detail="ends_at must be after starts_at")
    for field, value in changes.items():
        setattr(appointment, field, value)
    await db.flush()
    return await _response(db, appointment)


@appointments_router.post("/{appointment_id}/complete", response_model=AppointmentResponse)
async def complete_appointment(
    appointment_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AppointmentResponse:
    appointment = await _appointment(db, appointment_id)
    if appointment.status == "canceled":
        raise HTTPException(status_code=409, detail="Restore the Appointment before completing it")
    if appointment.status == "scheduled":
        appointment.status = "completed"
        appointment.completed_at = datetime.now(timezone.utc)
        await db.flush()
        await record_workspace_activity(
            db,
            broker_id=broker.id,
            client_id=appointment.client_id,
            entity_type="appointment",
            entity_id=appointment.id,
            action="completed",
            summary=f"Completed {appointment.title}",
        )
    return await _response(db, appointment)


@appointments_router.post("/{appointment_id}/cancel", response_model=AppointmentResponse)
async def cancel_appointment(
    appointment_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AppointmentResponse:
    appointment = await _appointment(db, appointment_id)
    if appointment.status == "completed":
        raise HTTPException(status_code=409, detail="Restore the Appointment before canceling it")
    if appointment.status == "scheduled":
        appointment.status = "canceled"
        appointment.canceled_at = datetime.now(timezone.utc)
        await db.flush()
        await record_workspace_activity(
            db,
            broker_id=broker.id,
            client_id=appointment.client_id,
            entity_type="appointment",
            entity_id=appointment.id,
            action="canceled",
            summary=f"Canceled {appointment.title}",
        )
    return await _response(db, appointment)


@appointments_router.post("/{appointment_id}/restore-scheduled", response_model=AppointmentResponse)
async def restore_scheduled_appointment(
    appointment_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AppointmentResponse:
    appointment = await _appointment(db, appointment_id)
    if appointment.status != "scheduled":
        appointment.status = "scheduled"
        appointment.completed_at = None
        appointment.canceled_at = None
        await db.flush()
    return await _response(db, appointment)
