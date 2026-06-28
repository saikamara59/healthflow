from __future__ import annotations

import logging
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from healthflow.database.models import DecisionRecord
from healthflow.logs._sync_engine import sync_url
from healthflow.logs.audit import AuditLogger

logger = logging.getLogger(__name__)


class DecisionRecorder:
    """Sync, failure-safe writer for decision_records rows.

    Mirrors InvocationLogger: a process-wide instance with a lazily-created sync
    engine, so it can write from the synchronous /compare handler without
    touching the request's async transaction. A capture failure is logged and
    swallowed — recording a decision must never block the recommendation.
    """

    def __init__(self, audit_logger: AuditLogger | None = None) -> None:
        self._engine = None
        self._audit_logger = audit_logger or AuditLogger()

    def _ensure_engine(self):
        if self._engine is None:
            from healthflow.database import config as _db_config
            self._engine = create_engine(sync_url(_db_config.DATABASE_URL))
        return self._engine

    def record_compare_decision(
        self,
        *,
        broker_id: uuid.UUID | None,
        client_id: uuid.UUID | None,
        inputs: dict,
        recommended_plan: dict,
        alternatives: list[dict],
        recommendation_text: str,
        basis: str,
        model_used: str | None,
        duration_ms: int | None,
    ) -> uuid.UUID | None:
        """Persist one decision_records row. Returns the decision_id, or None
        when there is no broker (anonymous compare) or the write fails."""
        if broker_id is None:
            return None

        decision_id = uuid.uuid4()
        content = {
            "inputs": inputs,
            "recommended_plan": recommended_plan,
            "alternatives": alternatives,
            "recommendation_text": recommendation_text,
            "basis": basis,
        }
        try:
            engine = self._ensure_engine()
            session = Session(engine)
            try:
                session.add(DecisionRecord(
                    id=decision_id,
                    broker_id=broker_id,
                    client_id=client_id,
                    agent_type="compare",
                    model_used=model_used,
                    duration_ms=duration_ms,
                    content=content,
                ))
                session.commit()
            finally:
                session.close()
            return decision_id
        except Exception as e:
            logger.warning("DecisionRecorder DB write failed: %s", e)
            self._audit_logger.log(
                "decision_record_write_failed",
                {"broker_id": str(broker_id), "agent_type": "compare",
                 "fallback_reason": repr(e)},
            )
            return None


# Module-level singleton — the /compare handler imports and calls this.
decision_recorder = DecisionRecorder()
