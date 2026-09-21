"""Broker-reviewed Enrollments that never transmit from HealthFlow."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Broker, Client, Enrollment
from healthflow.workspace.linking import require_owned_links
from healthflow.workspace.schemas import (
    EnrollmentCreate,
    EnrollmentResponse,
    EnrollmentStatus,
    EnrollmentSubmit,
    EnrollmentUpdate,
)
from healthflow.workspace.serializers import enrollment_response


enrollments_router = APIRouter(prefix="/enrollments", tags=["enrollments"])


async def _enrollment(db: AsyncSession, enrollment_id: UUID) -> Enrollment:
    enrollment = (
        await db.execute(select(Enrollment).where(Enrollment.id == enrollment_id))
    ).scalar_one_or_none()
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    return enrollment


async def _client_names(db: AsyncSession, records: list[Enrollment]) -> dict[UUID, str]:
    ids = {record.client_id for record in records}
    if not ids:
        return {}
    clients = (await db.execute(select(Client).where(Client.id.in_(ids)))).scalars().all()
    return {client.id: client.full_name for client in clients}


async def _response(db: AsyncSession, enrollment: Enrollment) -> EnrollmentResponse:
    names = await _client_names(db, [enrollment])
    return enrollment_response(enrollment, client_name=names[enrollment.client_id])


@enrollments_router.post("", response_model=EnrollmentResponse, status_code=201)
async def create_enrollment(
    data: EnrollmentCreate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentResponse:
    await require_owned_links(db, client_id=data.client_id)
    enrollment = Enrollment(broker_id=broker.id, **data.model_dump())
    db.add(enrollment)
    await db.flush()
    return await _response(db, enrollment)


@enrollments_router.get("", response_model=list[EnrollmentResponse])
async def list_enrollments(
    status: EnrollmentStatus | None = None,
    client_id: UUID | None = None,
    limit: int = Query(100, ge=1, le=200),
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[EnrollmentResponse]:
    statement = select(Enrollment).order_by(Enrollment.updated_at.desc(), Enrollment.id.desc())
    if status is not None:
        statement = statement.where(Enrollment.status == status)
    if client_id is not None:
        statement = statement.where(Enrollment.client_id == client_id)
    records = list((await db.execute(statement.limit(limit))).scalars().all())
    names = await _client_names(db, records)
    return [enrollment_response(item, client_name=names[item.client_id]) for item in records]


@enrollments_router.get("/{enrollment_id}", response_model=EnrollmentResponse)
async def get_enrollment(
    enrollment_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentResponse:
    return await _response(db, await _enrollment(db, enrollment_id))


@enrollments_router.put("/{enrollment_id}", response_model=EnrollmentResponse)
async def update_enrollment(
    enrollment_id: UUID,
    data: EnrollmentUpdate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentResponse:
    enrollment = await _enrollment(db, enrollment_id)
    changes = data.model_dump(exclude_unset=True)
    if "client_id" in changes:
        await require_owned_links(db, client_id=changes["client_id"])
    for field, value in changes.items():
        setattr(enrollment, field, value)
    await db.flush()
    return await _response(db, enrollment)


async def _transition(
    db: AsyncSession,
    enrollment: Enrollment,
    *,
    from_status: str,
    to_status: str,
    timestamp_field: str,
) -> Enrollment:
    if enrollment.status == to_status:
        return enrollment
    if enrollment.status != from_status:
        raise HTTPException(
            status_code=409,
            detail=f"Enrollment must be {from_status.replace('_', ' ')} before {to_status.replace('_', ' ')}",
        )
    now = datetime.now(timezone.utc)
    changed = (
        await db.execute(
            update(Enrollment)
            .where(Enrollment.id == enrollment.id, Enrollment.status == from_status)
            .values(status=to_status, **{timestamp_field: now})
            .returning(Enrollment.id)
        )
    ).scalar_one_or_none()
    if changed is None:
        raise HTTPException(status_code=409, detail="Enrollment changed; reload and review it again")
    await db.refresh(enrollment)
    return enrollment


@enrollments_router.post("/{enrollment_id}/ready-to-submit", response_model=EnrollmentResponse)
async def mark_enrollment_ready(
    enrollment_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentResponse:
    enrollment = await _enrollment(db, enrollment_id)
    await _transition(
        db,
        enrollment,
        from_status="preparing",
        to_status="ready_to_submit",
        timestamp_field="ready_at",
    )
    return await _response(db, enrollment)


@enrollments_router.post("/{enrollment_id}/submit", response_model=EnrollmentResponse)
async def mark_enrollment_submitted(
    enrollment_id: UUID,
    data: EnrollmentSubmit,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentResponse:
    enrollment = await _enrollment(db, enrollment_id)
    if not data.external_submission_confirmed:
        raise HTTPException(
            status_code=409,
            detail="Confirm that the external submission succeeded before marking Submitted",
        )
    await _transition(
        db,
        enrollment,
        from_status="ready_to_submit",
        to_status="submitted",
        timestamp_field="submitted_at",
    )
    return await _response(db, enrollment)


@enrollments_router.post("/{enrollment_id}/confirm", response_model=EnrollmentResponse)
async def confirm_enrollment(
    enrollment_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentResponse:
    enrollment = await _enrollment(db, enrollment_id)
    await _transition(
        db,
        enrollment,
        from_status="submitted",
        to_status="confirmed",
        timestamp_field="confirmed_at",
    )
    return await _response(db, enrollment)


@enrollments_router.post("/{enrollment_id}/cancel", response_model=EnrollmentResponse)
async def cancel_enrollment(
    enrollment_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentResponse:
    enrollment = await _enrollment(db, enrollment_id)
    if enrollment.status == "canceled":
        return await _response(db, enrollment)
    if enrollment.status == "confirmed":
        raise HTTPException(status_code=409, detail="A confirmed Enrollment cannot be canceled")
    enrollment.status = "canceled"
    enrollment.canceled_at = datetime.now(timezone.utc)
    await db.flush()
    return await _response(db, enrollment)
