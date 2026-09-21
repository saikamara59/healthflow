"""Broker-private Tasks and Follow-ups."""

from datetime import date, datetime, time, timezone
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Broker, BrokerPreference, Task
from healthflow.workspace.activity import record_workspace_activity
from healthflow.workspace.linked_names import load_linked_names
from healthflow.workspace.linking import require_owned_links
from healthflow.workspace.schemas import TaskCreate, TaskResponse, TaskStatus, TaskUpdate
from healthflow.workspace.serializers import task_response


tasks_router = APIRouter(prefix="/tasks", tags=["tasks"])


async def _task(db: AsyncSession, task_id: UUID) -> Task:
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


async def _response(
    db: AsyncSession, task: Task, names: dict[str, dict[UUID, str]] | None = None
) -> TaskResponse:
    names = names if names is not None else await load_linked_names(db, [task])
    return task_response(
        task,
        client_name=names["client"].get(task.client_id),
        organization_name=names["organization"].get(task.organization_id),
        contact_name=names["contact"].get(task.contact_id),
    )


async def _timezone(db: AsyncSession, broker_id: UUID, requested: str | None) -> ZoneInfo:
    name = requested
    if name is None:
        preference = (
            await db.execute(select(BrokerPreference).where(BrokerPreference.broker_id == broker_id))
        ).scalar_one_or_none()
        name = preference.timezone_name if preference is not None else "UTC"
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status_code=422, detail="Invalid time zone") from None


@tasks_router.post("", response_model=TaskResponse, status_code=201)
async def create_task(
    data: TaskCreate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    await require_owned_links(
        db,
        client_id=data.client_id,
        organization_id=data.organization_id,
        contact_id=data.contact_id,
        issue_id=data.issue_id,
    )
    task = Task(broker_id=broker.id, **data.model_dump())
    db.add(task)
    await db.flush()
    return await _response(db, task)


@tasks_router.get("", response_model=list[TaskResponse])
async def list_tasks(
    status: TaskStatus | None = None,
    is_follow_up: bool | None = None,
    schedule: Literal["all", "overdue", "today", "unscheduled", "other"] = "all",
    local_date: date | None = None,
    timezone_name: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[TaskResponse]:
    statement = select(Task).order_by(Task.created_at.desc(), Task.id.desc())
    if status is not None:
        statement = statement.where(Task.status == status)
    if is_follow_up is not None:
        statement = statement.where(Task.is_follow_up == is_follow_up)
    if schedule in {"overdue", "today", "other"}:
        zone = await _timezone(db, broker.id, timezone_name)
        current = datetime.now(timezone.utc)
        target_date = local_date or current.astimezone(zone).date()
        day_start = datetime.combine(target_date, time.min, tzinfo=zone).astimezone(timezone.utc)
        day_end = datetime.combine(
            date.fromordinal(target_date.toordinal() + 1), time.min, tzinfo=zone
        ).astimezone(timezone.utc)
        if schedule == "overdue":
            statement = statement.where(Task.status == "open", Task.due_at < current)
        elif schedule == "today":
            cutoff = current if target_date == current.astimezone(zone).date() else day_start
            statement = statement.where(
                Task.status == "open",
                Task.due_at >= cutoff,
                Task.due_at < day_end,
            )
        else:
            statement = statement.where(
                Task.status == "open",
                or_(Task.due_at.is_(None), Task.due_at >= day_end),
            )
    elif schedule == "unscheduled":
        statement = statement.where(Task.status == "open", Task.due_at.is_(None))
    elif timezone_name is not None:
        await _timezone(db, broker.id, timezone_name)
    tasks = (await db.execute(statement.limit(limit).offset(offset))).scalars().all()
    names = await load_linked_names(db, tasks)
    return [await _response(db, task, names) for task in tasks]


@tasks_router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    return await _response(db, await _task(db, task_id))


@tasks_router.put("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: UUID,
    data: TaskUpdate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    task = await _task(db, task_id)
    changes = data.model_dump(exclude_unset=True)
    if {"client_id", "organization_id", "contact_id", "issue_id"} & changes.keys():
        await require_owned_links(
            db,
            client_id=changes.get("client_id", task.client_id),
            organization_id=changes.get("organization_id", task.organization_id),
            contact_id=changes.get("contact_id", task.contact_id),
            issue_id=changes.get("issue_id", task.issue_id),
        )
    for field, value in changes.items():
        setattr(task, field, value)
    await db.flush()
    return await _response(db, task)


@tasks_router.post("/{task_id}/complete", response_model=TaskResponse)
async def complete_task(
    task_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    task = await _task(db, task_id)
    if task.status == "open":
        task.status = "completed"
        task.completed_at = datetime.now(timezone.utc)
        await db.flush()
        await record_workspace_activity(
            db,
            broker_id=broker.id,
            client_id=task.client_id,
            entity_type="task",
            entity_id=task.id,
            action="completed",
            summary=f"Completed {task.title}",
        )
    return await _response(db, task)


@tasks_router.post("/{task_id}/reopen", response_model=TaskResponse)
async def reopen_task(
    task_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    task = await _task(db, task_id)
    if task.status == "completed":
        task.status = "open"
        task.completed_at = None
        await db.flush()
    return await _response(db, task)
