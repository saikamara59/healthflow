"""Broker-private completed workspace Activity."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Broker, WorkspaceActivity
from healthflow.workspace.schemas import WorkspaceActivityResponse
from healthflow.workspace.serializers import activity_response


activity_router = APIRouter(prefix="/workspace/activity", tags=["workspace"])


@activity_router.get("", response_model=list[WorkspaceActivityResponse])
async def list_workspace_activity(
    limit: int = Query(50, ge=1, le=200),
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[WorkspaceActivityResponse]:
    rows = (
        await db.execute(
            select(WorkspaceActivity)
            .order_by(WorkspaceActivity.created_at.desc(), WorkspaceActivity.id.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [activity_response(row) for row in rows]
