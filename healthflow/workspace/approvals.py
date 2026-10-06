"""Approvals: changes HealthFlow software proposes that wait for the Broker.

Proposers (Ask HealthFlow first, later Inbox matching and Connectors) call
`propose_approval`; Brokers decide through `approvals_router`. There is no
Broker endpoint for creating an Approval, because anything a Broker starts is
not an Approval (ADR 0003).
"""

import json
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.auth.phi_crypto import encrypt
from healthflow.database.config import get_db
from healthflow.database.models import Appointment, Approval, Broker, Client, Task
from healthflow.workspace.activity import record_workspace_activity
from healthflow.workspace.linking import lock_client, require_owned_links
from healthflow.workspace.schemas import (
    AppointmentCreate,
    ApprovalKind,
    ApprovalProposer,
    ApprovalResponse,
    DecidedVia,
    TaskCreate,
)

_VALUE_SCHEMAS = {"task": TaskCreate, "appointment": AppointmentCreate}
_RECORD_MODELS = {"task": Task, "appointment": Appointment}


class ApproveRequest(BaseModel):
    via: DecidedVia
    values: dict | None = None


class RejectRequest(BaseModel):
    via: DecidedVia
    reason: str = Field(max_length=2000)

    @field_validator("reason")
    @classmethod
    def reason_is_required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("A reason is required to reject an Approval")
        return value.strip()


approvals_router = APIRouter(prefix="/approvals", tags=["approvals"])


def _too_long(column: str, value) -> bool:
    """Whether a value overflows its column once stored.

    Encrypted columns hold base64 ciphertext and JSON escapes non-ASCII text, so
    the limit applies to the stored form; PostgreSQL rejects an overflow with a
    DataError, while SQLite ignores VARCHAR lengths.
    """
    if value is None:
        return False
    limit = Approval.__table__.c[column].type.length
    if isinstance(value, dict):
        stored = encrypt(json.dumps(value))
    elif column in ("proposer_agent", "proposer_model", "source_type"):
        stored = value
    else:
        stored = encrypt(value)
    return len(stored) > limit


async def propose_approval(
    db: AsyncSession,
    *,
    broker_id: UUID,
    kind: ApprovalKind,
    values: dict,
    proposer_agent: str,
    excerpt: str,
    proposer_model: str | None = None,
    source_type: str | None = None,
    source_id: UUID | None = None,
    note: str | None = None,
) -> Approval:
    """Record a pending Approval. Values must already be well formed for `kind`.

    Raises ValueError, before anything is written, when a field would not fit.
    """
    proposed = _VALUE_SCHEMAS[kind].model_validate(values)
    proposed_values = proposed.model_dump(mode="json")
    for column, label, value in (
        ("proposer_agent", "proposer agent", proposer_agent),
        ("proposer_model", "proposer model", proposer_model),
        ("source_type", "source type", source_type),
        ("excerpt", "excerpt", excerpt),
        ("note", "note", note),
        ("proposed_values", "proposed values", proposed_values),
    ):
        if _too_long(column, value):
            verb, pronoun = ("are", "them") if label.endswith("values") else ("is", "it")
            raise ValueError(f"The {label} {verb} too long to store. Shorten {pronoun} and propose again.")
    approval = Approval(
        broker_id=broker_id,
        client_id=proposed.client_id,
        kind=kind,
        proposer_agent=proposer_agent,
        proposer_model=proposer_model,
        source_type=source_type,
        source_id=source_id,
        excerpt=excerpt,
        note=note,
        proposed_values=proposed_values,
    )
    db.add(approval)
    await db.flush()
    return approval


def approval_response(approval: Approval) -> ApprovalResponse:
    return ApprovalResponse(
        id=approval.id,
        kind=approval.kind,
        state=approval.state,
        client_id=approval.client_id,
        proposer=ApprovalProposer(
            agent=approval.proposer_agent,
            model=approval.proposer_model,
            source_type=approval.source_type,
            source_id=approval.source_id,
        ),
        excerpt=approval.excerpt,
        note=approval.note,
        proposed=approval.proposed_values,
        approved=approval.approved_values,
        rejection_reason=approval.rejection_reason,
        decided_by=approval.decided_by,
        decided_at=approval.decided_at,
        decided_via=approval.decided_via,
        created_record_id=approval.created_record_id,
        created_at=approval.created_at,
    )


@approvals_router.get("", response_model=list[ApprovalResponse])
async def list_approvals(
    state: Literal["pending", "decided"] = Query("pending"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[ApprovalResponse]:
    # Decided Approvals are kept forever, so the history is paged.
    states = ("pending",) if state == "pending" else ("approved", "rejected")
    order = (
        (Approval.created_at.asc(), Approval.id.asc()) if state == "pending"
        else (Approval.decided_at.desc(), Approval.id.desc())
    )
    rows = (await db.execute(
        select(Approval).where(Approval.state.in_(states)).order_by(*order).limit(limit).offset(offset)
    )).scalars().all()
    return [approval_response(row) for row in rows]


async def _approval(db: AsyncSession, approval_id: UUID) -> Approval:
    approval = (await db.execute(select(Approval).where(Approval.id == approval_id))).scalar_one_or_none()
    if approval is None:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval


async def _pending_approval(db: AsyncSession, approval_id: UUID) -> Approval:
    approval = await _approval(db, approval_id)
    if approval.state != "pending":
        raise HTTPException(status_code=409, detail="This Approval has already been decided")
    return approval


def _check_still_valid(kind: str, final, client: Client | None) -> None:
    """Block approving a proposal the world has moved past, with a plain reason.

    `client` must be the locked, freshly read Client (see `approve`).
    """
    if client is not None:
        if client.archived_at is not None:
            # New work for an archived Client requires restoring it (ADR 0002).
            raise HTTPException(
                status_code=409,
                detail=f"Restore {client.full_name} before creating new work for them.",
            )
    when = final.due_at if kind == "task" else final.starts_at
    if when is not None and when < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=409,
            detail="The proposed time has already passed. Choose a new time or reject it.",
        )


async def _claim(db: AsyncSession, approval: Approval, broker_id: UUID, state: str, via: str, **values) -> None:
    """Atomically move a pending Approval to its decided state.

    The conditional UPDATE lets exactly one of two simultaneous decisions win;
    the other matches no pending row and gets a conflict instead of creating a
    second record. Later failures roll the claim back with the transaction.
    """
    result = await db.execute(
        update(Approval)
        .where(Approval.id == approval.id, Approval.state == "pending")
        .values(state=state, decided_by=broker_id, decided_at=datetime.now(timezone.utc),
                decided_via=via, **values)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=409, detail="This Approval has already been decided")
    await db.refresh(approval)


@approvals_router.get("/{approval_id}", response_model=ApprovalResponse)
async def get_approval(
    approval_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> ApprovalResponse:
    return approval_response(await _approval(db, approval_id))


@approvals_router.post("/{approval_id}/approve", response_model=ApprovalResponse)
async def approve(
    approval_id: UUID,
    request: ApproveRequest,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> ApprovalResponse:
    broker_id = broker.id
    approval = await _pending_approval(db, approval_id)
    kind = approval.kind
    try:
        final = _VALUE_SCHEMAS[kind].model_validate(
            {**approval.proposed_values, **(request.values or {})}
        )
    except ValidationError as error:
        reasons = [item["msg"].removeprefix("Value error, ") for item in error.errors(include_url=False)]
        raise HTTPException(status_code=422, detail="; ".join(reasons)) from None
    approved_values = final.model_dump(mode="json")
    if _too_long("approved_values", approved_values):
        raise HTTPException(status_code=422, detail="The approved values are too long to store. Shorten them.")
    client = None
    if final.client_id is not None:
        # Take the Client lifecycle lock that archiving takes, so an archive cannot
        # land between this check and the new record (ADR 0002). End the read
        # transaction first: SQLite cannot upgrade an old WAL snapshot.
        await db.commit()
        client = await lock_client(db, broker_id, final.client_id)
    _check_still_valid(kind, final, client)
    await require_owned_links(
        db,
        client_id=final.client_id,
        organization_id=final.organization_id,
        contact_id=final.contact_id,
        issue_id=final.issue_id,
    )
    await _claim(db, approval, broker_id, "approved", request.via)
    record = _RECORD_MODELS[kind](broker_id=broker_id, approval_id=approval.id, **final.model_dump())
    db.add(record)
    await db.flush()
    approval.approved_values = approved_values
    approval.client_id = final.client_id
    approval.created_record_id = record.id
    await db.flush()
    await record_workspace_activity(
        db,
        broker_id=broker_id,
        entity_type=kind,
        entity_id=record.id,
        action="approved",
        summary=f"Approved {kind}: {final.title}",
        client_id=final.client_id,
        details={"approval_id": str(approval.id), "via": request.via},
    )
    return approval_response(approval)


@approvals_router.post("/{approval_id}/reject", response_model=ApprovalResponse)
async def reject(
    approval_id: UUID,
    request: RejectRequest,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> ApprovalResponse:
    if _too_long("rejection_reason", request.reason):
        raise HTTPException(status_code=422, detail="The reason is too long to store. Shorten it.")
    approval = await _pending_approval(db, approval_id)
    await _claim(db, approval, broker.id, "rejected", request.via, rejection_reason=request.reason)
    # Rejections create no record, so the entry is keyed to the Approval itself.
    # The reason stays on the Approval; the feed only says a decision was made.
    await record_workspace_activity(
        db,
        broker_id=broker.id,
        entity_type="approval",
        entity_id=approval.id,
        action="rejected",
        summary=f"Rejected {approval.kind}: {approval.proposed_values['title']}",
        client_id=approval.client_id,
        details={"approval_id": str(approval.id), "via": request.via},
    )
    return approval_response(approval)
