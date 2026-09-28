"""Broker-private Issues and their required-parent Appeals."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Appeal, Appointment, Broker, Client, Issue, Task
from healthflow.workspace.appointments_router import _response as appointment_with_names
from healthflow.workspace.linking import lock_document_target, require_no_document_history, require_owned_links
from healthflow.workspace.schemas import (
    AppealCreate,
    AppealResponse,
    AppealUpdate,
    IssueCreate,
    IssueResponse,
    IssueStatus,
    IssueUpdate,
)
from healthflow.workspace.serializers import appeal_response, issue_response
from healthflow.workspace.tasks_router import _response as task_with_names


issues_router = APIRouter(prefix="/issues", tags=["issues"])
appeals_router = APIRouter(prefix="/appeals", tags=["appeals"])


async def _issue(db: AsyncSession, issue_id: UUID) -> Issue:
    issue = (await db.execute(select(Issue).where(Issue.id == issue_id))).scalar_one_or_none()
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


async def _appeal(db: AsyncSession, appeal_id: UUID) -> Appeal:
    appeal = (await db.execute(select(Appeal).where(Appeal.id == appeal_id))).scalar_one_or_none()
    if appeal is None:
        raise HTTPException(status_code=404, detail="Appeal not found")
    return appeal


async def _issue_response(db: AsyncSession, issue: Issue, *, expanded: bool = True) -> IssueResponse:
    client = (
        await db.execute(select(Client).where(Client.id == issue.client_id))
    ).scalar_one_or_none()
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    if not expanded:
        return issue_response(issue, client_name=client.full_name, client_archived=client.archived_at is not None)
    appeals = list(
        (
            await db.execute(
                select(Appeal).where(Appeal.issue_id == issue.id).order_by(Appeal.created_at)
            )
        ).scalars().all()
    )
    tasks = list(
        (
            await db.execute(
                select(Task)
                .where(Task.issue_id == issue.id, Task.is_follow_up.is_(True))
                .order_by(Task.created_at)
            )
        ).scalars().all()
    )
    appointments = list(
        (
            await db.execute(
                select(Appointment)
                .where(Appointment.issue_id == issue.id)
                .order_by(Appointment.starts_at)
            )
        ).scalars().all()
    )
    return issue_response(
        issue,
        client_name=client.full_name,
        client_archived=client.archived_at is not None,
        appeals=[appeal_response(item) for item in appeals],
        follow_ups=[await task_with_names(db, item) for item in tasks],
        appointments=[await appointment_with_names(db, item) for item in appointments],
    )


@issues_router.post("", response_model=IssueResponse, status_code=201)
async def create_issue(
    data: IssueCreate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> IssueResponse:
    await require_owned_links(db, client_id=data.client_id)
    issue = Issue(broker_id=broker.id, **data.model_dump())
    db.add(issue)
    await db.flush()
    return await _issue_response(db, issue)


@issues_router.get("", response_model=list[IssueResponse])
async def list_issues(
    status: IssueStatus | None = None,
    client_id: UUID | None = None,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[IssueResponse]:
    statement = select(Issue).order_by(Issue.updated_at.desc(), Issue.id.desc())
    if status is not None:
        statement = statement.where(Issue.status == status)
    if client_id is not None:
        statement = statement.where(Issue.client_id == client_id)
    records = list((await db.execute(statement.offset(offset).limit(limit))).scalars().all())
    return [await _issue_response(db, item, expanded=False) for item in records]


@issues_router.get("/{issue_id}", response_model=IssueResponse)
async def get_issue(
    issue_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> IssueResponse:
    return await _issue_response(db, await _issue(db, issue_id))


@issues_router.put("/{issue_id}", response_model=IssueResponse)
async def update_issue(
    issue_id: UUID,
    data: IssueUpdate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> IssueResponse:
    changes = data.model_dump(exclude_unset=True)
    issue = (await lock_document_target(db, broker.id, "issue", issue_id)
             if "client_id" in changes else await _issue(db, issue_id))
    if "client_id" in changes and changes["client_id"] != issue.client_id:
        await require_owned_links(db, client_id=changes["client_id"])
        await require_no_document_history(db, broker.id, "issue", issue.id)
        linked_task = (
            await db.execute(select(Task.id).where(Task.issue_id == issue.id).limit(1))
        ).scalar_one_or_none()
        linked_appointment = (
            await db.execute(
                select(Appointment.id).where(Appointment.issue_id == issue.id).limit(1)
            )
        ).scalar_one_or_none()
        if linked_task is not None or linked_appointment is not None:
            raise HTTPException(
                status_code=409,
                detail="Move or remove linked Follow-ups and Appointments before changing the Issue Client",
            )
    next_status = changes.get("status")
    if next_status == "resolved" and issue.status != "resolved":
        issue.resolved_at = datetime.now(timezone.utc)
    elif next_status is not None and next_status != "resolved":
        issue.resolved_at = None
    for field, value in changes.items():
        setattr(issue, field, value)
    await db.flush()
    return await _issue_response(db, issue)


@appeals_router.post("", response_model=AppealResponse, status_code=201)
async def create_appeal(
    data: AppealCreate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AppealResponse:
    await require_owned_links(db, issue_id=data.issue_id)
    appeal = Appeal(broker_id=broker.id, **data.model_dump())
    db.add(appeal)
    await db.flush()
    return appeal_response(appeal)


@appeals_router.get("", response_model=list[AppealResponse])
async def list_appeals(
    issue_id: UUID | None = None,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[AppealResponse]:
    statement = select(Appeal).order_by(Appeal.updated_at.desc(), Appeal.id.desc())
    if issue_id is not None:
        statement = statement.where(Appeal.issue_id == issue_id)
    records = (await db.execute(statement)).scalars().all()
    return [appeal_response(item) for item in records]


@appeals_router.get("/{appeal_id}", response_model=AppealResponse)
async def get_appeal(
    appeal_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AppealResponse:
    return appeal_response(await _appeal(db, appeal_id))


@appeals_router.put("/{appeal_id}", response_model=AppealResponse)
async def update_appeal(
    appeal_id: UUID,
    data: AppealUpdate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AppealResponse:
    appeal = await _appeal(db, appeal_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(appeal, field, value)
    await db.flush()
    return appeal_response(appeal)
