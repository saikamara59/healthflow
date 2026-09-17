"""Broker-private Today, Overview, preferences, and workspace search."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, distinct, func, or_, select
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
    WorkspaceSearchToken,
)
from healthflow.auth.phi_crypto import blind_index_digest, blind_index_versions
from healthflow.workspace.appointments_router import _response as appointment_response_with_names
from healthflow.workspace.schemas import (
    BrokerPreferenceResponse,
    BrokerPreferenceUpdate,
    OverviewResponse,
    RecentClientResponse,
    SearchResult,
    TodayResponse,
)
from healthflow.workspace.serializers import _as_utc, activity_response
from healthflow.workspace.tasks_router import _response as task_response_with_names
from healthflow.workspace.search_index import query_grams
from healthflow.workspace.linked_names import load_linked_names


dashboard_router = APIRouter(prefix="/workspace", tags=["workspace"])


async def _preference(db: AsyncSession, broker: Broker) -> BrokerPreference | None:
    return (
        await db.execute(select(BrokerPreference).where(BrokerPreference.broker_id == broker.id))
    ).scalar_one_or_none()


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
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
        await db.execute(select(Task).where(
            Task.status == "open", Task.due_at.is_not(None), Task.due_at < day_end
        ))
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
        await db.execute(select(Appointment).where(
            Appointment.status == "scheduled",
            Appointment.starts_at < week_end,
            Appointment.ends_at > day_start,
        ))
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
    names = await load_linked_names(db, [*overdue, *due_today, *appointments_today, *upcoming])
    return TodayResponse(
        timezone_name=zone_name,
        local_date=selected.isoformat(),
        overdue_tasks=[await task_response_with_names(db, task, names) for task in overdue],
        due_today_tasks=[await task_response_with_names(db, task, names) for task in due_today],
        appointments_today=[
            await appointment_response_with_names(db, appointment, names)
            for appointment in appointments_today
        ],
        appointments_next_seven_days=[
            await appointment_response_with_names(db, appointment, names) for appointment in upcoming
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
    clients = await db.scalar(select(func.count(Client.id)).where(Client.broker_id == broker.id))
    organizations = await db.scalar(select(func.count(Organization.id)).where(
        Organization.broker_id == broker.id, Organization.archived_at.is_(None)
    ))
    tasks = await db.scalar(select(func.count(Task.id)).where(
        Task.broker_id == broker.id, Task.status == "open"
    ))
    overdue_tasks = await db.scalar(select(func.count(Task.id)).where(
        Task.broker_id == broker.id, Task.status == "open",
        Task.due_at.is_not(None), Task.due_at < now,
    ))
    upcoming_appointments = await db.scalar(select(func.count(Appointment.id)).where(
        Appointment.broker_id == broker.id, Appointment.status == "scheduled",
        Appointment.starts_at >= day_start, Appointment.starts_at < week_end,
    ))
    activity = (
        await db.execute(
            select(WorkspaceActivity).order_by(WorkspaceActivity.created_at.desc()).limit(10)
        )
    ).scalars().all()
    recent_clients = (await db.execute(
        select(Client).where(Client.broker_id == broker.id)
        .order_by(Client.updated_at.desc(), Client.id.desc()).limit(5)
    )).scalars().all()
    return OverviewResponse(
        clients=clients,
        organizations=organizations,
        open_tasks=tasks,
        overdue_tasks=overdue_tasks,
        appointments_next_seven_days=upcoming_appointments,
        recent_activity=[activity_response(entry) for entry in activity],
        recent_clients=[RecentClientResponse(
            id=client.id, full_name=client.full_name, updated_at=client.updated_at
        ) for client in recent_clients],
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
    grams = query_grams(needle)
    digests = [
        blind_index_digest(gram, version, str(broker.id))
        for version in blind_index_versions()
        for gram in grams
    ]
    # Exclude archived records in SQL so they cannot exhaust the bounded
    # candidate pool before an active result is considered.
    active_organizations = select(Organization.id).where(
        Organization.broker_id == broker.id, Organization.archived_at.is_(None)
    )
    active_contacts = select(Contact.id).join(
        Organization, Contact.organization_id == Organization.id
    ).where(
        Contact.broker_id == broker.id, Contact.archived_at.is_(None),
        Organization.broker_id == broker.id, Organization.archived_at.is_(None),
    )
    eligible = or_(
        WorkspaceSearchToken.kind.in_(("client", "task", "appointment")),
        and_(WorkspaceSearchToken.kind == "organization",
             WorkspaceSearchToken.record_id.in_(active_organizations)),
        and_(WorkspaceSearchToken.kind == "contact",
             WorkspaceSearchToken.record_id.in_(active_contacts)),
    )
    # Candidate IDs are bounded in SQL before any encrypted title is loaded.
    matches = (await db.execute(
        select(WorkspaceSearchToken.kind, WorkspaceSearchToken.record_id)
        .where(WorkspaceSearchToken.digest.in_(digests), eligible)
        .group_by(
            WorkspaceSearchToken.kind,
            WorkspaceSearchToken.record_id,
            WorkspaceSearchToken.key_version,
        )
        .having(func.count(distinct(WorkspaceSearchToken.digest)) == len(grams))
        .limit(min(500, limit * 25))
    )).all()
    ids_by_kind = {
        kind: {record_id for match_kind, record_id in matches if match_kind == kind}
        for kind in ("client", "organization", "contact", "task", "appointment")
    }

    async def load(model, kind):
        ids = ids_by_kind[kind]
        return (await db.execute(select(model).where(model.id.in_(ids)))).scalars().all() if ids else []

    clients = await load(Client, "client")
    organizations = [item for item in await load(Organization, "organization") if item.archived_at is None]
    contacts = [item for item in await load(Contact, "contact") if item.archived_at is None]
    contact_org_ids = {item.organization_id for item in contacts}
    active_org_ids = {
        item.id for item in (
            await db.execute(select(Organization).where(Organization.id.in_(contact_org_ids)))
        ).scalars().all() if item.archived_at is None
    } if contact_org_ids else set()
    tasks = await load(Task, "task")
    appointments = await load(Appointment, "appointment")

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
