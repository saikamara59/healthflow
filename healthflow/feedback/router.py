from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker, require_admin
from healthflow.database.config import get_db
from healthflow.database.models import Broker
from healthflow.feedback.collector import FeedbackCollector
from healthflow.feedback.prompt_updater import PromptUpdater
from healthflow.feedback.reward_model import RewardModel
from healthflow.models.schemas import (
    CreateVariantRequest,
    FeedbackAnalytics,
    FeedbackCreate,
    FeedbackResponse,
    GeneratePromptRequest,
    GeneratePromptResponse,
    PromptVariantResponse,
    WeeklyReport,
)

feedback_router = APIRouter(prefix="/feedback", tags=["feedback"])

collector = FeedbackCollector()
reward_model = RewardModel()
prompt_updater = PromptUpdater()


@feedback_router.post("", response_model=FeedbackResponse, status_code=201)
async def submit_feedback(
    body: FeedbackCreate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
):
    """Submit feedback on an agent output."""
    fb = await collector.submit(
        db=db,
        broker_id=broker.id,
        output_id=body.output_id,
        agent_type=body.agent_type,
        accuracy=body.accuracy,
        clarity=body.clarity,
        helpfulness=body.helpfulness,
        comment=body.comment,
    )
    return FeedbackResponse(
        id=str(fb.id),
        broker_id=str(fb.broker_id),
        output_id=fb.output_id,
        agent_type=fb.agent_type,
        accuracy=fb.accuracy,
        clarity=fb.clarity,
        helpfulness=fb.helpfulness,
        comment=fb.comment,
        created_at=fb.created_at.isoformat(),
    )


@feedback_router.get("", response_model=list[FeedbackResponse])
async def list_feedback(
    agent_type: str | None = Query(None),
    limit: int = Query(50, le=200),
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
):
    """List feedback for the current broker."""
    items = await collector.list_feedback(
        db=db,
        agent_type=agent_type,
        limit=limit,
    )
    return [
        FeedbackResponse(
            id=str(fb.id),
            broker_id=str(fb.broker_id),
            output_id=fb.output_id,
            agent_type=fb.agent_type,
            accuracy=fb.accuracy,
            clarity=fb.clarity,
            helpfulness=fb.helpfulness,
            comment=fb.comment,
            created_at=fb.created_at.isoformat(),
        )
        for fb in items
    ]


@feedback_router.get("/analytics", response_model=FeedbackAnalytics)
async def get_analytics(
    days: int = Query(30, ge=1, le=365),
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
):
    """Get aggregated feedback analytics per agent type."""
    return await collector.get_analytics(db=db, days=days)


@feedback_router.post("/reward-score", response_model=WeeklyReport)
async def trigger_reward_score(
    days: int = Query(7, ge=1, le=365),
    _admin: Broker = Depends(require_admin),  # aggregates feedback cross-broker
    db: AsyncSession = Depends(get_db),
):
    """Trigger the reward model scoring pipeline."""
    return await reward_model.score_outputs(db=db, days=days)


@feedback_router.get("/weekly-report", response_model=WeeklyReport)
async def get_weekly_report(
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
):
    """Get the weekly feedback summary report."""
    return await reward_model.score_outputs(db=db, days=7)


@feedback_router.post("/generate-prompt", response_model=GeneratePromptResponse)
async def generate_prompt(
    body: GeneratePromptRequest,
    _admin: Broker = Depends(require_admin),  # cross-broker read → admin only
    db: AsyncSession = Depends(get_db),
):
    """Assemble few-shot examples from the top-rated outputs for an agent.

    Read-only: builds the example block but does NOT change any live prompt.
    The admin reviews the output, then feeds it into POST /feedback/variants.
    """
    few_shot = await prompt_updater.generate_few_shot(
        db, body.agent_type, top_n=body.top_n
    )
    return GeneratePromptResponse(
        agent_type=body.agent_type,
        top_n=body.top_n,
        few_shot=few_shot,
    )


@feedback_router.post("/variants", response_model=PromptVariantResponse, status_code=201)
async def create_variant(
    body: CreateVariantRequest,
    _admin: Broker = Depends(require_admin),  # mutates global routing → admin only
    db: AsyncSession = Depends(get_db),
):
    """Roll out a new prompt variant at `traffic_pct`%, shrinking existing
    active variants proportionally. Affects ALL brokers' traffic for this agent.
    """
    variant = await prompt_updater.create_variant(
        db, body.agent_type, body.prompt_template, traffic_pct=body.traffic_pct
    )
    await db.commit()  # persist new row + the re-weighted siblings
    return PromptVariantResponse(
        id=str(variant.id),
        agent_type=variant.agent_type,
        variant_name=variant.variant_name,
        traffic_pct=variant.traffic_pct,
        is_active=variant.is_active,
        created_at=variant.created_at.isoformat(),
    )
