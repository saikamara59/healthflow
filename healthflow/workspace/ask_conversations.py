"""Ask Conversations: storage, 90-day retention, and the daily usage cap.

An Ask Conversation is one exchange between a Broker and Ask HealthFlow. It is
private to its Broker, its messages and Client Context are encrypted, and it is
deleted 90 days after its last message or sooner when the Broker deletes it
(ADR 0005). Approvals it produced point back through `Approval.source_id`, so
deleting a conversation never touches them.

The Ask service (OVE-151) builds on this module:

- `create_conversation`, `set_client_context`, and `append_message` store the exchange
- `consume_ask_message` enforces the per-Broker daily cap before each message
- `ask_claude_call` logs every Claude call with model, tokens, duration, and outcome

Brokers list, read, and delete their conversations through `ask_router`.
"""

import asyncio
import logging
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, select, update
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from healthflow.auth.dependencies import get_current_broker
from healthflow.auth.tenant_context import require_current_broker, system_context
from healthflow.database.config import get_db
from healthflow.database.models import (
    Approval,
    AskConversation,
    AskMessage,
    AskUsageDay,
    Broker,
    BrokerPreference,
    Client,
)
from healthflow.logs.invocation import invocation
from healthflow.workspace.schemas import (
    AskConversationDetail,
    AskConversationSummary,
    AskMessageResponse,
    AskMessageRole,
)

logger = logging.getLogger(__name__)

RETENTION = timedelta(days=90)
DAILY_MESSAGE_LIMIT = 200
MAX_MESSAGE_LENGTH = 32_000
ASK_AGENT = "ask_healthflow"
# Approval.source_type for Approvals an Ask Conversation produced.
ASK_SOURCE_TYPE = "ask_conversation"
_PURGE_INTERVAL_SECONDS = 3600
_PURGE_RETRY_SECONDS = 60
_PURGE_BATCH_SIZE = 500
# Bounds every `id IN (...)` list, well under SQLite's bound-parameter limit.
_DELETE_CHUNK_SIZE = 500

ask_router = APIRouter(prefix="/ask", tags=["ask"])

# The retention loop sleeps through this name so tests can replace it.
_sleep = asyncio.sleep


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    # SQLite returns naive datetimes for timezone-aware columns; they are UTC.
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


# ── Storage ─────────────────────────────────────────────────────────────────


async def _owned_client_ids(db: AsyncSession, client_ids: Iterable[UUID]) -> list[str]:
    """Client Context entries, deduplicated, after checking the Broker owns each Client.

    Archived Clients are allowed: a Broker may add one to a conversation explicitly.
    """
    unique = list(dict.fromkeys(client_ids))
    if unique:
        found = set((await db.execute(select(Client.id).where(Client.id.in_(unique)))).scalars())
        if len(found) != len(unique):
            raise HTTPException(status_code=404, detail="Client not found")
    return [str(client_id) for client_id in unique]


async def create_conversation(
    db: AsyncSession,
    *,
    client_ids: Iterable[UUID] = (),
    title: str | None = None,
) -> AskConversation:
    """Start a conversation for the Broker in the tenant context.

    The owner comes from the tenant context, never from an argument: INSERTs
    skip the tenant filter, so a caller-supplied id could store a row for a
    different Broker than the one making the request.
    """
    conversation = AskConversation(
        broker_id=require_current_broker(),
        title=title,
        client_context=await _owned_client_ids(db, client_ids),
    )
    db.add(conversation)
    await db.flush()
    return conversation


async def set_client_context(
    db: AsyncSession, conversation: AskConversation, client_ids: Iterable[UUID]
) -> None:
    conversation.client_context = await _owned_client_ids(db, client_ids)
    await db.flush()


async def append_message(
    db: AsyncSession,
    conversation: AskConversation,
    *,
    role: AskMessageRole,
    content: str,
) -> AskMessage:
    """Store one message and restart the conversation's 90-day clock.

    A conversation already past its 90 days is treated as deleted, even if the
    hourly purge hasn't removed it yet: a new message must not revive it.

    Expiry is judged on the stored row, locked (`FOR UPDATE`). The caller's
    copy may be stale: another request may have renewed the conversation, or
    the purge may have deleted it, since it was loaded. The lock also queues
    this append behind a purge that is deleting the same conversation.
    """
    try:
        await db.refresh(conversation, attribute_names=["last_message_at"], with_for_update=True)
    except InvalidRequestError:  # the row is gone: deleted or purged meanwhile
        raise HTTPException(status_code=404, detail="Conversation not found") from None
    if _is_expired(conversation, _utcnow()):
        raise HTTPException(status_code=404, detail="Conversation not found")
    if role not in ("broker", "assistant"):
        raise ValueError(f"Unknown Ask message role: {role}")
    if len(content) > MAX_MESSAGE_LENGTH:
        raise HTTPException(status_code=422, detail="The message is too long. Shorten it and send again.")
    now = _utcnow()
    message = AskMessage(
        broker_id=conversation.broker_id,
        conversation_id=conversation.id,
        role=role,
        content=content,
        created_at=now,
    )
    db.add(message)
    conversation.last_message_at = now
    await db.flush()
    return message


def _not_expired():
    """Query criterion: the conversation is inside its 90 days.

    Expiry takes effect at 90 days for the Broker, not when the hourly purge
    next succeeds; an expired conversation reads as deleted. Same boundary as
    `_is_expired` and the purge.
    """
    return AskConversation.last_message_at > _utcnow() - RETENTION


async def get_conversation(db: AsyncSession, conversation_id: UUID) -> AskConversation:
    """The current Broker's live conversation.

    Another Broker's conversation, or one past its 90 days, returns the same not-found.
    """
    conversation = (await db.execute(
        select(AskConversation).where(AskConversation.id == conversation_id, _not_expired())
    )).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


def _is_expired(conversation: AskConversation, now: datetime) -> bool:
    # Same boundary as the purge: expired once the last message is 90 days old.
    return _aware(conversation.last_message_at) <= now - RETENTION


def _chunks(ids: list[UUID], size: int = _DELETE_CHUNK_SIZE) -> Iterator[list[UUID]]:
    for start in range(0, len(ids), size):
        yield ids[start:start + size]


async def _delete_conversations(db: AsyncSession, *criteria, limit: int | None = None) -> int:
    """Delete matching conversations and their messages. Never touches Approvals.

    The conversations are chosen once, and their rows locked (`FOR UPDATE`,
    a no-op on SQLite). Both DELETEs then name those rows by id.
    - The lock closes a race: a message landing between the two DELETEs
      would refresh `last_message_at`, so the second DELETE would skip the
      conversation after its history was already gone. A concurrent append
      now waits for this transaction instead.
    - Deleting by `id IN (...)` lets the PHI audit log record which rows were
      deleted. It can't read ids from a date or `conversation_id` filter.
    """
    query = select(AskConversation.id).where(*criteria).order_by(AskConversation.id).with_for_update()
    if limit is not None:
        query = query.limit(limit)
    conversation_ids = list((await db.execute(query)).scalars())
    if not conversation_ids:
        return 0
    message_ids: list[UUID] = []
    for chunk in _chunks(conversation_ids):
        message_ids += (await db.execute(
            select(AskMessage.id).where(AskMessage.conversation_id.in_(chunk))
        )).scalars()
    for chunk in _chunks(message_ids):
        await db.execute(
            delete(AskMessage).where(AskMessage.id.in_(chunk))
            .execution_options(synchronize_session=False)
        )
    for chunk in _chunks(conversation_ids):
        await db.execute(
            delete(AskConversation).where(AskConversation.id.in_(chunk))
            .execution_options(synchronize_session=False)
        )
    return len(conversation_ids)


# ── Retention ───────────────────────────────────────────────────────────────


async def purge_expired_conversations(db: AsyncSession, *, now: datetime | None = None) -> int:
    """Delete every conversation whose last message is 90 or more days old.

    Runs across all Brokers, so it runs in an audited system context. Works in
    batches, each committed on its own, so a large backlog never holds one
    long transaction and its row locks.

    It stops only at an empty batch, not a short one. On Postgres, `LIMIT`
    with `FOR UPDATE` can return fewer rows than the limit while more are
    expired: a row it waited on was renewed by a new message meanwhile, and
    is skipped.
    """
    cutoff = (now or _utcnow()) - RETENTION
    deleted = 0
    with system_context("ask conversation 90-day retention"):
        while True:
            batch = await _delete_conversations(
                db, AskConversation.last_message_at <= cutoff, limit=_PURGE_BATCH_SIZE
            )
            await db.commit()
            if not batch:
                return deleted
            deleted += batch


async def run_retention_loop(
    session_factory: async_sessionmaker,
    *,
    interval_seconds: int = _PURGE_INTERVAL_SECONDS,
    retry_seconds: int = _PURGE_RETRY_SECONDS,
) -> None:
    """Purge expired conversations now and then every `interval_seconds`, until cancelled.

    - **After a failure**, the next try comes sooner: after `retry_seconds`,
      doubling on each further failure, never longer than `interval_seconds`.
      Expired PHI shouldn't wait a full hour because of one database blip.
    - **After a success**, the hourly pace resumes.
    - **Several app instances** may run this at once. A purge only deletes
      rows already expired, so overlapping runs are harmless.
    """
    failures = 0
    while True:
        try:
            async with session_factory() as session:
                deleted = await purge_expired_conversations(session)
            failures = 0
            if deleted:
                logger.info("ask_conversations_purged count=%d", deleted)
        except Exception as exc:
            # Exception, not BaseException: cancellation at shutdown must stop the loop.
            failures += 1
            # Log the type only: a database error message can quote row values.
            logger.warning(
                "Ask Conversation purge failed (%s), attempt %d; retrying sooner",
                type(exc).__name__, failures,
            )
        if failures:
            delay = min(interval_seconds, retry_seconds * 2 ** min(failures - 1, 16))
        else:
            delay = interval_seconds
        await _sleep(delay)


# ── Daily usage cap ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class AskAllowance:
    used: int
    limit: int
    resets_at: datetime


class AskDailyLimitReached(HTTPException):
    """The Broker has sent today's Ask messages. Only Ask is limited."""

    def __init__(self, resets_at: datetime, zone: ZoneInfo, now: datetime) -> None:
        retry_after = max(1, int((resets_at - now).total_seconds()))
        super().__init__(
            status_code=429,
            detail=(
                f"You have used all {DAILY_MESSAGE_LIMIT} Ask HealthFlow messages for today. "
                f"Ask resets at midnight ({zone.key}). The rest of HealthFlow keeps working."
            ),
            headers={"Retry-After": str(retry_after)},
        )
        self.resets_at = resets_at


async def _broker_zone(db: AsyncSession, broker_id: UUID) -> ZoneInfo:
    name = (await db.execute(
        select(BrokerPreference.timezone_name).where(BrokerPreference.broker_id == broker_id)
    )).scalar_one_or_none()
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


async def consume_ask_message(db: AsyncSession, *, now: datetime | None = None) -> AskAllowance:
    """Count one Ask message against the current Broker's cap for today.

    Raises `AskDailyLimitReached` once today's messages are used up.
    - **Today** is the calendar day in the Broker's saved time zone, so the
      cap resets at their midnight.
    - **The increment** is a single conditional UPDATE, so simultaneous
      messages can't push a Broker past the cap.
    - **The Broker** comes from the tenant context, never an argument: the
      INSERT skips the tenant filter, so a caller-supplied id would write a
      stray usage row for another Broker. The tenant-filtered UPDATE would
      then match no row, and the caller would get a false 429.

    **Commit before calling Claude.** Until the caller commits, the increment
    holds a lock: on Postgres, this Broker's usage row, so their next message
    waits for the whole answer; on SQLite, the database's write lock, so
    `ask_claude_call`'s log write, on its own connection, times out and the
    invocation row is lost. This function doesn't commit itself, because that
    would also commit whatever else the caller has pending.
    """
    broker_id = require_current_broker()
    now = now or _utcnow()
    zone = await _broker_zone(db, broker_id)
    today = now.astimezone(zone).date()
    resets_at = datetime.combine(today + timedelta(days=1), time.min, tzinfo=zone)

    insert = postgresql_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    await db.execute(
        insert(AskUsageDay)
        .values(id=uuid4(), broker_id=broker_id, usage_date=today, message_count=0)
        .on_conflict_do_nothing(index_elements=["broker_id", "usage_date"])
    )
    counted = await db.execute(
        update(AskUsageDay)
        .where(
            AskUsageDay.broker_id == broker_id,
            AskUsageDay.usage_date == today,
            AskUsageDay.message_count < DAILY_MESSAGE_LIMIT,
        )
        .values(message_count=AskUsageDay.message_count + 1)
        .returning(AskUsageDay.message_count)
        .execution_options(synchronize_session=False)
    )
    used = counted.scalar_one_or_none()
    if used is None:
        raise AskDailyLimitReached(resets_at, zone, now)
    return AskAllowance(used=used, limit=DAILY_MESSAGE_LIMIT, resets_at=resets_at)


# ── Claude call logging ─────────────────────────────────────────────────────


@dataclass
class AskClaudeCall:
    """Token counts for one Claude call, filled in by the caller."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0

    def record_usage(self, usage) -> None:
        """Copy counts from an Anthropic `Usage` object (or anything with those attributes)."""
        for name in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"):
            setattr(self, name, getattr(usage, name, None) or 0)


@contextmanager
def ask_claude_call(*, conversation_id: UUID, model: str) -> Iterator[AskClaudeCall]:
    """Log one Claude call made for Ask through the agent invocation log.

    The row holds the model, duration, token counts, and outcome, never message
    text: details are counts only, and a failure records its exception type
    without the message, which could echo what the Broker wrote.
    """
    call = AskClaudeCall()
    with invocation(
        agent=ASK_AGENT, event_type="claude_call", model=model, record_error_message=False
    ) as record:
        outcome = "failed"
        try:
            yield call
            outcome = "succeeded"
        finally:
            record.details = {
                "conversation_id": str(conversation_id),
                "outcome": outcome,
                "input_tokens": call.input_tokens,
                "output_tokens": call.output_tokens,
                "cache_read_input_tokens": call.cache_read_input_tokens,
                "cache_creation_input_tokens": call.cache_creation_input_tokens,
            }


# ── Broker endpoints ────────────────────────────────────────────────────────


def _summary(conversation: AskConversation) -> dict:
    last = _aware(conversation.last_message_at)
    return {
        "id": conversation.id,
        "title": conversation.title,
        "client_context": [UUID(value) for value in conversation.client_context],
        "created_at": _aware(conversation.created_at),
        "last_message_at": last,
        "expires_at": last + RETENTION,
    }


# Each endpoint below takes `broker = Depends(get_current_broker)` without using
# it. Don't remove it: the dependency sets the tenant context that scopes every
# query to this Broker. Without it the queries run unscoped, or fail.


@ask_router.get("/conversations", response_model=list[AskConversationSummary])
async def list_conversations(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[AskConversationSummary]:
    rows = (await db.execute(
        select(AskConversation)
        .where(_not_expired())
        .order_by(AskConversation.last_message_at.desc(), AskConversation.id.desc())
        .limit(limit).offset(offset)
    )).scalars().all()
    return [AskConversationSummary(**_summary(row)) for row in rows]


@ask_router.get("/conversations/{conversation_id}", response_model=AskConversationDetail)
async def read_conversation(
    conversation_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> AskConversationDetail:
    conversation = await get_conversation(db, conversation_id)
    messages = (await db.execute(
        select(AskMessage).where(AskMessage.conversation_id == conversation.id)
        .order_by(AskMessage.created_at.asc(), AskMessage.id.asc())
    )).scalars().all()
    approval_ids = (await db.execute(
        select(Approval.id).where(
            Approval.source_type == ASK_SOURCE_TYPE, Approval.source_id == conversation.id
        ).order_by(Approval.created_at.asc())
    )).scalars().all()
    return AskConversationDetail(
        **_summary(conversation),
        messages=[
            AskMessageResponse(id=m.id, role=m.role, content=m.content, created_at=_aware(m.created_at))
            for m in messages
        ],
        approval_ids=list(approval_ids),
    )


@ask_router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # Not `get_conversation`: a Broker can delete an expired conversation the
    # purge hasn't reached yet. The tenant filter still scopes the lookup, so
    # another Broker's conversation matches nothing and gets the same 404.
    if not await _delete_conversations(db, AskConversation.id == conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return Response(status_code=204)
