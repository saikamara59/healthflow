"""Ask Conversations: storage, isolation, 90-day retention, daily cap, usage logging (ADR 0005)."""

import asyncio
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select, text, update
from sqlalchemy.orm import Session

from healthflow.auth.tenant_context import TenantContextMissing, current_broker_id
from healthflow.database.models import (
    AgentInvocationLog,
    Approval,
    AskConversation,
    AskMessage,
    AskUsageDay,
    Base,
    BrokerPreference,
    PhiAccessLog,
)
from healthflow.logs.invocation import InvocationLogger
from healthflow.workspace import ask_conversations as ask
from healthflow.workspace.approvals import propose_approval


async def _broker(client, email: str) -> tuple[dict[str, str], UUID]:
    await client.post(
        "/auth/register",
        json={"email": email, "password": "securepass123!", "full_name": "Ask Broker"},
    )
    await client.post("/__test/activate-broker", json={"email": email})
    login = await client.post("/auth/login", json={"email": email, "password": "securepass123!"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    profile = await client.get("/auth/profile", headers=headers)
    return headers, UUID(profile.json()["id"])


async def _client_record(client, headers, name="Marjorie Calloway") -> UUID:
    response = await client.post("/clients", headers=headers, json={
        "full_name": name, "zip_code": "10025", "age": 67, "income_level": "medium",
        "doctors": [], "prescriptions": [], "procedures": [],
    })
    return UUID(response.json()["id"])


@contextmanager
def _as_broker(broker_id: UUID):
    """Run service calls the way a request for this Broker would: tenant-scoped."""
    token = current_broker_id.set(broker_id)
    try:
        yield
    finally:
        current_broker_id.reset(token)


async def _conversation(db_session, broker_id, client_ids=(), messages=(), title="Marjorie's insulin"):
    with _as_broker(broker_id):
        conversation = await ask.create_conversation(db_session, client_ids=client_ids, title=title)
        for role, content in messages:
            await ask.append_message(db_session, conversation, role=role, content=content)
    await db_session.commit()
    return conversation


async def _propose_from(db_session, broker_id, conversation, client_id):
    approval = await propose_approval(
        db_session, broker_id=broker_id, kind="task",
        values={"title": "Call Marjorie about Tier 4", "client_id": str(client_id),
                "due_at": "2030-01-15T14:00:00+00:00", "is_follow_up": True},
        proposer_agent=ask.ASK_AGENT, proposer_model="claude-sonnet",
        source_type=ask.ASK_SOURCE_TYPE, source_id=conversation.id,
        excerpt="Remind me to call Marjorie about the Tier 4 change",
    )
    await db_session.commit()
    return approval


# ── Storage and encryption ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_conversation_messages_title_and_client_context_are_encrypted_at_rest(client, db_session):
    headers, broker_id = await _broker(client, "ask-encrypted@example.com")
    client_id = await _client_record(client, headers)
    conversation = await _conversation(
        db_session, broker_id, [client_id],
        [("broker", "Marjorie's insulin went to Tier 4, remind me to call her")],
    )

    stored_conversation = (await db_session.execute(text(
        "SELECT title, client_context FROM ask_conversations WHERE id = :id"
    ), {"id": str(conversation.id)})).one()
    stored_message = (await db_session.execute(text(
        "SELECT content FROM ask_messages WHERE conversation_id = :id"
    ), {"id": str(conversation.id)})).scalar_one()

    for stored in (*stored_conversation, stored_message):
        assert stored.startswith("v1:")
        assert "Marjorie" not in stored
        assert str(client_id) not in stored


@pytest.mark.asyncio
async def test_broker_reads_their_conversation_with_messages_context_and_approvals(client, db_session):
    headers, broker_id = await _broker(client, "ask-read@example.com")
    client_id = await _client_record(client, headers)
    conversation = await _conversation(db_session, broker_id, [client_id], [
        ("broker", "Remind me to call Marjorie about the Tier 4 change"),
        ("assistant", "I proposed a follow-up Task for Marjorie."),
    ])
    approval = await _propose_from(db_session, broker_id, conversation, client_id)

    response = await client.get(f"/ask/conversations/{conversation.id}", headers=headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Marjorie's insulin"
    assert body["client_context"] == [str(client_id)]
    assert [(m["role"], m["content"]) for m in body["messages"]] == [
        ("broker", "Remind me to call Marjorie about the Tier 4 change"),
        ("assistant", "I proposed a follow-up Task for Marjorie."),
    ]
    assert body["approval_ids"] == [str(approval.id)]
    last = datetime.fromisoformat(body["last_message_at"])
    assert datetime.fromisoformat(body["expires_at"]) == last + timedelta(days=90)


@pytest.mark.asyncio
async def test_broker_lists_their_conversations_most_recent_first(client, db_session):
    headers, broker_id = await _broker(client, "ask-list@example.com")
    older = await _conversation(db_session, broker_id, messages=[("broker", "First question")], title="Older")
    newer = await _conversation(db_session, broker_id, messages=[("broker", "Second question")], title="Newer")

    listed = (await client.get("/ask/conversations", headers=headers)).json()

    assert [item["id"] for item in listed] == [str(newer.id), str(older.id)]
    assert "messages" not in listed[0]


@pytest.mark.asyncio
async def test_client_context_only_accepts_the_brokers_own_clients(client, db_session):
    _, broker_id = await _broker(client, "ask-context-owner@example.com")
    outsider_headers, _ = await _broker(client, "ask-context-outsider@example.com")
    outsiders_client = await _client_record(client, outsider_headers, name="Otis Fernwood")

    with _as_broker(broker_id), pytest.raises(HTTPException) as error:
        await ask.create_conversation(db_session, client_ids=[outsiders_client])

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_a_conversation_belongs_to_the_broker_in_the_tenant_context(client, db_session):
    _, broker_id = await _broker(client, "ask-owner-from-context@example.com")

    conversation = await _conversation(db_session, broker_id, messages=[("broker", "Whose is this?")])

    assert conversation.broker_id == broker_id


@pytest.mark.asyncio
async def test_storing_a_conversation_outside_a_tenant_context_is_refused(db_session):
    with pytest.raises(TenantContextMissing):
        await ask.create_conversation(db_session, title="No Broker")
    with pytest.raises(TenantContextMissing):
        await ask.consume_ask_message(db_session)


@pytest.mark.asyncio
async def test_a_message_on_an_expired_conversation_is_refused(client, db_session):
    _, broker_id = await _broker(client, "ask-expired-append@example.com")
    conversation = await _conversation(db_session, broker_id, messages=[("broker", "Old")])
    conversation.last_message_at = datetime.now(timezone.utc) - timedelta(days=90)
    await db_session.commit()

    with _as_broker(broker_id), pytest.raises(HTTPException) as error:
        await ask.append_message(db_session, conversation, role="broker", content="Still there?")

    assert error.value.status_code == 404
    assert error.value.detail == "Conversation not found"
    conversation_id = conversation.id  # rollback expires the object
    await db_session.rollback()
    stored = (await db_session.execute(
        select(AskMessage.content).where(AskMessage.conversation_id == conversation_id)
    )).scalars().all()
    assert stored == ["Old"]


@pytest.mark.asyncio
async def test_expiry_is_judged_on_the_stored_conversation_not_a_stale_copy(client, db_session):
    _, broker_id = await _broker(client, "ask-stale-expiry@example.com")
    conversation = await _conversation(db_session, broker_id, messages=[("broker", "Old")])
    conversation.last_message_at = datetime.now(timezone.utc) - timedelta(days=90)
    await db_session.commit()
    # Another request renews the conversation; this request's copy still looks expired.
    with _as_broker(broker_id):
        await db_session.execute(
            update(AskConversation).where(AskConversation.id == conversation.id)
            .values(last_message_at=datetime.now(timezone.utc))
            .execution_options(synchronize_session=False)
        )
    await db_session.commit()

    with _as_broker(broker_id):
        await ask.append_message(db_session, conversation, role="broker", content="Following up")
    await db_session.commit()

    stored = (await db_session.execute(
        select(AskMessage.content).where(AskMessage.conversation_id == conversation.id)
        .order_by(AskMessage.created_at)
    )).scalars().all()
    assert stored == ["Old", "Following up"]


@pytest.mark.asyncio
async def test_a_message_on_a_conversation_purged_meanwhile_is_refused(client, db_session):
    _, broker_id = await _broker(client, "ask-purged-append@example.com")
    conversation = await _conversation(db_session, broker_id, messages=[("broker", "Old")])
    with _as_broker(broker_id):
        await ask._delete_conversations(db_session, AskConversation.id == conversation.id)
    await db_session.commit()

    with _as_broker(broker_id), pytest.raises(HTTPException) as error:
        await ask.append_message(db_session, conversation, role="broker", content="Anyone there?")

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_new_message_restarts_the_conversations_90_day_clock(client, db_session):
    _, broker_id = await _broker(client, "ask-clock@example.com")
    conversation = await _conversation(db_session, broker_id, messages=[("broker", "Hello")])
    conversation.last_message_at = datetime.now(timezone.utc) - timedelta(days=80)
    await db_session.commit()

    with _as_broker(broker_id):
        await ask.append_message(db_session, conversation, role="broker", content="Following up")
    await db_session.commit()

    assert ask._aware(conversation.last_message_at) > datetime.now(timezone.utc) - timedelta(minutes=1)


@pytest.mark.asyncio
async def test_an_expired_conversation_is_left_out_of_the_brokers_history(client, db_session):
    # Expiry takes effect at 90 days, not when the hourly purge next succeeds.
    headers, broker_id = await _broker(client, "ask-expired-list@example.com")
    expired = await _conversation(db_session, broker_id, messages=[("broker", "Old")], title="Expired")
    current = await _conversation(db_session, broker_id, messages=[("broker", "Recent")], title="Current")
    now = datetime.now(timezone.utc)
    expired.last_message_at = now - timedelta(days=90)
    current.last_message_at = now - timedelta(days=89)
    await db_session.commit()

    listed = (await client.get("/ask/conversations", headers=headers)).json()

    assert [item["id"] for item in listed] == [str(current.id)]


@pytest.mark.asyncio
async def test_reading_an_expired_conversation_returns_not_found(client, db_session):
    headers, broker_id = await _broker(client, "ask-expired-read@example.com")
    conversation = await _conversation(db_session, broker_id, messages=[("broker", "Old")])
    conversation.last_message_at = datetime.now(timezone.utc) - timedelta(days=90)
    await db_session.commit()

    response = await client.get(f"/ask/conversations/{conversation.id}", headers=headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Conversation not found"


@pytest.mark.asyncio
async def test_a_broker_can_still_delete_an_expired_conversation_the_purge_has_not_reached(client, db_session):
    headers, broker_id = await _broker(client, "ask-expired-delete@example.com")
    conversation = await _conversation(db_session, broker_id, messages=[("broker", "Old")])
    conversation.last_message_at = datetime.now(timezone.utc) - timedelta(days=90)
    await db_session.commit()
    conversation_id = conversation.id

    response = await client.delete(f"/ask/conversations/{conversation_id}", headers=headers)

    assert response.status_code == 204
    remaining = (await db_session.execute(
        select(AskMessage.id).where(AskMessage.conversation_id == conversation_id)
    )).scalars().all()
    assert remaining == []


@pytest.mark.asyncio
async def test_deleting_another_brokers_conversation_returns_not_found(client, db_session):
    _, owner_id = await _broker(client, "ask-delete-owner@example.com")
    other_headers, _ = await _broker(client, "ask-delete-other@example.com")
    conversation = await _conversation(db_session, owner_id, messages=[("broker", "Mine")])

    response = await client.delete(f"/ask/conversations/{conversation.id}", headers=other_headers)

    assert response.status_code == 404
    with _as_broker(owner_id):
        still_there = (await db_session.execute(
            select(AskConversation.id).where(AskConversation.id == conversation.id)
        )).scalar_one_or_none()
    assert still_there == conversation.id


# ── Isolation and audit ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_conversations_are_private_to_their_broker(client, db_session):
    _, owner_id = await _broker(client, "ask-isolation-owner@example.com")
    outsider, _ = await _broker(client, "ask-isolation-outsider@example.com")
    conversation = await _conversation(db_session, owner_id, messages=[("broker", "Private question")])
    path = f"/ask/conversations/{conversation.id}"
    missing = f"/ask/conversations/{uuid.uuid4()}"

    assert (await client.get("/ask/conversations", headers=outsider)).json() == []
    foreign_read = await client.get(path, headers=outsider)
    assert foreign_read.status_code == 404
    assert foreign_read.json() == (await client.get(missing, headers=outsider)).json()
    assert (await client.delete(path, headers=outsider)).status_code == 404
    assert (await db_session.execute(
        select(AskConversation).where(AskConversation.id == conversation.id)
    )).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_a_bulk_delete_never_reaches_another_brokers_conversations(client, db_session):
    _, owner_id = await _broker(client, "ask-bulk-owner@example.com")
    _, outsider_id = await _broker(client, "ask-bulk-outsider@example.com")
    owners = await _conversation(db_session, owner_id, messages=[("broker", "Owner's question")])
    outsiders = await _conversation(db_session, outsider_id, messages=[("broker", "Outsider's question")])

    # Even naming the other Broker's conversation outright deletes nothing of theirs.
    with _as_broker(outsider_id):
        deleted = await ask._delete_conversations(
            db_session, AskConversation.id.in_([owners.id, outsiders.id])
        )
    await db_session.commit()

    assert deleted == 1
    assert (await db_session.execute(select(AskConversation.id))).scalars().all() == [owners.id]
    assert (await db_session.execute(select(AskMessage.conversation_id))).scalars().all() == [owners.id]


@pytest.mark.asyncio
async def test_one_brokers_ask_messages_never_count_against_another_brokers_cap(client, db_session):
    _, broker_id = await _broker(client, "ask-cap-scope@example.com")
    _, other_id = await _broker(client, "ask-cap-scope-other@example.com")
    now = datetime(2026, 11, 4, 15, 0, tzinfo=timezone.utc)
    db_session.add(AskUsageDay(broker_id=other_id, usage_date=now.date(), message_count=7))
    await db_session.commit()

    used = (await _consume(db_session, broker_id, now)).used

    counts = dict((await db_session.execute(
        select(AskUsageDay.broker_id, AskUsageDay.message_count)
    )).all())
    assert used == 1
    assert counts == {broker_id: 1, other_id: 7}


@pytest.mark.asyncio
async def test_reading_a_conversation_is_recorded_in_the_phi_access_log(client, db_session):
    headers, broker_id = await _broker(client, "ask-audit@example.com")
    conversation = await _conversation(db_session, broker_id, messages=[("broker", "Audit me")])

    await client.get(f"/ask/conversations/{conversation.id}", headers=headers)

    endpoint = f"GET /ask/conversations/{conversation.id}"
    tables = {entry.table_name for entry in (await db_session.execute(select(PhiAccessLog).where(
        PhiAccessLog.endpoint == endpoint, PhiAccessLog.operation == "read",
        PhiAccessLog.broker_id == broker_id,
    ))).scalars()}
    assert {"ask_conversations", "ask_messages"} <= tables


# ── Delete ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_deleting_a_conversation_removes_its_messages_and_keeps_its_approvals(client, db_session):
    headers, broker_id = await _broker(client, "ask-delete@example.com")
    client_id = await _client_record(client, headers)
    conversation = await _conversation(db_session, broker_id, [client_id], [
        ("broker", "Remind me to call Marjorie about the Tier 4 change"),
    ])
    approval = await _propose_from(db_session, broker_id, conversation, client_id)
    kept = await _conversation(db_session, broker_id, messages=[("broker", "Keep this one")])

    response = await client.delete(f"/ask/conversations/{conversation.id}", headers=headers)

    assert response.status_code == 204
    assert (await client.get(f"/ask/conversations/{conversation.id}", headers=headers)).status_code == 404
    remaining = (await db_session.execute(select(AskMessage.conversation_id))).scalars().all()
    assert remaining == [kept.id]
    after = (await client.get(f"/approvals/{approval.id}", headers=headers)).json()
    assert after["state"] == "pending"
    assert after["excerpt"] == "Remind me to call Marjorie about the Tier 4 change"
    assert after["proposer"]["source_id"] == str(conversation.id)


@pytest.mark.asyncio
async def test_deleting_a_conversation_records_which_messages_were_deleted(client, db_session):
    headers, broker_id = await _broker(client, "ask-delete-audit@example.com")
    conversation = await _conversation(db_session, broker_id, messages=[
        ("broker", "First"), ("assistant", "Second"),
    ])
    message_ids = set((await db_session.execute(
        select(AskMessage.id).where(AskMessage.conversation_id == conversation.id)
    )).scalars())

    await client.delete(f"/ask/conversations/{conversation.id}", headers=headers)

    entries = await _delete_entries(db_session, f"DELETE /ask/conversations/{conversation.id}")
    assert entries["ask_conversations"] == ({str(conversation.id)}, 1)
    assert entries["ask_messages"] == ({str(m) for m in message_ids}, 2)


# ── 90-day cleanup ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cleanup_deletes_conversations_90_days_after_their_last_message_and_nothing_else(client, db_session):
    headers, broker_id = await _broker(client, "ask-retention@example.com")
    _, other_broker_id = await _broker(client, "ask-retention-other@example.com")
    client_id = await _client_record(client, headers)
    now = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)

    expired = await _conversation(db_session, broker_id, [client_id], [("broker", "Old question")])
    just_inside = await _conversation(db_session, broker_id, messages=[("broker", "Recent question")])
    other_expired = await _conversation(db_session, other_broker_id, messages=[("broker", "Another old one")])
    approval = await _propose_from(db_session, broker_id, expired, client_id)
    expired.last_message_at = now - timedelta(days=90)
    other_expired.last_message_at = now - timedelta(days=200)
    just_inside.last_message_at = now - timedelta(days=90) + timedelta(seconds=1)
    await db_session.commit()

    deleted = await ask.purge_expired_conversations(db_session, now=now)

    assert deleted == 2
    survivors = (await db_session.execute(select(AskConversation.id))).scalars().all()
    assert survivors == [just_inside.id]
    message_owners = set((await db_session.execute(select(AskMessage.conversation_id))).scalars())
    assert message_owners == {just_inside.id}
    still_there = (await db_session.execute(select(Approval).where(Approval.id == approval.id))).scalar_one()
    assert still_there.state == "pending"
    assert still_there.excerpt == "Remind me to call Marjorie about the Tier 4 change"


@pytest.mark.asyncio
async def test_cleanup_with_nothing_expired_deletes_nothing(client, db_session):
    _, broker_id = await _broker(client, "ask-retention-none@example.com")
    await _conversation(db_session, broker_id, messages=[("broker", "Fresh")])

    assert await ask.purge_expired_conversations(db_session) == 0
    assert len((await db_session.execute(select(AskConversation.id))).scalars().all()) == 1


async def _delete_entries(db_session, endpoint) -> dict[str, tuple[set[str], int]]:
    """Each table's delete audit entries for one endpoint: (all row ids, total row_count)."""
    entries: dict[str, tuple[set[str], int]] = {}
    for entry in (await db_session.execute(select(PhiAccessLog).where(
        PhiAccessLog.endpoint == endpoint, PhiAccessLog.operation == "delete",
    ))).scalars():
        ids, count = entries.get(entry.table_name, (set(), 0))
        entries[entry.table_name] = (ids | set(entry.row_ids), count + entry.row_count)
    return entries


@pytest.mark.asyncio
async def test_cleanup_is_audited_with_the_ids_of_everything_it_deleted(client, db_session):
    _, broker_id = await _broker(client, "ask-retention-audit@example.com")
    conversation = await _conversation(db_session, broker_id, messages=[("broker", "Old"), ("assistant", "Reply")])
    conversation.last_message_at = datetime.now(timezone.utc) - timedelta(days=91)
    await db_session.commit()
    message_ids = {str(m) for m in (await db_session.execute(select(AskMessage.id))).scalars()}

    await ask.purge_expired_conversations(db_session)

    entries = await _delete_entries(db_session, "system:ask conversation 90-day retention")
    assert entries["ask_conversations"] == ({str(conversation.id)}, 1)
    assert entries["ask_messages"] == (message_ids, 2)
    other_endpoints = {entry.endpoint for entry in (await db_session.execute(select(PhiAccessLog).where(
        PhiAccessLog.table_name == "ask_conversations", PhiAccessLog.operation == "delete",
    ))).scalars()}
    assert other_endpoints == {"system:ask conversation 90-day retention"}


@pytest.mark.asyncio
async def test_cleanup_works_through_a_backlog_in_batches(client, db_session, monkeypatch):
    _, broker_id = await _broker(client, "ask-retention-batches@example.com")
    monkeypatch.setattr(ask, "_PURGE_BATCH_SIZE", 2)
    old = datetime.now(timezone.utc) - timedelta(days=120)
    for n in range(5):
        conversation = await _conversation(db_session, broker_id, messages=[("broker", f"Old {n}")])
        conversation.last_message_at = old
    kept = await _conversation(db_session, broker_id, messages=[("broker", "Fresh")])
    await db_session.commit()

    assert await ask.purge_expired_conversations(db_session) == 5
    assert (await db_session.execute(select(AskConversation.id))).scalars().all() == [kept.id]


class _FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_a_failed_purge_is_retried_sooner_backing_off_to_the_hourly_interval(monkeypatch):
    outcomes = [RuntimeError("db down"), RuntimeError("db down"), RuntimeError("db down"), 3, 0]

    async def purge(session):
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    delays: list[float] = []

    async def sleep(seconds):
        delays.append(seconds)
        if not outcomes:
            raise asyncio.CancelledError  # how the app stops the loop at shutdown

    monkeypatch.setattr(ask, "purge_expired_conversations", purge)
    monkeypatch.setattr(ask, "_sleep", sleep)

    with pytest.raises(asyncio.CancelledError):
        await ask.run_retention_loop(_FakeSession, interval_seconds=3600, retry_seconds=60)

    # Each failure retries sooner, doubling; a success returns to the hourly pace.
    assert delays == [60, 120, 240, 3600, 3600]


@pytest.mark.asyncio
async def test_purge_retries_never_wait_longer_than_the_hourly_interval(monkeypatch):
    failures = 10

    async def purge(session):
        raise RuntimeError("db down")

    delays: list[float] = []

    async def sleep(seconds):
        delays.append(seconds)
        if len(delays) == failures:
            raise asyncio.CancelledError

    monkeypatch.setattr(ask, "purge_expired_conversations", purge)
    monkeypatch.setattr(ask, "_sleep", sleep)

    with pytest.raises(asyncio.CancelledError):
        await ask.run_retention_loop(_FakeSession, interval_seconds=3600, retry_seconds=60)

    assert delays == [60, 120, 240, 480, 960, 1920, 3600, 3600, 3600, 3600]


# ── Daily usage cap ─────────────────────────────────────────────────────────


async def _set_zone(db_session, broker_id, name):
    db_session.add(BrokerPreference(broker_id=broker_id, timezone_name=name))
    await db_session.commit()


async def _consume(db_session, broker_id, now):
    with _as_broker(broker_id):
        try:
            return await ask.consume_ask_message(db_session, now=now)
        finally:
            await db_session.commit()


@pytest.mark.asyncio
async def test_broker_can_send_200_ask_messages_a_day_and_then_gets_a_clear_limit(client, db_session):
    _, broker_id = await _broker(client, "ask-cap@example.com")
    now = datetime(2026, 11, 4, 15, 0, tzinfo=timezone.utc)

    allowances = [await _consume(db_session, broker_id, now) for _ in range(200)]
    with pytest.raises(ask.AskDailyLimitReached) as error:
        await _consume(db_session, broker_id, now)

    assert [a.used for a in allowances] == list(range(1, 201))
    assert error.value.status_code == 429
    assert "200 Ask HealthFlow messages for today" in error.value.detail
    assert "The rest of HealthFlow keeps working" in error.value.detail
    assert int(error.value.headers["Retry-After"]) == 9 * 3600  # until midnight UTC


@pytest.mark.asyncio
async def test_the_cap_resets_at_midnight_in_the_brokers_saved_time_zone(client, db_session):
    _, broker_id = await _broker(client, "ask-cap-zone@example.com")
    await _set_zone(db_session, broker_id, "America/New_York")
    # 9:30 PM on Nov 4 in New York is 02:30 UTC on Nov 5.
    evening = datetime(2026, 11, 5, 2, 30, tzinfo=timezone.utc)
    db_session.add(AskUsageDay(broker_id=broker_id, usage_date=evening.date().replace(day=4), message_count=200))
    await db_session.commit()

    with pytest.raises(ask.AskDailyLimitReached) as error:
        await _consume(db_session, broker_id, evening)
    assert error.value.resets_at == datetime(2026, 11, 5, 0, 0, tzinfo=error.value.resets_at.tzinfo)
    assert "America/New_York" in error.value.detail
    with pytest.raises(ask.AskDailyLimitReached):
        await _consume(db_session, broker_id, datetime(2026, 11, 5, 4, 59, tzinfo=timezone.utc))  # 11:59 PM

    after_midnight = await _consume(db_session, broker_id, datetime(2026, 11, 5, 5, 1, tzinfo=timezone.utc))
    assert after_midnight.used == 1


@pytest.mark.asyncio
async def test_the_cap_is_per_broker_and_survives_deleting_conversations(client, db_session):
    headers, broker_id = await _broker(client, "ask-cap-own@example.com")
    _, other_id = await _broker(client, "ask-cap-other@example.com")
    now = datetime.now(timezone.utc)
    conversation = await _conversation(db_session, broker_id, messages=[("broker", "Hi")])
    db_session.add(AskUsageDay(broker_id=broker_id, usage_date=now.date(), message_count=200))
    await db_session.commit()

    await client.delete(f"/ask/conversations/{conversation.id}", headers=headers)

    with pytest.raises(ask.AskDailyLimitReached):
        await _consume(db_session, broker_id, now)
    assert (await _consume(db_session, other_id, now)).used == 1
    # Only Ask is limited: the rest of the workspace keeps answering.
    assert (await client.get("/tasks", headers=headers)).status_code == 200
    assert (await client.get("/ask/conversations", headers=headers)).status_code == 200


# ── Claude call logging ─────────────────────────────────────────────────────


@pytest.fixture
def invocation_rows(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'invocations.db'}")
    Base.metadata.create_all(engine)
    logger = InvocationLogger()
    monkeypatch.setattr(logger, "_engine", engine)
    monkeypatch.setattr(ask, "invocation", logger)

    def rows():
        with Session(engine) as session:
            return list(session.execute(select(AgentInvocationLog)).scalars())
    return rows


class _Usage:
    input_tokens = 1200
    output_tokens = 340
    cache_read_input_tokens = 800
    cache_creation_input_tokens = None


def test_every_ask_claude_call_is_logged_with_model_tokens_duration_and_outcome(invocation_rows):
    conversation_id = uuid.uuid4()

    with ask.ask_claude_call(conversation_id=conversation_id, model="claude-sonnet-5-5") as call:
        call.record_usage(_Usage())

    [row] = invocation_rows()
    assert row.agent == "ask_healthflow"
    assert row.event_type == "claude_call"
    assert row.model_used == "claude-sonnet-5-5"
    assert row.duration_ms is not None
    assert row.error is None
    assert row.details == {
        "conversation_id": str(conversation_id), "outcome": "succeeded",
        "input_tokens": 1200, "output_tokens": 340,
        "cache_read_input_tokens": 800, "cache_creation_input_tokens": 0,
    }


def test_a_failed_ask_claude_call_is_logged_without_any_message_text(invocation_rows):
    secret = "Marjorie's insulin went to Tier 4"

    with pytest.raises(RuntimeError):
        with ask.ask_claude_call(conversation_id=uuid.uuid4(), model="claude-sonnet-5-5"):
            raise RuntimeError(f"upstream echoed the prompt: {secret}")

    [row] = invocation_rows()
    assert row.details["outcome"] == "failed"
    assert row.error == "RuntimeError"
    assert "Marjorie" not in repr(row.details)
