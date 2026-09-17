import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
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
