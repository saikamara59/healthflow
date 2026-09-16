"""Append-only records of completed workspace work."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.database.models import WorkspaceActivity


async def record_workspace_activity(
    db: AsyncSession,
    *,
    broker_id: UUID,
    entity_type: str,
    entity_id: UUID,
    action: str,
    summary: str,
    client_id: UUID | None = None,
    details: dict | None = None,
) -> WorkspaceActivity:
    activity = WorkspaceActivity(
        broker_id=broker_id,
        client_id=client_id,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        summary=summary,
        details=details or {},
    )
    db.add(activity)
    await db.flush()
    return activity
