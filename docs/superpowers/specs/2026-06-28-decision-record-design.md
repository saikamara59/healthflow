# Decision Record (compare agent) — design

**Date:** 2026-06-28
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/decision-record`

## Problem

HealthFlow's landing promise is "coverage advice you can defend." For a plan
comparison, that defense doesn't exist as an artifact today: the recommendation
text and the ranked plans are returned to the client and then **dropped**. The
`/compare` handler saves only `{zip, age, income, plan_ids}` to an in-memory,
ephemeral `session_store`; it does not write `ActionHistory`; and the
`agent_invocation_log` row holds only a summary (`{"length", "plans"}`) keyed by
`case_id`, not by the `session_id` the recommendation returns. So a broker cannot
later answer "why did we recommend this plan?" with anything concrete.

This is the second slice of the trust layer (the first is the translate accuracy
benchmark). It makes a single recommendation **defensible**: a durable,
attributable record of what produced it, readable by the broker who made it.

## Goal

When an authenticated broker runs a plan comparison, persist one durable
**Decision Record** — the client inputs, the recommended plan, the alternatives
it was ranked against, the agent/model/timing, and broker attribution — and
return its id with the recommendation. Expose a tenant-scoped
`GET /decisions/{decision_id}` that reads it back, shaped for broker/client
consumption.

## Why capture, not assemble

The audience choice (broker-facing) and the data reality (compare persists
almost nothing durable) force a **capture-at-decision-time** approach rather than
assembling from existing logs:

- `session_store` is `InMemoryStore` — ephemeral, minimal, lost on restart.
- `/compare` does not write `ActionHistory`.
- `agent_invocation_log` is summary-only and keyed by `case_id`, which is not the
  `session_id` returned to the client.

Capturing one purpose-built row is both more reliable (no fragile ±2s joins
across three unlinked, partly-encrypted, partly-ephemeral sources) and less work.
The minted `decision_id` is the single anchor.

## Non-goals (explicit out-of-scope for v1)

- **Frontend "Why this?" UI.** v1 delivers the record + API the UI will render;
  the panel is the immediate follow-up.
- **Other agents** (calculate / translate / appeal / verify). The table carries
  `agent_type` so they slot in later, but only compare captures in v1.
- **Data-version stamps and reasoning trace.** Which formulary/plan-data version
  the agent used, and any step-by-step reasoning, are not captured (the same gaps
  the forensics module has). v1 records what `/compare` already has in hand.
- **Hash-chain / tamper evidence.** Out of scope here (a forensics follow-up).
- **Making `decision_id` the feedback `output_id`.** Cheap and high-value (it
  would tie RLHF feedback to the actual decision), but a separate change.
- **PHI-audit logging of decision reads.** Worth considering later; not v1.

## The compare flow today (what we build on)

`healthflow/api/routes.py` `compare_plans` (a **synchronous** handler):
fetch plans → `parser.parse_and_rank` → per-plan cost estimation →
`ComparisonAgent().recommend(...)` → `harness.filter_output(...)` →
mint `session_id` → save a slice to `session_store` → return `CompareResponse`.

Two facts shape the design:
1. **`/compare` is unauthenticated.** `OptionalBrokerContextMiddleware` sets
   `current_broker_id` only when a valid token is present, else `None`. Decision
   Records are therefore captured **only when a broker is logged in**; anonymous
   (demo) compares get none. This is correct — it is inherently a broker feature.
2. **The handler is synchronous**, but the app DB is async. The existing
   `invocation()` logger (`healthflow/logs/invocation.py`) already writes a row
   from this sync path via a **parallel sync SQLAlchemy engine**, failure-safe.
   The Decision Record capture mirrors that exact pattern.

## Architecture

```
healthflow/
  database/models.py            # + DecisionRecord (decision_records table)
  decisions/
    __init__.py
    recorder.py                 # DecisionRecorder — sync, failure-safe write
    shaper.py                   # row -> DecisionRecordResponse (pure)
    router.py                   # GET /decisions/{decision_id}
  logs/_sync_engine.py          # extracted shared _sync_url helper (DRY)
  models/schemas.py             # + DecisionRecordResponse; CompareResponse.decision_id
  api/routes.py                 # /compare calls the recorder, returns decision_id
  main.py                       # mount decisions_router
  tests/decisions/              # unit + API tests
```

## Components

### Data model — `DecisionRecord` (`decision_records`)

```python
class DecisionRecord(Base):
    __tablename__ = "decision_records"
    id: Mapped[uuid.UUID]          # PK, default uuid4 — the decision_id
    broker_id: Mapped[uuid.UUID]   # indexed, NOT NULL — attribution + tenant scope
    client_id: Mapped[uuid.UUID | None]   # null for compare; nullable for future agents
    agent_type: Mapped[str]        # String(50), "compare"
    model_used: Mapped[str | None] # String(50)
    duration_ms: Mapped[int | None]
    content: Mapped[dict]          # EncryptedJSON — PHI-bearing payload (below)
    created_at: Mapped[datetime]   # tz-aware, indexed, default utcnow
```

`content` shape (one encrypted blob — one decrypt on read, simple migration):
```json
{
  "inputs": {"zip_code": "10025", "age": 67, "income_level": "medium",
             "medications": ["metformin"], "procedures": []},
  "recommended_plan": {"plan_id": "...", "plan_name": "Aetna Prime",
                       "monthly_premium": 0.0, "annual_deductible": 0.0,
                       "out_of_pocket_max": 4150.0, "star_rating": 4.5},
  "recommendation_text": "<the agent's plain-English recommendation>",
  "alternatives": [{"plan_id": "...", "plan_name": "...", "est_annual_cost": 1864.0}, ...],
  "basis": "Ranked 8 plans by estimated annual cost"
}
```

`content` is `EncryptedJSON` because it carries medications and a recommendation
that reflects the client's situation (PHI-adjacent), consistent with
`ActionHistory.request_data`/`response_summary`. Metadata columns are plaintext.

`DecisionRecord` **must be registered with the tenant filter** — the same
`do_orm_execute` mechanism that auto-scopes `Client`/`ActionHistory`/`Feedback`
by `broker_id`. This is what makes the `GET` tenancy-safe (broker B's query for
broker A's id simply finds nothing) without a manual `WHERE broker_id` in the
route. The capture write sets `broker_id` explicitly and runs on the sync engine,
outside that async hook — which is fine (we are not querying, we are inserting a
row whose `broker_id` we control).

### Shared sync-engine helper — `healthflow/logs/_sync_engine.py`

Extract `_sync_url(async_url)` (currently private in `invocation.py`) into a small
shared module; `invocation.py` and `recorder.py` both import it. No behavior
change to invocation logging — pure DRY extraction.

### Capture — `DecisionRecorder` (`healthflow/decisions/recorder.py`)

Modeled on `InvocationLogger`: a process-wide instance, a lazily-created sync
engine (sync URL via the shared helper), failure-safe.

```python
def record_compare_decision(
    self, *, broker_id: uuid.UUID | None, client_id: uuid.UUID | None,
    inputs: dict, recommended_plan: dict, alternatives: list[dict],
    recommendation_text: str, basis: str,
    model_used: str | None, duration_ms: int | None,
) -> uuid.UUID | None:
    """Persist one decision_records row. Returns the decision_id, or None when
    broker_id is None (anonymous compare) or the write fails (logged, never
    raised — capture must not block the recommendation)."""
```

- `broker_id is None` → return `None` immediately (no capture).
- Build `content` from the structured args; insert one row via a sync `Session`
  on the sync engine, inside try/finally (no leaked connections).
- On any exception: forward to `AuditLogger` text log and return `None`. The
  recommendation is never blocked.

The `EncryptedJSON` `TypeDecorator` encrypts on bind regardless of sync/async, so
writing via the sync session still encrypts `content` correctly.

### Response shaper — `healthflow/decisions/shaper.py`

Pure function, no I/O: `to_response(record: DecisionRecord) -> DecisionRecordResponse`.
Maps the decrypted row to the broker-facing schema. Kept separate from the router
so it is unit-testable without HTTP or a DB.

### Read API — `healthflow/decisions/router.py`

```python
@decisions_router.get("/decisions/{decision_id}", response_model=DecisionRecordResponse)
async def get_decision(decision_id: uuid.UUID,
                       broker: Broker = Depends(get_current_broker),
                       db: AsyncSession = Depends(get_db)):
    ...
```

- Async, `Depends(get_current_broker)` (401 without a valid token).
- `SELECT … WHERE id = :decision_id` — the `do_orm_execute` tenant hook injects
  `broker_id = current_broker_id`, so another broker's record simply isn't found.
- Not found → 404. Found → decrypt (automatic via the column type) → `to_response`.

### Schemas (`healthflow/models/schemas.py`)

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

# CompareResponse gains:
    decision_id: str | None = None
```

### Wiring `/compare`

After `recommendation = harness.filter_output(raw_recommendation)`, time the
`recommend` call (or read the model constant) and call the recorder:

```python
decision_id = decision_recorder.record_compare_decision(
    broker_id=current_broker_id.get(),
    client_id=None,
    inputs={"zip_code": request.zip_code, "age": request.age,
            "income_level": request.income_level,
            "medications": request.medications, "procedures": request.procedures},
    recommended_plan=<the top-ranked plan as dict>,
    alternatives=[<each ranked plan: id, name, est annual cost>],
    recommendation_text=recommendation,
    basis=f"Ranked {len(ranked_plans)} plans by estimated annual cost",
    model_used=ComparisonAgent's model,
    duration_ms=<measured around recommend()>,
)
return CompareResponse(..., decision_id=str(decision_id) if decision_id else None)
```

## Data flow

```
POST /compare (broker token optional)
  rank + estimate + ComparisonAgent.recommend  ->  recommendation
  record_compare_decision(broker_id=current_broker_id.get(), ...)
        |  broker present  -> insert decision_records row (sync, encrypted) -> decision_id
        |  broker None      -> None (no capture)
  CompareResponse(..., decision_id)

GET /decisions/{id} (broker token required)
  tenant-scoped SELECT (auto broker_id filter) -> row | 404
  decrypt content -> shaper.to_response -> DecisionRecordResponse
```

## Error handling

- **Capture failure** (DB down, encode error): swallowed, forwarded to the text
  `AuditLogger`, `decision_id` omitted from the response. The recommendation is
  unaffected. (A missing record is a visible gap, not a broken request — the
  honest tradeoff; capture must never block advice.)
- **Anonymous compare** (`broker_id` None): no capture, `decision_id` is `None`.
- **Read, not found / not owned:** 404 (tenant filter makes "not owned" and "not
  found" indistinguishable, which is the desired non-leaky behavior).
- **Read, no auth:** 401 from `get_current_broker`.
- **Decryption failure:** `PhiDecryptionError` surfaces as the existing safe 500.

## Testing strategy

- **Unit (no DB, no HTTP):**
  - `recorder.record_compare_decision` returns `None` when `broker_id is None`
    (verified without touching the engine).
  - `shaper.to_response` maps a constructed `DecisionRecord` to the correct
    `DecisionRecordResponse` (all fields, decrypted content shape).
- **DB/API (in-memory SQLite, the existing `client`/`db_session` fixtures):**
  - `record_compare_decision` with a broker writes a row whose `content` round-trips
    (decrypts to the same structure).
  - `POST /compare` as an authed broker returns a non-null `decision_id`; as an
    anonymous request returns `decision_id` null/omitted.
  - `GET /decisions/{id}` returns the record for its owner.
  - **Tenancy:** broker B `GET`-ing broker A's `decision_id` gets 404.
  - Unknown id → 404; no auth → 401.

This mirrors the repo's split: pure logic unit-tested; tenancy/auth/encryption
exercised through the real fixtures.

## Follow-ups (post-v1)

1. Frontend "Why this?" panel on the comparison result, reading `GET /decisions/{id}`.
2. Capture for the other agents (calculate/translate/appeal/verify).
3. Use `decision_id` as the feedback `output_id` so RLHF feedback ties to the
   actual decision (closes the loose coupling noted in the RLHF work).
4. Data-version stamps + reasoning trace; PHI-audit logging of decision reads;
   the hash-chain/tamper-evidence forensics follow-up.
5. Cite the translate/agent accuracy benchmark in the record (links trust-layer
   #1 and #2).
