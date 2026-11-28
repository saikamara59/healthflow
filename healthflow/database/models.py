import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import JSON, TypeDecorator

from healthflow.database.encrypted_types import EncryptedJSON, EncryptedString


class Base(DeclarativeBase):
    pass


class GUID(TypeDecorator):
    """Platform-independent UUID type.
    Uses PostgreSQL's UUID type when available, otherwise stores as String(36).
    """
    impl = String(36)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None:
            if isinstance(value, uuid.UUID):
                return str(value)
            return str(uuid.UUID(value))
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            return uuid.UUID(value) if not isinstance(value, uuid.UUID) else value
        return value


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Broker(Base):
    __tablename__ = "brokers"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="broker", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    failed_login_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    clients: Mapped[list["Client"]] = relationship(back_populates="broker", cascade="all, delete-orphan")
    actions: Mapped[list["ActionHistory"]] = relationship(back_populates="broker", cascade="all, delete-orphan")
    feedbacks: Mapped[list["Feedback"]] = relationship(back_populates="broker", cascade="all, delete-orphan")


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    full_name: Mapped[str] = mapped_column(EncryptedString(2000), nullable=False)
    zip_code: Mapped[str] = mapped_column(String(5), nullable=False)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    income_level: Mapped[str] = mapped_column(String(10), nullable=False)
    doctors: Mapped[list] = mapped_column(EncryptedJSON(), default=list, nullable=False)
    prescriptions: Mapped[list] = mapped_column(EncryptedJSON(), default=list, nullable=False)
    procedures: Mapped[list] = mapped_column(EncryptedJSON(), default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    broker: Mapped["Broker"] = relationship(back_populates="clients")
    actions: Mapped[list["ActionHistory"]] = relationship(back_populates="client", cascade="all, delete-orphan")


class BrokerPreference(Base):
    __tablename__ = "broker_preferences"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), unique=True, index=True, nullable=False
    )
    timezone_name: Mapped[str] = mapped_column(
        String(64), default="UTC", server_default="UTC", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(EncryptedString(2000), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    website: Mapped[str | None] = mapped_column(EncryptedString(2000), nullable=True)
    phone: Mapped[str | None] = mapped_column(EncryptedString(2000), nullable=True)
    notes: Mapped[str | None] = mapped_column(EncryptedString(8000), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    full_name: Mapped[str] = mapped_column(EncryptedString(2000), nullable=False)
    role: Mapped[str | None] = mapped_column(EncryptedString(2000), nullable=True)
    email: Mapped[str | None] = mapped_column(EncryptedString(2000), nullable=True)
    phone: Mapped[str | None] = mapped_column(EncryptedString(2000), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    client_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("clients.id"), index=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True
    )
    contact_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("contacts.id"), index=True)
    issue_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("issues.id"), index=True)
    approval_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("approvals.id"), index=True)
    title: Mapped[str] = mapped_column(EncryptedString(4000), nullable=False)
    notes: Mapped[str | None] = mapped_column(EncryptedString(12000), nullable=True)
    priority: Mapped[str | None] = mapped_column(String(10), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open", nullable=False)
    is_follow_up: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    client_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("clients.id"), index=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True
    )
    contact_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("contacts.id"), index=True)
    issue_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("issues.id"), index=True)
    approval_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("approvals.id"), index=True)
    title: Mapped[str] = mapped_column(EncryptedString(4000), nullable=False)
    notes: Mapped[str | None] = mapped_column(EncryptedString(12000), nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="scheduled", server_default="scheduled", nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Enrollment(Base):
    """A Broker-reviewed Client enrollment; HealthFlow never transmits it."""

    __tablename__ = "enrollments"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("clients.id"), index=True, nullable=False
    )
    plan_name: Mapped[str] = mapped_column(EncryptedString(4000), nullable=False)
    effective_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    notes: Mapped[str | None] = mapped_column(EncryptedString(12000), nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), default="preparing", server_default="preparing", nullable=False
    )
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Issue(Base):
    """A Client-related case that may, but need not, contain an Appeal."""

    __tablename__ = "issues"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("clients.id"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(EncryptedString(4000), nullable=False)
    description: Mapped[str | None] = mapped_column(EncryptedString(12000), nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date(), index=True, nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), default="open", server_default="open", nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Appeal(Base):
    """A formal challenge that always belongs to an Issue."""

    __tablename__ = "appeals"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    issue_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("issues.id"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(EncryptedString(4000), nullable=False)
    draft_text: Mapped[str | None] = mapped_column(EncryptedString(30000), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), default="draft", server_default="draft", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Document(Base):
    """Broker-owned private file metadata; object keys never leave the server."""

    __tablename__ = "documents"
    __table_args__ = (
        Index("uq_documents_broker_demo_fixture", "broker_id", "demo_fixture_marker",
              unique=True, sqlite_where=text("demo_fixture_marker IS NOT NULL"),
              postgresql_where=text("demo_fixture_marker IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("clients.id"), index=True, nullable=False
    )
    display_filename: Mapped[str] = mapped_column(EncryptedString(4000), nullable=False)
    verified_type: Mapped[str] = mapped_column(String(100), nullable=False)
    byte_length: Mapped[int] = mapped_column(Integer, nullable=False)
    object_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    demo_fixture_marker: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DemoDocumentCleanupIntent(Base):
    """Private recovery journal, committed before any synthetic object PUT.

    Keys are encrypted and never copied into DocumentEvent or API payloads.
    Unique marker ownership coordinates seeding and exact-target recovery.
    """

    __tablename__ = "demo_document_cleanup_intents"
    __table_args__ = (
        Index("uq_demo_cleanup_broker_fixture", "broker_id", "fixture_marker", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("brokers.id"), nullable=False, index=True)
    fixture_marker: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(EncryptedString(4000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class DocumentLink(Base):
    """One typed association; ending a Link retains its history for re-linking."""

    __tablename__ = "document_links"
    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN enrollment_id IS NOT NULL THEN 1 ELSE 0 END + "
            "CASE WHEN issue_id IS NOT NULL THEN 1 ELSE 0 END + "
            "CASE WHEN appeal_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_document_link_one_target",
        ),
        Index("uq_document_links_active_enrollment", "document_id", "enrollment_id",
              unique=True, sqlite_where=text("ended_at IS NULL"), postgresql_where=text("ended_at IS NULL")),
        Index("uq_document_links_active_issue", "document_id", "issue_id",
              unique=True, sqlite_where=text("ended_at IS NULL"), postgresql_where=text("ended_at IS NULL")),
        Index("uq_document_links_active_appeal", "document_id", "appeal_id",
              unique=True, sqlite_where=text("ended_at IS NULL"), postgresql_where=text("ended_at IS NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("clients.id"), index=True, nullable=False
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("documents.id"), index=True, nullable=False
    )
    enrollment_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("enrollments.id"), nullable=True)
    issue_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("issues.id"), nullable=True)
    appeal_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("appeals.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DocumentEvent(Base):
    """Explicit audit writes, excluded from tenant and PHI-audit registries.

    Identifier snapshots intentionally have no FKs so demo resets retain the
    audit trail. Unknown Client/Document IDs can be absent on denied attempts.
    System seed/reset events explicitly identify a system actor.
    """

    __tablename__ = "document_events"
    __table_args__ = (
        CheckConstraint(
            "(actor_kind = 'broker' AND actor_id IS NOT NULL) OR "
            "(actor_kind = 'system' AND actor_id IS NULL)",
            name="ck_document_event_actor",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(GUID(), index=True, nullable=False)
    document_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), index=True, nullable=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), index=True, nullable=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    actor_kind: Mapped[str] = mapped_column(String(10), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    outcome: Mapped[str] = mapped_column(String(50), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )


class WorkspaceSearchToken(Base):
    """Broker-private HMAC search gram for an encrypted workspace title."""

    __tablename__ = "workspace_search_tokens"
    __table_args__ = (Index("ix_workspace_search_tokens_lookup", "broker_id", "digest"),)

    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(20), primary_key=True)
    record_id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    key_version: Mapped[str] = mapped_column(String(10), primary_key=True)
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)


class Approval(Base):
    """A change software proposed that waits for the owning Broker (ADR 0003).

    Pending until decided; once approved or rejected the row is never changed
    or deleted. Proposal and decision text are encrypted PHI.
    """

    __tablename__ = "approvals"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    client_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("clients.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    state: Mapped[str] = mapped_column(
        String(20), default="pending", server_default="pending", index=True, nullable=False
    )
    proposer_agent: Mapped[str] = mapped_column(String(60), nullable=False)
    proposer_model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    excerpt: Mapped[str] = mapped_column(EncryptedString(8000), nullable=False)
    note: Mapped[str | None] = mapped_column(EncryptedString(2000), nullable=True)
    proposed_values: Mapped[dict] = mapped_column(EncryptedJSON(20000), nullable=False)
    approved_values: Mapped[dict | None] = mapped_column(EncryptedJSON(20000), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(EncryptedString(4000), nullable=True)
    decided_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("brokers.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_via: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_record_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class AskConversation(Base):
    """One exchange between a Broker and Ask HealthFlow (ADR 0005).

    Private to its Broker. Deleted 90 days after its last message, or sooner
    when the Broker deletes it. Approvals it produced point back through
    `Approval.source_id` (no foreign key), so deleting a conversation never
    touches them; each Approval keeps its own excerpt.
    """

    __tablename__ = "ask_conversations"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    title: Mapped[str | None] = mapped_column(EncryptedString(), nullable=True)
    # Client IDs the Broker added to this conversation, as strings.
    client_context: Mapped[list] = mapped_column(EncryptedJSON(), default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    last_message_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )


class AskMessage(Base):
    """One message in an Ask Conversation, from the Broker or from Ask HealthFlow."""

    __tablename__ = "ask_messages"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("ask_conversations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(EncryptedString(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class AskUsageDay(Base):
    """Ask messages a Broker sent on one day in their saved time zone.

    Counts only, no PHI. Kept apart from the conversations so deleting a
    conversation cannot reset the daily cap.
    """

    __tablename__ = "ask_usage_days"
    __table_args__ = (Index("ux_ask_usage_days_broker_date", "broker_id", "usage_date", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    usage_date: Mapped[date] = mapped_column(Date, nullable=False)
    message_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)


class WorkspaceActivity(Base):
    __tablename__ = "workspace_activity"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    client_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("clients.id"), index=True)
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(GUID(), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    summary: Mapped[str] = mapped_column(EncryptedString(4000), nullable=False)
    details: Mapped[dict] = mapped_column(EncryptedJSON(), default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )


class ActionHistory(Base):
    __tablename__ = "action_history"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("clients.id"), index=True, nullable=False
    )
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    request_data: Mapped[dict] = mapped_column(EncryptedJSON(), default=dict, nullable=False)
    response_summary: Mapped[dict] = mapped_column(EncryptedJSON(), default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    broker: Mapped["Broker"] = relationship(back_populates="actions")
    client: Mapped["Client"] = relationship(back_populates="actions")


class DecisionRecord(Base):
    """Durable, attributable record of one agent recommendation (compare in v1).

    Captured at recommendation time (see healthflow/decisions/recorder.py). The
    PHI-bearing payload (client inputs + the recommendation) lives in the
    encrypted `content` blob; metadata columns are plaintext. Tenant-scoped via
    broker_id (registered in tenant_filter.TENANT_SCOPED_MODELS).
    """
    __tablename__ = "decision_records"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    client_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("clients.id"), index=True, nullable=True
    )
    agent_type: Mapped[str] = mapped_column(String(50), nullable=False)
    model_used: Mapped[str | None] = mapped_column(String(50), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content: Mapped[dict] = mapped_column(EncryptedJSON(), default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("brokers.id"), index=True, nullable=False
    )
    output_id: Mapped[str] = mapped_column(String(255), nullable=False)
    agent_type: Mapped[str] = mapped_column(String(50), nullable=False)
    accuracy: Mapped[int] = mapped_column(Integer, nullable=False)
    clarity: Mapped[int] = mapped_column(Integer, nullable=False)
    helpfulness: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str] = mapped_column(EncryptedString(4000), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    broker: Mapped["Broker"] = relationship(back_populates="feedbacks")


class PromptVariant(Base):
    __tablename__ = "prompt_variants"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    agent_type: Mapped[str] = mapped_column(String(50), nullable=False)
    variant_name: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_template: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    traffic_pct: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class PhiAccessLog(Base):
    """Append-only audit trail: one row per PHI query.

    System table — NOT tenant-scoped (it records everyone's access) and
    NOT watched by the audit listeners themselves (writing an entry is a
    DB write; watching this table would recurse forever). See
    healthflow/database/phi_audit.py.
    """
    __tablename__ = "phi_access_log"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    broker_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), index=True, nullable=True
    )
    table_name: Mapped[str] = mapped_column(String(50), nullable=False)
    operation: Mapped[str] = mapped_column(String(10), nullable=False)
    row_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )


class RefreshToken(Base):
    """Per-token revocation state for refresh-token rotation.

    System table — same pattern as PhiAccessLog: not in TENANT_SCOPED_MODELS
    (no broker-ownership semantics; broker_id is "who issued," not "who owns"),
    not in _AUDITED_MODELS (refresh-token CRUD is operational metadata, not
    patient-data access). The theft-signal mass-revoke is logged via the
    WARN-level AuditLogger, not phi_access_log.
    """
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True, nullable=True
    )


class PasswordResetToken(Base):
    """One row per password-reset request — single-use via `used_at`.

    System table — not tenant-scoped, not in _AUDITED_MODELS (reset bookkeeping
    is auth metadata, not patient-data access). The 60-second cooldown is
    enforced by querying this table; no Redis required.
    """
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    broker_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class AgentInvocationLog(Base):
    """Structured per-agent-call audit row.

    Sibling of `PhiAccessLog`: system table, not tenant-scoped, not in
    `_AUDITED_MODELS` (recording an invocation is operational metadata, not
    patient-data access). Forensics tooling reads this table to reconstruct
    "what did agents A, B, C do for case X" timelines.

    Writer: `healthflow.logs.invocation.InvocationLogger`. The legacy
    `AuditLogger` (text log file) keeps running alongside — agents emit BOTH
    a text-log line and an invocation row, until the text log is retired.
    """
    __tablename__ = "agent_invocation_log"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), index=True, nullable=True
    )
    broker_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), index=True, nullable=True
    )
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    agent: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    model_used: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    error: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )


class ForensicsAccessLog(Base):
    """One row per forensics query — self-audit for admin reads of the audit tables.

    System table — not tenant-scoped (records cross-broker admin activity),
    not in `_AUDITED_MODELS` (forensics queries are not PHI access).
    """
    __tablename__ = "forensics_access_log"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    operator_id: Mapped[uuid.UUID] = mapped_column(GUID(), index=True, nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_key: Mapped[str] = mapped_column(String(255), nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), index=True, nullable=True)
    from_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    to_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    result_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )
