# Decision Record (compare agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an authenticated broker runs a plan comparison, persist a durable, attributable Decision Record and expose a tenant-scoped `GET /decisions/{id}` to read it back.

**Architecture:** A new `decision_records` table (encrypted `content`, tenant-scoped). Capture mirrors the invocation logger — a sync, failure-safe writer invoked from the synchronous `/compare` handler, so a logging write never blocks the recommendation. Reads go through the normal async path where the tenant filter auto-scopes by `broker_id`. Spec: `docs/superpowers/specs/2026-06-28-decision-record-design.md`.

**Tech Stack:** Python 3.14, FastAPI, async SQLAlchemy (+ a parallel sync engine for the write), Pydantic, the existing `EncryptedJSON` column type + `GUID` type + tenant filter.

---

### Task 1: Extract the sync-URL helper (DRY)

**Files:**
- Create: `healthflow/logs/_sync_engine.py`
- Modify: `healthflow/logs/invocation.py:44-58` (replace the local `_sync_url` def with a re-export)
- Test: `healthflow/tests/observability/test_sync_engine.py`

The recorder (Task 4) needs the same async→sync URL conversion the invocation logger has. Extract it once. The existing `test_invocation_logger.py` imports `_sync_url` from `invocation.py`, so we keep that name importable via a re-export.

- [ ] **Step 1: Write the failing test**

`healthflow/tests/observability/test_sync_engine.py`:
```python
from healthflow.logs._sync_engine import sync_url


def test_sync_url_converts_aiosqlite():
    assert sync_url("sqlite+aiosqlite:///healthflow.db") == "sqlite:///healthflow.db"


def test_sync_url_converts_asyncpg_to_psycopg():
    assert sync_url("postgresql+asyncpg://user:pw@host/db") == "postgresql+psycopg://user:pw@host/db"


def test_sync_url_passes_through_unknown():
    assert sync_url("mysql+aiomysql://x") == "mysql+aiomysql://x"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest healthflow/tests/observability/test_sync_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'healthflow.logs._sync_engine'`.

- [ ] **Step 3: Create the shared module**

`healthflow/logs/_sync_engine.py`:
```python
"""Async→sync SQLAlchemy URL conversion, shared by the invocation logger and
the decision recorder (both write from synchronous request paths via a
parallel sync engine)."""


def sync_url(async_url: str) -> str:
    """Convert an async SQLAlchemy URL to its sync equivalent.

      * sqlite+aiosqlite:///healthflow.db → sqlite:///healthflow.db
      * postgresql+asyncpg://...          → postgresql+psycopg://...

    Anything else is returned unchanged (SQLAlchemy raises on engine creation —
    better than a silent surprise).
    """
    if async_url.startswith("sqlite+aiosqlite"):
        return async_url.replace("sqlite+aiosqlite", "sqlite", 1)
    if async_url.startswith("postgresql+asyncpg"):
        return async_url.replace("postgresql+asyncpg", "postgresql+psycopg", 1)
    return async_url
```

- [ ] **Step 4: Re-export from invocation.py**

In `healthflow/logs/invocation.py`, delete the `def _sync_url(...)` function body (lines 44-58) and replace it with a re-export so existing imports keep working:
```python
from healthflow.logs._sync_engine import sync_url as _sync_url
```
Place this import with the other imports near the top (after the existing `from sqlalchemy import create_engine` block is fine). Then `_ensure_engine` keeps calling `_sync_url(...)` unchanged.

- [ ] **Step 5: Run both test files to verify pass**

Run: `.venv/bin/python -m pytest healthflow/tests/observability/test_sync_engine.py healthflow/tests/observability/test_invocation_logger.py -v`
Expected: PASS — the new 3 tests AND the existing invocation tests (which import `_sync_url` from invocation) all pass.

- [ ] **Step 6: Commit**

```bash
git add healthflow/logs/_sync_engine.py healthflow/logs/invocation.py healthflow/tests/observability/test_sync_engine.py
git commit -m "refactor(logs): extract shared sync_url helper for reuse"
```

---

### Task 2: `DecisionRecord` model + tenant registration

**Files:**
- Modify: `healthflow/database/models.py` (add `DecisionRecord` near `ActionHistory`)
- Modify: `healthflow/database/tenant_filter.py:41` (add to `TENANT_SCOPED_MODELS`)
- Test: `healthflow/tests/decisions/__init__.py` (new, empty), `healthflow/tests/decisions/test_model.py`

- [ ] **Step 1: Write the failing test**

Create empty `healthflow/tests/decisions/__init__.py`, then `healthflow/tests/decisions/test_model.py`:
```python
from healthflow.database.models import DecisionRecord
from healthflow.database.tenant_filter import TENANT_SCOPED_MODELS


def test_decision_record_table_and_columns():
    assert DecisionRecord.__tablename__ == "decision_records"
    cols = DecisionRecord.__table__.columns
    for name in ("id", "broker_id", "client_id", "agent_type",
                 "model_used", "duration_ms", "content", "created_at"):
        assert name in cols, f"missing column {name}"
    # client_id is nullable (compare has no client); broker_id is not
    assert cols["client_id"].nullable is True
    assert cols["broker_id"].nullable is False


def test_decision_record_is_tenant_scoped():
    # registered so the do_orm_execute hook auto-filters reads by broker_id
    assert DecisionRecord in TENANT_SCOPED_MODELS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/test_model.py -v`
Expected: FAIL — `ImportError: cannot import name 'DecisionRecord'`.

- [ ] **Step 3: Add the model**

In `healthflow/database/models.py`, add after the `ActionHistory` class (the `GUID`, `EncryptedJSON`, `_utcnow`, `String`, `Integer`, `DateTime`, `ForeignKey` names are all already in scope in this file):
```python
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
```

- [ ] **Step 4: Register tenant scope**

In `healthflow/database/tenant_filter.py`, find the import of models and the `TENANT_SCOPED_MODELS` line (line 41). Add `DecisionRecord`:
- Add `DecisionRecord` to the existing `from healthflow.database.models import ...` line in that file.
- Change:
  ```python
  TENANT_SCOPED_MODELS: frozenset[type] = frozenset({Client, ActionHistory, Feedback})
  ```
  to:
  ```python
  TENANT_SCOPED_MODELS: frozenset[type] = frozenset({Client, ActionHistory, Feedback, DecisionRecord})
  ```
(The `_TENANT_SCOPED_TABLE_NAMES` set on line ~103 is derived from `TENANT_SCOPED_MODELS` automatically, so the raw-SQL guard updates itself.)

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/test_model.py -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add healthflow/database/models.py healthflow/database/tenant_filter.py healthflow/tests/decisions/__init__.py healthflow/tests/decisions/test_model.py
git commit -m "feat(decisions): DecisionRecord model + tenant-scope registration"
```

---

### Task 3: Response schema + shaper

**Files:**
- Modify: `healthflow/models/schemas.py` (add `DecisionRecordResponse`)
- Create: `healthflow/decisions/__init__.py` (empty), `healthflow/decisions/shaper.py`
- Test: `healthflow/tests/decisions/test_shaper.py`

- [ ] **Step 1: Write the failing test**

Create empty `healthflow/decisions/__init__.py`, then `healthflow/tests/decisions/test_shaper.py`:
```python
import uuid
from datetime import datetime, timezone

from healthflow.database.models import DecisionRecord
from healthflow.decisions.shaper import to_response
from healthflow.models.schemas import DecisionRecordResponse


def _record():
    return DecisionRecord(
        id=uuid.uuid4(),
        broker_id=uuid.uuid4(),
        client_id=None,
        agent_type="compare",
        model_used="claude-haiku-4-5",
        duration_ms=1200,
        content={
            "inputs": {"zip_code": "10025", "age": 67},
            "recommended_plan": {"plan_name": "Aetna Prime"},
            "alternatives": [{"plan_name": "Bronze HSA"}],
            "recommendation_text": "Aetna Prime is the best value.",
            "basis": "Top-ranked of 8 plans compared for a medium-income profile",
        },
        created_at=datetime(2026, 6, 28, 12, 0, tzinfo=timezone.utc),
    )


def test_to_response_maps_all_fields():
    r = _record()
    resp = to_response(r)
    assert isinstance(resp, DecisionRecordResponse)
    assert resp.id == str(r.id)
    assert resp.broker_id == str(r.broker_id)
    assert resp.agent_type == "compare"
    assert resp.model_used == "claude-haiku-4-5"
    assert resp.created_at == "2026-06-28T12:00:00+00:00"
    assert resp.recommended_plan == {"plan_name": "Aetna Prime"}
    assert resp.recommendation_text == "Aetna Prime is the best value."
    assert resp.basis.startswith("Top-ranked of 8")
    assert resp.alternatives == [{"plan_name": "Bronze HSA"}]
    assert resp.inputs == {"zip_code": "10025", "age": 67}


def test_to_response_tolerates_empty_content():
    r = _record()
    r.content = {}
    resp = to_response(r)
    assert resp.recommended_plan == {}
    assert resp.alternatives == []
    assert resp.recommendation_text == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/test_shaper.py -v`
Expected: FAIL — cannot import `DecisionRecordResponse` / `to_response`.

- [ ] **Step 3: Add the schema**

In `healthflow/models/schemas.py`, add (near the other response models):
```python
class DecisionRecordResponse(BaseModel):
    id: str
    created_at: str
    agent_type: str
    model_used: str | None
    broker_id: str
    recommended_plan: dict
    recommendation_text: str
    basis: str
    alternatives: list[dict]
    inputs: dict
```

- [ ] **Step 4: Write the shaper**

`healthflow/decisions/shaper.py`:
```python
from healthflow.database.models import DecisionRecord
from healthflow.models.schemas import DecisionRecordResponse


def to_response(record: DecisionRecord) -> DecisionRecordResponse:
    """Map a (decrypted) DecisionRecord row to the broker-facing response.

    Pure — no I/O. `record.content` is the decrypted dict (the EncryptedJSON
    column decrypts on load). Tolerates a missing/partial content blob.
    """
    content = record.content or {}
    return DecisionRecordResponse(
        id=str(record.id),
        created_at=record.created_at.isoformat(),
        agent_type=record.agent_type,
        model_used=record.model_used,
        broker_id=str(record.broker_id),
        recommended_plan=content.get("recommended_plan", {}),
        recommendation_text=content.get("recommendation_text", ""),
        basis=content.get("basis", ""),
        alternatives=content.get("alternatives", []),
        inputs=content.get("inputs", {}),
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/test_shaper.py -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add healthflow/models/schemas.py healthflow/decisions/__init__.py healthflow/decisions/shaper.py healthflow/tests/decisions/test_shaper.py
git commit -m "feat(decisions): DecisionRecordResponse schema + row->response shaper"
```

---

### Task 4: `DecisionRecorder` (sync, failure-safe capture)

**Files:**
- Create: `healthflow/decisions/recorder.py`
- Test: `healthflow/tests/decisions/test_recorder.py`

- [ ] **Step 1: Write the failing tests**

`healthflow/tests/decisions/test_recorder.py`:
```python
import uuid

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from healthflow.database.models import Base, DecisionRecord
from healthflow.decisions.recorder import DecisionRecorder

INPUTS = {"zip_code": "10025", "age": 67, "income_level": "medium",
          "medications": ["metformin"], "procedures": []}
PLAN = {"plan_name": "Aetna Prime", "plan_id": "p1"}


def test_returns_none_when_broker_is_none():
    # No broker context (anonymous compare) → no capture, no engine touched.
    rec = DecisionRecorder()
    result = rec.record_compare_decision(
        broker_id=None, client_id=None, inputs=INPUTS,
        recommended_plan=PLAN, alternatives=[], recommendation_text="x",
        basis="b", model_used="m", duration_ms=1,
    )
    assert result is None
    assert rec._engine is None  # never created an engine


@pytest.fixture
def rec_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'dec.db'}")
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def recorder(rec_engine, monkeypatch):
    r = DecisionRecorder()
    monkeypatch.setattr(r, "_engine", rec_engine)
    return r


def test_writes_row_and_content_round_trips(recorder, rec_engine):
    broker_id = uuid.uuid4()
    decision_id = recorder.record_compare_decision(
        broker_id=broker_id, client_id=None, inputs=INPUTS,
        recommended_plan=PLAN, alternatives=[{"plan_name": "Bronze"}],
        recommendation_text="Aetna Prime is best.", basis="ranked 2 plans",
        model_used="claude-haiku-4-5", duration_ms=900,
    )
    assert isinstance(decision_id, uuid.UUID)
    with Session(rec_engine) as s:
        row = s.execute(select(DecisionRecord).where(DecisionRecord.id == decision_id)).scalar_one()
    assert row.broker_id == broker_id
    assert row.agent_type == "compare"
    assert row.model_used == "claude-haiku-4-5"
    # EncryptedJSON round-trips to the same structure
    assert row.content["inputs"] == INPUTS
    assert row.content["recommended_plan"] == PLAN
    assert row.content["recommendation_text"] == "Aetna Prime is best."
    assert row.content["alternatives"] == [{"plan_name": "Bronze"}]


def test_write_failure_returns_none_and_does_not_raise(monkeypatch):
    # A broken engine must not propagate — capture is best-effort.
    rec = DecisionRecorder()
    class _BoomEngine:
        pass
    monkeypatch.setattr(rec, "_engine", _BoomEngine())  # Session() will fail on this
    result = rec.record_compare_decision(
        broker_id=uuid.uuid4(), client_id=None, inputs=INPUTS,
        recommended_plan=PLAN, alternatives=[], recommendation_text="x",
        basis="b", model_used="m", duration_ms=1,
    )
    assert result is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/test_recorder.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'healthflow.decisions.recorder'`.

- [ ] **Step 3: Write the recorder**

`healthflow/decisions/recorder.py`:
```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/test_recorder.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add healthflow/decisions/recorder.py healthflow/tests/decisions/test_recorder.py
git commit -m "feat(decisions): sync failure-safe DecisionRecorder"
```

---

### Task 5: `GET /decisions/{id}` router

**Files:**
- Create: `healthflow/decisions/router.py`
- Modify: `healthflow/main.py` (mount the router)
- Test: `healthflow/tests/decisions/test_routes.py`

- [ ] **Step 1: Write the failing tests**

`healthflow/tests/decisions/test_routes.py` (mirrors `test_feedback_routes.py`: build a broker + token, insert a row via `db_session`, read via `client`):
```python
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.security import create_access_token, hash_password
from healthflow.database.models import Broker, DecisionRecord


async def _broker_and_token(db: AsyncSession):
    bid = uuid.uuid4()
    db.add(Broker(id=bid, email=f"dr-{bid.hex[:6]}@test.com",
                  hashed_password=hash_password("testpass123"), full_name="DR Tester"))
    await db.commit()
    return bid, create_access_token({"sub": str(bid), "type": "access"})


async def _insert_decision(db: AsyncSession, broker_id):
    did = uuid.uuid4()
    db.add(DecisionRecord(
        id=did, broker_id=broker_id, client_id=None, agent_type="compare",
        model_used="claude-haiku-4-5", duration_ms=900,
        content={"inputs": {"age": 67}, "recommended_plan": {"plan_name": "Aetna Prime"},
                 "alternatives": [], "recommendation_text": "best value", "basis": "ranked 3"},
    ))
    await db.commit()
    return did


@pytest.mark.anyio
async def test_get_decision_returns_record_for_owner(client: AsyncClient, db_session: AsyncSession):
    bid, token = await _broker_and_token(db_session)
    did = await _insert_decision(db_session, bid)
    resp = await client.get(f"/decisions/{did}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == str(did)
    assert data["recommended_plan"] == {"plan_name": "Aetna Prime"}
    assert data["recommendation_text"] == "best value"
    assert data["broker_id"] == str(bid)


@pytest.mark.anyio
async def test_get_decision_other_broker_gets_404(client: AsyncClient, db_session: AsyncSession):
    owner_id, _ = await _broker_and_token(db_session)
    did = await _insert_decision(db_session, owner_id)
    _, other_token = await _broker_and_token(db_session)  # a different broker
    resp = await client.get(f"/decisions/{did}", headers={"Authorization": f"Bearer {other_token}"})
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_get_decision_unknown_id_404(client: AsyncClient, db_session: AsyncSession):
    _, token = await _broker_and_token(db_session)
    resp = await client.get(f"/decisions/{uuid.uuid4()}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_get_decision_requires_auth(client: AsyncClient):
    resp = await client.get(f"/decisions/{uuid.uuid4()}")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/test_routes.py -v`
Expected: FAIL — 404/route-not-found (router not mounted yet) or import error.

- [ ] **Step 3: Write the router**

`healthflow/decisions/router.py`:
```python
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
```

- [ ] **Step 4: Mount the router**

In `healthflow/main.py`, near the other `app.include_router(...)` calls (e.g. after `app.include_router(feedback_router)`), add:
```python
from healthflow.decisions.router import decisions_router
app.include_router(decisions_router)
```
(Match the file's existing import style — if routers are imported at the top, put the import there; otherwise the inline form above is fine.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/test_routes.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add healthflow/decisions/router.py healthflow/main.py healthflow/tests/decisions/test_routes.py
git commit -m "feat(decisions): tenant-scoped GET /decisions/{id}"
```

---

### Task 6: Wire `/compare` to capture + return `decision_id`

**Files:**
- Modify: `healthflow/models/schemas.py` (add `decision_id` to `CompareResponse`)
- Modify: `healthflow/api/routes.py` (the `compare_plans` handler, ~lines 92-150)
- Test: `healthflow/tests/decisions/test_compare_wiring.py`

- [ ] **Step 1: Write the failing tests**

`healthflow/tests/decisions/test_compare_wiring.py` (mirrors `test_comparison.py`: sync `TestClient`, patch the agent; here also patch the recorder singleton so we assert wiring without a DB):
```python
import uuid
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from healthflow.auth.security import create_access_token
from healthflow.main import app

client = TestClient(app)
_BODY = {"zip_code": "10001", "age": 65, "income_level": "low",
         "medications": ["Metformin"], "procedures": []}


@patch("healthflow.api.routes.decision_recorder")
@patch("healthflow.api.routes.ComparisonAgent")
def test_compare_returns_decision_id_when_recorder_captures(mock_agent_cls, mock_recorder):
    mock_agent = MagicMock()
    mock_agent.recommend.return_value = "Plan A is the best value."
    mock_agent_cls.return_value = mock_agent
    known = uuid.uuid4()
    mock_recorder.record_compare_decision.return_value = known

    token = create_access_token({"sub": str(uuid.uuid4()), "type": "access"})
    resp = client.post("/compare", json=_BODY, headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200
    assert resp.json()["decision_id"] == str(known)
    # the handler passed a broker_id (token present) and the recommendation text
    _, kwargs = mock_recorder.record_compare_decision.call_args
    assert kwargs["broker_id"] is not None
    assert kwargs["recommendation_text"] == "Plan A is the best value."
    assert kwargs["model_used"]  # non-empty model string


@patch("healthflow.api.routes.decision_recorder")
@patch("healthflow.api.routes.ComparisonAgent")
def test_compare_decision_id_null_when_anonymous(mock_agent_cls, mock_recorder):
    mock_agent = MagicMock()
    mock_agent.recommend.return_value = "Plan A is the best value."
    mock_agent_cls.return_value = mock_agent
    # anonymous: real recorder returns None for broker_id None; emulate that
    mock_recorder.record_compare_decision.return_value = None

    resp = client.post("/compare", json=_BODY)  # no Authorization header

    assert resp.status_code == 200
    assert resp.json()["decision_id"] is None
    _, kwargs = mock_recorder.record_compare_decision.call_args
    assert kwargs["broker_id"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/test_compare_wiring.py -v`
Expected: FAIL — `decision_id` missing from the response (and `decision_recorder` not importable in routes).

- [ ] **Step 3: Add `decision_id` to `CompareResponse`**

In `healthflow/models/schemas.py`, in `class CompareResponse`, add the field (after `disclaimer`):
```python
    decision_id: str | None = None
```

- [ ] **Step 4: Wire the handler**

In `healthflow/api/routes.py`:

Add imports near the top (with the other imports):
```python
import time
from healthflow.agents.harness import CLAUDE_MODEL_HAIKU
from healthflow.auth.tenant_context import current_broker_id
from healthflow.decisions.recorder import decision_recorder
```

In `compare_plans`, replace the `agent.recommend(...)` call and the `return CompareResponse(...)` so the call is timed and a decision is recorded. The block currently reads:
```python
    agent = ComparisonAgent()
    raw_recommendation = agent.recommend(
        plans=ranked_plans,
        age=request.age,
        income_level=request.income_level,
        medications=request.medications or None,
        procedures=request.procedures or None,
    )

    recommendation = harness.filter_output(raw_recommendation)

    session_id = str(uuid.uuid4())
    session_store.save(session_id, {
        "zip_code": request.zip_code,
        "age": request.age,
        "income_level": request.income_level,
        "plan_ids": [p.plan_id for p in ranked_plans],
    })

    return CompareResponse(
        session_id=session_id,
        zip_code=request.zip_code,
        plans=ranked_plans,
        recommendation=recommendation,
        disclaimer=DISCLAIMER,
    )
```
Replace it with:
```python
    agent = ComparisonAgent()
    _t0 = time.monotonic()
    raw_recommendation = agent.recommend(
        plans=ranked_plans,
        age=request.age,
        income_level=request.income_level,
        medications=request.medications or None,
        procedures=request.procedures or None,
    )
    _elapsed_ms = int((time.monotonic() - _t0) * 1000)

    recommendation = harness.filter_output(raw_recommendation)

    session_id = str(uuid.uuid4())
    session_store.save(session_id, {
        "zip_code": request.zip_code,
        "age": request.age,
        "income_level": request.income_level,
        "plan_ids": [p.plan_id for p in ranked_plans],
    })

    # Capture a durable Decision Record for the broker who made this call.
    # Anonymous calls (no broker token) return None and get no record.
    decision_id = decision_recorder.record_compare_decision(
        broker_id=current_broker_id.get(),
        client_id=None,
        inputs={
            "zip_code": request.zip_code,
            "age": request.age,
            "income_level": request.income_level,
            "medications": request.medications or [],
            "procedures": request.procedures or [],
        },
        recommended_plan=ranked_plans[0].model_dump() if ranked_plans else {},
        alternatives=[p.model_dump() for p in ranked_plans[1:]],
        recommendation_text=recommendation,
        basis=f"Top-ranked of {len(ranked_plans)} plans compared for a "
              f"{request.income_level}-income profile",
        model_used=CLAUDE_MODEL_HAIKU,
        duration_ms=_elapsed_ms,
    )

    return CompareResponse(
        session_id=session_id,
        zip_code=request.zip_code,
        plans=ranked_plans,
        recommendation=recommendation,
        disclaimer=DISCLAIMER,
        decision_id=str(decision_id) if decision_id else None,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/test_compare_wiring.py -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add healthflow/models/schemas.py healthflow/api/routes.py healthflow/tests/decisions/test_compare_wiring.py
git commit -m "feat(decisions): capture a Decision Record on /compare, return decision_id"
```

---

### Task 7: Full-suite check + wire into make test

**Files:**
- Modify: `Makefile` (add `healthflow/tests/decisions/` to `test` and `test-quick`)

- [ ] **Step 1: Wire the new tests into the Makefile**

In `Makefile`, add `healthflow/tests/decisions/` to the pytest path list in BOTH the `test` and `test-quick` targets (they currently list `healthflow/tests/ healthflow/agents/temporal_awareness/tests/ healthflow/forensics/tests/`). Note: `healthflow/tests/decisions/` is under `healthflow/tests/`, so it's already collected by the `healthflow/tests/` entry — confirm by running the suite. (If `healthflow/tests/` is already in the list, no Makefile change is needed; verify in Step 2 and skip the edit.)

- [ ] **Step 2: Run the decisions suite**

Run: `.venv/bin/python -m pytest healthflow/tests/decisions/ -v`
Expected: all decisions tests PASS (model, shaper, recorder, routes, compare wiring).

- [ ] **Step 3: Run the full backend suite for regressions**

Run: `make test`
Expected: the full suite passes, including the decisions tests and the unchanged invocation-logger tests (Task 1's extraction).

- [ ] **Step 4: Commit (only if the Makefile changed)**

```bash
git add Makefile
git commit -m "chore(decisions): ensure decisions tests run in make test"
```
(If Step 1 found no change was needed, skip this commit.)
