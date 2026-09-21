"""Broker-private, one-time Appointments for native Scheduling."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Appointment, Broker
from healthflow.workspace.activity import record_workspace_activity
from healthflow.workspace.linked_names import load_linked_names
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


async def _response(
    db: AsyncSession, appointment: Appointment, names: dict[str, dict[UUID, str]] | None = None
) -> AppointmentResponse:
    names = names if names is not None else await load_linked_names(db, [appointment])
    return appointment_response(
        appointment,
        client_name=names["client"].get(appointment.client_id),
        organization_name=names["organization"].get(appointment.organization_id),
        contact_name=names["contact"].get(appointment.contact_id),
    )


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
        issue_id=data.issue_id,
    )
    appointment = Appointment(broker_id=broker.id, **data.model_dump())
    db.add(appointment)
    await db.flush()
    return await _response(db, appointment)


@appointments_router.get("", response_model=list[AppointmentResponse])
async def list_appointments(
    starts_after: AwareDatetime | None = None,
    starts_before: AwareDatetime | None = None,
    ends_after: AwareDatetime | None = None,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[AppointmentResponse]:
    statement = select(Appointment).order_by(Appointment.starts_at, Appointment.id)
    if starts_after is not None:
        statement = statement.where(Appointment.starts_at >= starts_after)
    if starts_before is not None:
        statement = statement.where(Appointment.starts_at < starts_before)
    if ends_after is not None:
        statement = statement.where(Appointment.ends_at > ends_after)
    appointments = (await db.execute(statement)).scalars().all()
    names = await load_linked_names(db, appointments)
    return [await _response(db, appointment, names) for appointment in appointments]


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
    if {"client_id", "organization_id", "contact_id", "issue_id"} & changes.keys():
        await require_owned_links(
            db,
            client_id=changes.get("client_id", appointment.client_id),
            organization_id=changes.get("organization_id", appointment.organization_id),
            contact_id=changes.get("contact_id", appointment.contact_id),
            issue_id=changes.get("issue_id", appointment.issue_id),
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
    changed = (await db.execute(
        update(Appointment).where(
            Appointment.id == appointment_id,
            Appointment.broker_id == broker.id,
            Appointment.status == "scheduled",
        ).values(status="completed", completed_at=datetime.now(timezone.utc))
        .returning(Appointment.id)
    )).scalar_one_or_none()
    appointment = await _appointment(db, appointment_id)
    if changed is not None:
        await db.refresh(appointment)
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
    if appointment.status == "canceled":
        raise HTTPException(status_code=409, detail="Restore the Appointment before completing it")
    return await _response(db, appointment)


@appointments_router.post("/{appointment_id}/cancel", response_model=AppointmentResponse)
async def cancel_appointment(
    appointment_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AppointmentResponse:
    changed = (await db.execute(
        update(Appointment).where(
            Appointment.id == appointment_id,
            Appointment.broker_id == broker.id,
            Appointment.status == "scheduled",
        ).values(status="canceled", canceled_at=datetime.now(timezone.utc))
        .returning(Appointment.id)
    )).scalar_one_or_none()
    appointment = await _appointment(db, appointment_id)
    if changed is not None:
        await db.refresh(appointment)
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
    if appointment.status == "completed":
        raise HTTPException(status_code=409, detail="Restore the Appointment before canceling it")
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
