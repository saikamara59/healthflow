"""Broker-private Today, Overview, preferences, and workspace search."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import (
    Appointment,
    Broker,
    BrokerPreference,
    Client,
    Contact,
    Organization,
    Task,
    WorkspaceActivity,
)
from healthflow.workspace.appointments_router import _response as appointment_response_with_names
from healthflow.workspace.schemas import (
    BrokerPreferenceResponse,
    BrokerPreferenceUpdate,
    OverviewResponse,
    SearchResult,
    TodayResponse,
)
from healthflow.workspace.serializers import _as_utc, activity_response
from healthflow.workspace.tasks_router import _response as task_response_with_names


dashboard_router = APIRouter(prefix="/workspace", tags=["workspace"])


async def _preference(db: AsyncSession, broker: Broker) -> BrokerPreference | None:
    return (
        await db.execute(select(BrokerPreference).where(BrokerPreference.broker_id == broker.id))
    ).scalar_one_or_none()


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        raise HTTPException(status_code=422, detail="Invalid time zone") from None


def _day_bounds(selected: date, zone: ZoneInfo) -> tuple[datetime, datetime, datetime]:
    day_start = datetime.combine(selected, time.min, tzinfo=zone).astimezone(timezone.utc)
    day_end = datetime.combine(selected + timedelta(days=1), time.min, tzinfo=zone).astimezone(timezone.utc)
    week_end = datetime.combine(selected + timedelta(days=8), time.min, tzinfo=zone).astimezone(timezone.utc)
    return day_start, day_end, week_end


@dashboard_router.get("/preferences", response_model=BrokerPreferenceResponse)
async def get_preferences(
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> BrokerPreferenceResponse:
    preference = await _preference(db, broker)
    if preference is None:
        return BrokerPreferenceResponse(timezone_name="UTC", is_configured=False)
    return BrokerPreferenceResponse(timezone_name=preference.timezone_name, is_configured=True)


@dashboard_router.put("/preferences", response_model=BrokerPreferenceResponse)
async def update_preferences(
    data: BrokerPreferenceUpdate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> BrokerPreferenceResponse:
    _zone(data.timezone_name)
    preference = await _preference(db, broker)
    if preference is None:
        preference = BrokerPreference(broker_id=broker.id, timezone_name=data.timezone_name)
        db.add(preference)
    else:
        preference.timezone_name = data.timezone_name
    await db.flush()
    return BrokerPreferenceResponse(timezone_name=preference.timezone_name, is_configured=True)


@dashboard_router.get("/today", response_model=TodayResponse)
async def get_today(
    local_date: date | None = None,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> TodayResponse:
    preference = await _preference(db, broker)
    zone_name = preference.timezone_name if preference is not None else "UTC"
    zone = _zone(zone_name)
    now = datetime.now(timezone.utc)
    selected = local_date or now.astimezone(zone).date()
    day_start, day_end, week_end = _day_bounds(selected, zone)
    # A selected historical/future day previews its own boundary. The live
    # Today view instead moves an earlier-due-today Task into Overdue now.
    cutoff = now if selected == now.astimezone(zone).date() else day_start

    tasks = (
        await db.execute(select(Task).where(Task.status == "open", Task.due_at.is_not(None)))
    ).scalars().all()
    overdue = sorted(
        (task for task in tasks if _as_utc(task.due_at) < cutoff),
        key=lambda task: task.due_at,
    )
    due_today = sorted(
        (task for task in tasks if cutoff <= _as_utc(task.due_at) < day_end),
        key=lambda task: task.due_at,
    )
    appointments = (
        await db.execute(select(Appointment).where(Appointment.status == "scheduled"))
    ).scalars().all()
    appointments_today = sorted(
        (
            appointment for appointment in appointments
            if _as_utc(appointment.starts_at) < day_end
            and _as_utc(appointment.ends_at) > day_start
        ),
        key=lambda appointment: appointment.starts_at,
    )
    upcoming = sorted(
        (
            appointment for appointment in appointments
            if day_end <= _as_utc(appointment.starts_at) < week_end
        ),
        key=lambda appointment: appointment.starts_at,
    )
    return TodayResponse(
        timezone_name=zone_name,
        local_date=selected.isoformat(),
        overdue_tasks=[await task_response_with_names(db, task) for task in overdue],
        due_today_tasks=[await task_response_with_names(db, task) for task in due_today],
        appointments_today=[
            await appointment_response_with_names(db, appointment)
            for appointment in appointments_today
        ],
        appointments_next_seven_days=[
            await appointment_response_with_names(db, appointment) for appointment in upcoming
        ],
    )


@dashboard_router.get("/overview", response_model=OverviewResponse)
async def get_overview(
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> OverviewResponse:
    preference = await _preference(db, broker)
    zone = _zone(preference.timezone_name if preference is not None else "UTC")
    now = datetime.now(timezone.utc)
    day_start, _, week_end = _day_bounds(now.astimezone(zone).date(), zone)
    clients = (await db.execute(select(Client))).scalars().all()
    organizations = (
        await db.execute(select(Organization).where(Organization.archived_at.is_(None)))
    ).scalars().all()
    tasks = (await db.execute(select(Task).where(Task.status == "open"))).scalars().all()
    appointments = (
        await db.execute(select(Appointment).where(Appointment.status == "scheduled"))
    ).scalars().all()
    activity = (
        await db.execute(
            select(WorkspaceActivity).order_by(WorkspaceActivity.created_at.desc()).limit(10)
        )
    ).scalars().all()
    return OverviewResponse(
        clients=len(clients),
        organizations=len(organizations),
        open_tasks=len(tasks),
        overdue_tasks=sum(
            task.due_at is not None and _as_utc(task.due_at) < now for task in tasks
        ),
        appointments_next_seven_days=sum(
            day_start <= _as_utc(appointment.starts_at) < week_end
            for appointment in appointments
        ),
        recent_activity=[activity_response(entry) for entry in activity],
    )


@dashboard_router.get("/search", response_model=list[SearchResult])
async def search_workspace(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(8, ge=1, le=20),
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[SearchResult]:
    needle = q.strip().casefold()
    if len(needle) < 2:
        raise HTTPException(status_code=422, detail="Search needs at least two characters")
    clients = (await db.execute(select(Client))).scalars().all()
    organizations = (
        await db.execute(select(Organization).where(Organization.archived_at.is_(None)))
    ).scalars().all()
    active_org_ids = {organization.id for organization in organizations}
    contacts = (
        await db.execute(select(Contact).where(Contact.archived_at.is_(None)))
    ).scalars().all()
    tasks = (await db.execute(select(Task))).scalars().all()
    appointments = (await db.execute(select(Appointment))).scalars().all()

    candidates: list[SearchResult] = []
    for client in clients:
        candidates.append(SearchResult(
            kind="client", id=client.id, title=client.full_name, subtitle="Client",
            href=f"/clients/{client.id}",
        ))
    for organization in organizations:
        candidates.append(SearchResult(
            kind="organization", id=organization.id, title=organization.name,
            subtitle="Organization", href=f"/organizations/{organization.id}",
        ))
    for contact in contacts:
        if contact.organization_id in active_org_ids:
            candidates.append(SearchResult(
                kind="contact", id=contact.id, title=contact.full_name, subtitle="Contact",
                href=f"/organizations/{contact.organization_id}#contact-{contact.id}",
            ))
    for task in tasks:
        candidates.append(SearchResult(
            kind="task", id=task.id, title=task.title, subtitle="Task",
            href=f"/today?task={task.id}",
        ))
    for appointment in appointments:
        candidates.append(SearchResult(
            kind="appointment", id=appointment.id, title=appointment.title,
            subtitle="Appointment", href=f"/scheduling?appointment={appointment.id}",
        ))

    matched = [item for item in candidates if needle in item.title.casefold()]
    matched.sort(key=lambda item: (
        not item.title.casefold().startswith(needle), item.title.casefold(), item.kind,
    ))
    return matched[:limit]
