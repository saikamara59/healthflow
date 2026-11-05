"""Structured agent-invocation logger.

Sibling of `AuditLogger` (text rotating file). One write per wrapped
operation, into the `agent_invocation_log` DB table. Carries the
`case_id` ContextVar so forensics can chain related calls.

Five behaviors that distinguish this from a one-line ORM insert:

1. **Failure-safe:** DB write exceptions are swallowed and forwarded
   to the text-log AuditLogger. Audit infrastructure failures must
   NEVER block the wrapped operation.
2. **Exception path writes a row too:** if the body of the wrapped
   `with invocation(...) as inv:` block raises, the row is still
   written (with the `error` field populated). Failed invocations
   are the most important to capture for forensics.
3. **Caller-supplied details:** `inv.details = {...}` inside the body
   lets the caller attach payload metadata (input shape, output
   length, etc.) — recorded on the row alongside duration.
4. **Sync engine, sync session:** writes happen synchronously via a
   parallel sync SQLAlchemy engine so the request's async transaction
   is unaffected. The write is a single small insert; blocking the
   event loop for <5ms is acceptable at HealthFlow's scale.
5. **Connection cleanup:** the session lives inside a try/finally so
   no engine connections leak on exception paths.
"""
import logging
import os
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from healthflow.auth.case_context import case_id as _case_id_var
from healthflow.auth.tenant_context import current_broker_id, current_endpoint
from healthflow.database.models import AgentInvocationLog
from healthflow.logs.audit import AuditLogger
from healthflow.logs._sync_engine import sync_url as _sync_url

logger = logging.getLogger(__name__)

# Only these code-owned operation names may leave the host. Never export the
# record's case/broker IDs, details, or exception message to Logfire.
_LOGFIRE_AGENT_EVENTS = {
    "comparison": frozenset({"recommend"}),
    "cost_calculator": frozenset({"calculate"}),
    "network": frozenset({"verify"}),
    "translation": frozenset({"translate"}),
    "appeal": frozenset({"process_appeal", "process_denial_record"}),
    "temporal_awareness": frozenset({"generate_plan"}),
    "ask_healthflow": frozenset({"claude_call"}),
}
_logfire_enabled = False


def configure_agent_logfire() -> None:
    """Enable metadata-only agent records when a Logfire token is available."""
    global _logfire_enabled
    _logfire_enabled = False
    if not os.getenv("LOGFIRE_TOKEN", "").strip():
        return

    try:
        import logfire

        # Do not instrument Pydantic AI: its spans can include prompts,
        # responses, and exception messages. Only the allowlisted record below
        # is exported. Disable argument introspection as a second guard.
        logfire.configure(
            service_name="healthflow-agent-invocations",
            send_to_logfire="if-token-present",
            console=False,
            inspect_arguments=False,
        )
    except Exception as exc:
        logger.warning(
            "Logfire agent tracing unavailable (%s); continuing without it",
            type(exc).__name__,
        )
    else:
        _logfire_enabled = True


def _emit_logfire_invocation(record: "_InvocationRecord") -> None:
    if not _logfire_enabled:
        return
    if record.event_type not in _LOGFIRE_AGENT_EVENTS.get(record.agent, ()):
        return

    try:
        import logfire

        logfire.info(
            "healthflow agent invocation",
            agent=record.agent,
            operation=record.event_type,
            duration_ms=record.duration_ms,
            status="failed" if record.error is not None else "succeeded",
        )
    except Exception as exc:
        logger.warning("Logfire agent record failed (%s)", type(exc).__name__)


@dataclass
class _InvocationRecord:
    """Mutable record yielded by the context manager.

    Callers set `details` (and optionally `model_used` overriding the
    default) inside the body. The logger reads these on context exit.
    """

    agent: str
    event_type: str
    case_id: uuid.UUID | None
    broker_id: uuid.UUID | None
    endpoint: str
    model_used: str | None = None
    details: dict = field(default_factory=dict)
    # Populated by the context manager on exception. Callers should not set.
    error: str | None = None
    duration_ms: int | None = None


class InvocationLogger:
    """Sync writer for AgentInvocationLog rows.

    One process-wide instance is enough. The sync engine is created
    lazily on first write so importing this module costs nothing.
    """

    def __init__(self, audit_logger: AuditLogger | None = None) -> None:
        self._engine = None
        self._audit_logger = audit_logger or AuditLogger()

    def _ensure_engine(self):
        if self._engine is None:
            # Read DATABASE_URL at first-write time so tests can monkeypatch.
            from healthflow.database import config as _db_config
            self._engine = create_engine(_sync_url(_db_config.DATABASE_URL))
        return self._engine

    @contextmanager
    def __call__(
        self,
        *,
        agent: str,
        event_type: str,
        model: str | None = None,
        record_error_message: bool = True,
    ) -> Iterator[_InvocationRecord]:
        """Wrap an agent operation. Yields a record the caller can mutate.

        On exit (success or exception), writes one row to agent_invocation_log
        with the elapsed duration_ms. Exceptions in the body propagate; the
        row write happens first.

        Pass `record_error_message=False` when an exception message could
        carry user text (Ask HealthFlow): only the exception type is kept.
        """
        record = _InvocationRecord(
            agent=agent,
            event_type=event_type,
            case_id=_case_id_var.get(),
            broker_id=current_broker_id.get(),
            endpoint=current_endpoint.get() or "unknown",
            model_used=model,
        )
        start = time.monotonic()
        try:
            yield record
        except BaseException as exc:
            # Capture the failure in the record before re-raising. Use
            # exception type + truncated message to keep `error` bounded.
            record.error = (
                f"{type(exc).__name__}: {exc}" if record_error_message else type(exc).__name__
            )[:512]
            raise
        finally:
            record.duration_ms = int((time.monotonic() - start) * 1000)
            self._write(record)
            _emit_logfire_invocation(record)

    def _write(self, record: _InvocationRecord) -> None:
        """Best-effort insert. Any DB failure → text-log fallback, never raises."""
        try:
            engine = self._ensure_engine()
            session = Session(engine)
            try:
                session.add(AgentInvocationLog(
                    case_id=record.case_id,
                    broker_id=record.broker_id,
                    endpoint=record.endpoint,
                    agent=record.agent,
                    event_type=record.event_type,
                    model_used=record.model_used,
                    duration_ms=record.duration_ms,
                    details=record.details,
                    error=record.error,
                ))
                session.commit()
            finally:
                session.close()
        except Exception as e:
            # Fall back to the text logger. Include enough fields that a forensics
            # reader can reconstruct the row from grep + log timestamps.
            logger.warning("InvocationLogger DB write failed: %s", e)
            self._audit_logger.log(
                "agent_invocation_log_write_failed",
                {
                    "agent": record.agent,
                    "event_type": record.event_type,
                    "case_id": str(record.case_id) if record.case_id else None,
                    "broker_id": str(record.broker_id) if record.broker_id else None,
                    "endpoint": record.endpoint,
                    "model_used": record.model_used,
                    "duration_ms": record.duration_ms,
                    "details": record.details,
                    "error": record.error,
                    "fallback_reason": repr(e),
                },
            )


# Module-level singleton — agents import this and call it as a context manager.
invocation = InvocationLogger()
