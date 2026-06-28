import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Broker, DecisionRecord
from healthflow.decisions.shaper import to_response
from healthflow.models.schemas import DecisionRecordResponse

decisions_router = APIRouter(prefix="/decisions", tags=["decisions"])


@decisions_router.get("/{decision_id}", response_model=DecisionRecordResponse)
async def get_decision(
    decision_id: uuid.UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
):
    """Return one Decision Record. The tenant filter scopes the query to the
    current broker, so another broker's id simply isn't found (404)."""
    result = await db.execute(
        select(DecisionRecord).where(DecisionRecord.id == decision_id)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Decision record not found")
    return to_response(record)
