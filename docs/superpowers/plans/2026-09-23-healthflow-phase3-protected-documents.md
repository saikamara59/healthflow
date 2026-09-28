# HealthFlow Phase 3: Protected Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver synthetic-only protected Documents that a Broker can link to multiple records for one Client, while preserving past work through Client and Document archive/restore.

**Architecture:** Extend the existing Broker-scoped SQLAlchemy model and FastAPI workspace routes; keep object bytes in a private S3-compatible store behind an adapter, with only metadata and Link history in the database. First make Client archival a working vertical slice, then build Document persistence, validation/storage, API, synthetic fixtures, and React views as reviewable slices. Public-demo upload is denied on the server independently of UI visibility.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy async, SQLite/PostgreSQL schema bridges, boto3/Tigris, React/Vite, pytest, Playwright. Pin `olefile==0.47`, `Pillow==12.3.0`, `pypdf==6.18.0`, and `python-multipart==0.0.32` in `requirements.txt` for structure checks and multipart parsing; retain existing boto3 dependency.

**Spec:** [Approved Phase 3 design](../specs/2026-09-23-healthflow-phase3-protected-documents-design.md); also read [ADR 0001](../../adr/0001-private-demo-document-storage.md), [ADR 0002](../../adr/0002-archive-clients-to-preserve-work.md), and [CONTEXT.md](../../../CONTEXT.md).

## Global Constraints

- First release is **synthetic-only**. Do not upload or seed real client files or PHI, and do not claim real-data readiness.
- Public Fly demo has `SEED_DEMO=1`; `DOCUMENT_UPLOAD_ENABLED` defaults false, and startup refuses both set to true.
- Public demo uses its own private Tigris bucket; private test uses a separate app, database, bucket, and secrets. No public/presigned object URLs or credentials reach the browser.
- Document belongs to exactly one Broker and Client. One object may have multiple independently historied Links to that Client's Enrollment, Issue, or Appeal.
- PDF, DOC, DOCX, JPG/JPEG, PNG only; configurable 20 MiB default; validate structure/content, not extension or browser MIME. No malware scan in this release.
- Ordinary archive never deletes file bytes or related work. Only a scoped, administrator-only synthetic-demo reset removes objects and metadata.
- Explicit audit is durable before any protected file bytes are served. Audit events contain no file bytes, sensitive filenames, keys, or credentials.
- Existing `/clients/{id}` DELETE remains a compatibility alias for archive. Cross-Broker and wrong-Client resource probes return 404.
- Use existing `Client`/`Document`/`Link` vocabulary from the approved domain docs. Preserve unrelated checkout changes; use only `saidus-phase3-branch` for this plan.

## Review Focus

1. A chunked upload whose final chunk crosses 20 MiB must be rejected without a stored object or visible Document (Task 4 test).
2. A valid Document linked to an Appeal whose Issue belongs to another Client or Broker must return 404 and leave no Link (Task 6 test).
3. A concurrent duplicate Link request must leave at most one active association, with a stable conflict response (Task 6 test).
4. An object missing after metadata exists must return a service error, never a zero-byte success, and leave an auditable failed open (Task 5 test).
5. An archived Client with an open Task and scheduled Appointment must remain visible on Today/Scheduling with an archived-Client marker (Tasks 1–2 tests).

---

## File structure and integration contract

| File | Responsibility |
| --- | --- |
| `healthflow/database/models.py` | `Client.archived_at`, `Document`, `DocumentLink`, `DocumentEvent`; typed FKs, constraints, active-Link uniqueness. |
| `healthflow/database/schema_migrations.py` | Idempotent `clients.archived_at` bridge for existing SQLite/PostgreSQL deployments; new tables come from `Base.metadata.create_all`. |
| `healthflow/database/tenant_filter.py`, `healthflow/database/phi_audit.py` | Register `Document`/`DocumentLink`; leave `DocumentEvent` as an explicit-write system audit table. |
| `healthflow/workspace/document_validation.py` | Bounded file stream and structure/type checks; normalized display filename. |
| `healthflow/workspace/document_storage.py` | `DocumentStorage` protocol, Tigris/S3 adapter, local-private and fake test adapters. No public URL API. |
| `healthflow/workspace/document_service.py` | Broker/Client/target checks, object/DB compensation, explicit event writes and file-open ordering. |
| `healthflow/api/documents_router.py` | Authenticated Document collection/content, Link/Unlink, archive/restore, and archived-list routes. |
| `healthflow/api/client_router.py`, `healthflow/workspace/linking.py`, `healthflow/workspace/dashboard_router.py` | Client archive API, new-work guard, and archived-Client indicators without hiding deadlines. |
| `healthflow/seed_data.py`, `seed.py`, `scripts/reset_demo_documents.py`, `demo_documents/` | Test reset order, idempotent checked-in synthetic fixtures, targeted administrator reset. |
| `frontend/src/api/client.js`, `frontend/src/components/DocumentList.jsx`, workspace pages and CSS | Authenticated FormData/blob requests and reusable Document UI; no upload action in demo mode. |
| `scripts/smoke_deployed_routes.sh`, backend tests, `frontend/tests/e2e/phase3-documents.spec.js` | Direct-route and boundary verification. |

Execution preflight: `git status --short --branch` must show `saidus-phase3-branch` with no unrelated edits. Install repo-local dependencies only when execution starts (`make install` when absent); never install global packages. Use `.venv/bin/python -m pytest healthflow/tests/ -q`, `make lint`, and `cd frontend && npm run build`. Each task below is a separate commit and review gate; do not push, provision a bucket, or deploy merely because local tasks pass.

### Task 1: Preserve Clients and linked work through archive/restore

**Files:** Modify `healthflow/database/models.py`, `healthflow/database/schema_migrations.py`, `healthflow/main.py`, `healthflow/models/schemas.py`, `healthflow/api/client_router.py`, `healthflow/workspace/linking.py`; test `healthflow/tests/api/test_clients.py`, `healthflow/tests/api/test_workspace_linking.py`, and create `healthflow/tests/database/test_schema_migrations.py`.

**Interfaces:** Produce `Client.archived_at: datetime | None`; `GET /clients?archived=false|true` (default false; `linkable=true` always active/owned); `POST /clients/{client_id}/archive` and `/restore` returning `ClientResponse`; keep `DELETE /clients/{client_id}` returning 204 but archiving only. `require_owned_links(..., client_id=...)` rejects archived Client for new work. Existing profile/history reads still allow archived Client.

- [ ] **Step 1: Write failing tests.** Replace the hard-delete assertion in `test_clients.py` with this behavior, and cover owned/cross-Broker restore and pre-existing Enrollment/Issue/Appeal/Task/Appointment IDs:

  ```python
  archived = await client.delete(f"/clients/{client_id}", headers=auth)
  assert archived.status_code == 204
  assert client_id not in {row["id"] for row in (await client.get("/clients", headers=auth)).json()}
  assert (await client.get("/clients?archived=true", headers=auth)).json()[0]["id"] == client_id
  assert (await client.get(f"/clients/{client_id}", headers=auth)).json()["archived_at"]
  assert (await client.post(f"/clients/{client_id}/restore", headers=auth)).status_code == 200
  assert (await client.get("/clients?linkable=true", headers=auth)).json()[0]["id"] == client_id
  ```

  Use the existing fixture/auth helpers for real linked rows; assert their IDs and FK values before/after archive. Add a bridge test that invokes `ensure_client_archive_column(connection)` twice against an old `clients` table and checks exactly one `archived_at` column. Assert `WorkspaceActivity(action='archived'|'restored', entity_type='client', details={'outcome': 'success'})` was committed for each transition, with no sensitive name in its summary/details.
- [ ] **Step 2: Run red.** ` .venv/bin/python -m pytest healthflow/tests/api/test_clients.py healthflow/tests/api/test_workspace_linking.py healthflow/tests/database/test_schema_migrations.py -q` should fail on missing archive behavior/column.
- [ ] **Step 3: Implement minimal API/schema change.** Add `mapped_column(DateTime(timezone=True), nullable=True)` and optional ISO `archived_at` response. Call `ensure_client_archive_column` in lifespan after `create_all`, using the existing SQLite/PostgreSQL bridge style. Replace the DELETE cascade body with `client.archived_at = _utcnow(); await db.flush()`; share an owned-Client lookup between archive/restore/DELETE, set `archived_at=None` on restore, and filter active/archived in list. Record `WorkspaceActivity` in the same transaction for archive/restore with IDs, action, outcome and no names. Do not detach or delete linked rows. In `require_owned_links`, treat an archived Client as not found for new associations. Check the admin read bypass separately; it must not become a write bypass.

  ```python
  @client_router.post("/{client_id}/archive", response_model=ClientResponse)
  async def archive_client(client_id: str, broker: Broker = Depends(get_current_broker),
                           db: AsyncSession = Depends(get_db)) -> ClientResponse:
      owned = await _owned_client(db, client_id)
      owned.archived_at = _utcnow()
      await db.flush()
      return _client_to_response(owned)
  ```

  The implementation may factor the lookup into `async def _owned_client(db: AsyncSession, client_id: str) -> Client`; use the same function for archive, restore, and DELETE, returning 404 for a different Broker.
- [ ] **Step 4: Run green.** Repeat the exact test command, then `.venv/bin/python -m pytest healthflow/tests/tenancy/ -q` and `make lint`; all must pass.
- [ ] **Step 5: Commit.** `git add healthflow/database/models.py healthflow/database/schema_migrations.py healthflow/main.py healthflow/models/schemas.py healthflow/api/client_router.py healthflow/workspace/linking.py healthflow/tests/api/test_clients.py healthflow/tests/api/test_workspace_linking.py healthflow/tests/database/test_schema_migrations.py && git commit -m "feat: archive clients without losing linked work"` (omit any path not created).

### Task 2: Make archived Clients visible as history, not new-work choices

**Files:** Modify `healthflow/workspace/dashboard_router.py`, response models in `healthflow/workspace/schemas.py`, `frontend/src/pages/ClientListPage.jsx`, `frontend/src/pages/ClientProfilePage.jsx`, `frontend/src/pages/TodayPage.jsx`, `frontend/src/pages/SchedulingPage.jsx`, `frontend/src/workspace.css`; test `healthflow/tests/api/test_workspace_dashboard.py`, `frontend/tests/e2e/phase3-documents.spec.js` (create).

**Interfaces:** Consume Task 1 `Client.archived_at` and archive routes. Produce `client_archived: bool` on Task/Appointment workspace DTOs, preserve their rows in Today/Scheduling, and explicit Archive/Restore Client controls. Client list can toggle Active/Archived; new-work selectors call active `GET /clients?linkable=true`.

- [ ] **Step 1: Write failing tests.** Backend test creates Client + open Task + scheduled Appointment, archives Client, then asserts the dashboard still contains both IDs with `client_archived is True`; after restore it is false. Playwright test logs in, archives a Client from profile, confirms it disappears from Active but appears under Archived, restores it, and checks the marker on Today/Scheduling while archived.

  ```javascript
  await page.getByRole('button', { name: 'Archive client' }).click()
  await expect(page.getByText('Archived client')).toBeVisible()
  await page.getByRole('link', { name: 'Archived clients' }).click()
  await expect(page.getByText('Eleanor Rigby')).toBeVisible()
  ```

- [ ] **Step 2: Run red.** `.venv/bin/python -m pytest healthflow/tests/api/test_workspace_dashboard.py -q` and `cd frontend && npm run test:e2e -- --grep "archived client"` should fail on missing marker/UI.
- [ ] **Step 3: Implement minimal vertical slice.** Join Client only to compute archived status; do not filter Tasks/Appointments. Add explicit confirmation copy explaining that related work remains. Use `api.post('/clients/<id>/archive')` and restore; remove any hard-delete copy. Add Active/Archived toggle to Client list; show archived profile as read-only for new-work actions. Update task/appointment rows to render `Archived client` when `client_archived` is true. Keep active Client choices on `?linkable=true`.

  ```jsx
  {item.client_archived && <span className="status-label">Archived client</span>}
  ```

- [ ] **Step 4: Run green.** Repeat the focused tests; run `cd frontend && npm run build`. Check a direct refresh of an archived Client profile in local browser smoke.
- [ ] **Step 5: Commit.** Stage only files named in this task and `git commit -m "feat: show archived client history and deadline markers"`.

### Task 3: Add Broker-owned Document metadata, Link history, and event persistence

**Files:** Modify `healthflow/database/models.py`, `healthflow/database/tenant_filter.py`, `healthflow/database/phi_audit.py`; create `healthflow/tests/database/test_documents.py`, extend `healthflow/tests/tenancy/test_tenant_filter.py` and PHI-audit tests.

**Interfaces:** Produce `Document(id, broker_id, client_id, display_filename, verified_type, byte_length, object_key, demo_fixture_marker, created_at, archived_at)`, `DocumentLink(id, broker_id, client_id, document_id, enrollment_id, issue_id, appeal_id, created_at, ended_at)`, `DocumentEvent(id, broker_id, document_id, client_id, actor_id, action, outcome, occurred_at)`; `DocumentLink` has exactly one non-null target. `demo_fixture_marker` is nullable and unique per Broker when present. `display_filename` uses `EncryptedString`, `object_key` is opaque/non-public. `DocumentEvent.document_id` is nullable and retained as an identifier rather than an FK so targeted demo reset does not erase audit history. `DocumentEvent` is explicit-write and not self-audited.

- [ ] **Step 1: Write failing DB tests.** Assert create/read with encrypted display filename in raw SQL, an invalid Link with two targets raises `IntegrityError`, duplicate active Link raises `IntegrityError`, ended Link permits re-link, tenant filter hides another Broker's Document/Link, and PHI audit logs metadata SELECT/INSERT. For example:

  ```python
  with pytest.raises(IntegrityError):
      session.add(DocumentLink(broker_id=broker.id, client_id=client.id,
          document_id=document.id, enrollment_id=enrollment.id, issue_id=issue.id))
      await session.flush()
  ```

  Use a fresh transaction after expected constraint failures. Assert each target column has an FK and `client_id`/`broker_id` are non-null.
- [ ] **Step 2: Run red.** `.venv/bin/python -m pytest healthflow/tests/database/test_documents.py healthflow/tests/tenancy/test_tenant_filter.py -q` fails on missing models.
- [ ] **Step 3: Implement models/registries.** Add `CheckConstraint` for exactly one target and three partial unique active-Link indexes (each unique on `document_id` plus its typed target ID, with `ended_at IS NULL`), portable on SQLite/PostgreSQL using `sqlite_where`/`postgresql_where`. Add a partial unique index on `(broker_id, demo_fixture_marker)` when marker is not null. Add `Document` and `DocumentLink` to both registries; add `DocumentEvent` to neither and write it only explicitly. Set non-null Broker and Client FKs on Document/Link. New tables are created by existing `Base.metadata.create_all`.

  ```python
  CheckConstraint(
      "(CASE WHEN enrollment_id IS NOT NULL THEN 1 ELSE 0 END + "
      "CASE WHEN issue_id IS NOT NULL THEN 1 ELSE 0 END + "
      "CASE WHEN appeal_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
      name="ck_document_link_one_target",
  )
  ```

- [ ] **Step 4: Run green.** Repeat DB/tenancy tests; run relevant PHI-audit tests and `make lint`. Confirm both SQLite and PostgreSQL index syntax before deployment (the local SQLite suite is not Postgres proof).
- [ ] **Step 5: Commit.** Stage model, registry, and test files only; `git commit -m "feat: persist protected document metadata and link history"`.

### Task 4: Bound and validate synthetic file uploads; isolate private storage

**Files:** Create `healthflow/workspace/document_validation.py`, `healthflow/workspace/document_storage.py`, `healthflow/tests/workspace/test_document_validation.py`, `healthflow/tests/workspace/test_document_storage.py`; modify `requirements.txt`.

**Interfaces:** Produce `async validate_upload(file: UploadFile, max_bytes: int = 20 * 1024 * 1024) -> ValidatedUpload` with `display_filename`, `verified_type`, `content_type`, `byte_length`, and a private seekable temporary stream. Produce `DocumentStorage.put(key: str, body: BinaryIO, content_type: str) -> None`, `get(key: str) -> BinaryIO`, `remove(key: str) -> None`; production adapter reads bucket/endpoint/credentials from environment, stores private objects only; local adapter path must not be beneath frontend/static webroot.

- [ ] **Step 1: Write failing table-driven tests.** Supply minimal valid PDF, Word OLE DOC, Word DOCX ZIP, JPEG, and PNG fixtures in `healthflow/tests/fixtures/documents/`; reject renamed ZIP, truncated signatures, a decompression-bomb image, DOCX ZIP traversal, missing Word parts, empty bytes, and final-chunk-over-limit. Assert no object key is derived from a filename with `../` or path separators.

  ```python
  @pytest.mark.parametrize("name,expected", [
      ("sample.pdf", "pdf"), ("sample.doc", "doc"),
      ("sample.docx", "docx"), ("sample.jpg", "jpeg"), ("sample.png", "png"),
  ])
  async def test_valid_fixture(name, expected):
      result = await validate_upload(upload_fixture(name))
      assert result.verified_type == expected
  ```

  Fake-storage tests assert `put/get/remove`, missing-key error, and no URL-generating method.
- [ ] **Step 2: Run red.** `.venv/bin/python -m pytest healthflow/tests/workspace/test_document_validation.py healthflow/tests/workspace/test_document_storage.py -q` fails on missing modules.
- [ ] **Step 3: Implement bounded validation and adapters.** Read in bounded chunks, abort at `max_bytes + 1`, close temporary streams on every error. Sanitize display filename (basename/control characters/length); never use it as key. Use pypdf to parse all pages and verify PDF structure, Pillow `Image.verify()` plus decompression-bomb handling, `olefile.isOleFile()` plus Word stream check, and bounded `zipfile` entry count/uncompressed size/path checks plus `[Content_Types].xml` and `word/document.xml` for DOCX. Add pinned libraries to repo requirements. `S3DocumentStorage` uses private `put_object/get_object/delete_object`, no ACL/public URL; `FakeDocumentStorage` keeps byte copies for tests. Return typed validation errors so API can map invalid type/size separately.

  ```python
  if total_bytes > max_bytes:
      raise DocumentTooLarge(max_bytes)
  if not verified_type:
      raise InvalidDocumentType()
  ```

- [ ] **Step 4: Run green.** Repeat focused tests, `make lint`; run at least one integration test against a local S3-compatible fake or botocore stub for private adapter arguments. Treat any required dependency installation as local to `.venv`.
- [ ] **Step 5: Commit.** Stage only validator/storage/dependency/fixture tests; `git commit -m "feat: validate document formats and store private objects"`.

### Task 5: Upload and open one protected Document with durable audit

**Files:** Create `healthflow/workspace/document_service.py`, `healthflow/api/documents_router.py`, `healthflow/tests/api/test_documents.py`; modify `healthflow/main.py`.

**Interfaces:** Produce `POST /clients/{client_id}/documents` (multipart `file`, 201), `GET /clients/{client_id}/documents` (active list), `GET /documents/archived` (owner's archived list), `GET /documents/capabilities` (`{upload_enabled: bool}`), `GET /documents/{document_id}/content` (authenticated streaming response). `DOCUMENT_UPLOAD_ENABLED=false` by default; `SEED_DEMO=1` plus enabled upload raises at app startup. `DocumentService.upload(db: AsyncSession, broker_id: UUID, client_id: UUID, file: UploadFile) -> Document` generates `uuid4` object key, validates active Client ownership, stores bytes, then commits metadata; `DocumentService.open(db: AsyncSession, broker_id: UUID, document_id: UUID) -> StreamingResponse` verifies ownership, commits `DocumentEvent(action='open', outcome='started')` before any bytes and records `completed` or `failed` outcome. All reads use current Broker context.

- [ ] **Step 1: Write failing API tests.** Direct multipart POST with default disabled yields 503 and zero objects; capability says false; forced demo/upload conflict fails startup. Enabled private-test capability says true, POST returns 201, one object, opaque key absent from JSON, encrypted filename at rest. A chunked multipart body with no `Content-Length` crossing file limit must be rejected before parser spooling grows unbounded; a false low `Content-Length` must not bypass the receive-stream cap. Open requires auth, returns expected bytes/headers, archived Document remains openable. Another Broker and nonexistent ID both return 404. Simulate storage PUT failure and DB commit failure: no visible Document, cleanup attempted; cleanup failure produces metadata-only operational error. Simulate audit commit failure: content is never read/served. Missing object: 503 rather than empty 200 and a failed-open event. A completed stream records `completed`; interrupted stream records `failed` but never `completed`.

  ```python
  response = await client.get(f"/documents/{document_id}/content", headers=owner_auth)
  assert response.status_code == 200
  assert response.headers["cache-control"] == "private, no-store"
  assert response.headers["x-content-type-options"] == "nosniff"
  assert "object_key" not in response.headers
  ```

- [ ] **Step 2: Run red.** `.venv/bin/python -m pytest healthflow/tests/api/test_documents.py -q` fails on missing routes.
- [ ] **Step 3: Implement service and routes.** Register router before SPA fallback. Derive configuration at startup, inject storage with a test override via `get_document_service()`, and check demo/upload conflict before accepting traffic. Return the server-derived capability. Add route-scoped ASGI request-size middleware for `POST /clients/{id}/documents`: cap actual receive bytes at configured file max plus 64 KiB multipart overhead regardless of `Content-Length`, and return 413 before parser spooling continues; Task 4 still enforces exact file-byte max. Stream upload through Task 4 validator. A successful PUT followed by DB failure calls `remove(key)` with a narrowly generated key, never bucket-wide delete. File open obtains a readable object handle or returns 503; it commits the `started` event before returning `StreamingResponse`, and aborts if audit commit fails. Wrap the iterator to close storage body and record separate `completed` or `failed` event using a fresh DB session after stream end, without claiming completion on interruption. Serve PDF/JPEG/PNG inline, DOC/DOCX as attachment with sanitized filename, `private, no-store`, and `nosniff`; no public URL.

  ```python
  @documents_router.get("/{document_id}/content")
  async def open_document(document_id: UUID, broker: Broker = Depends(get_current_broker),
                          db: AsyncSession = Depends(get_db)) -> StreamingResponse:
      return await get_document_service().open(db, broker.id, document_id)
  ```

- [ ] **Step 4: Run green.** Repeat focused tests plus `healthflow/tests/tenancy/`, `make lint`; verify authenticated direct API access with no UI. Inspect event rows for success/failure distinctions.
- [ ] **Step 5: Commit.** Stage service/router/main/test files only; `git commit -m "feat: upload and open broker-protected documents"`.

### Task 6: Link once, unlink historically, archive and restore without deleting bytes

**Files:** Modify `healthflow/workspace/document_service.py`, `healthflow/api/documents_router.py`; extend `healthflow/tests/api/test_documents.py`, `healthflow/tests/tenancy/test_cross_broker_writes.py`.

**Interfaces:** Produce `POST /documents/{id}/links` body `{target_type: 'enrollment'|'issue'|'appeal', target_id: UUID}`, `DELETE /documents/{id}/links/{link_id}` (end Link), `POST /documents/{id}/archive`, `POST /documents/{id}/restore`, `GET /documents/{id}/links?include_ended=true`; related-record collection `GET /documents?target_type=enrollment&target_id=<UUID>` (likewise issue/appeal) returns only active Links to active Documents. Upload API still creates only one object; Link API never calls storage PUT.

- [ ] **Step 1: Write failing tests.** Link one Document to Enrollment, Issue, Appeal for same Client and assert one object. Unlink Enrollment, verify ended timestamp/history and still-active Issue/Appeal. Re-link creates a new ID. Archive hides from Client and record active lists, retains object, appears in Archive; restore re-exposes only still-active Links. Wrong Client, other Broker, and Appeal whose Issue belongs elsewhere return 404. Two concurrent duplicate link attempts yield one 201 and one 409 with only one active Link (or one idempotent 200 if explicitly selected and documented before implementation). Audit every transition without sensitive payload.

  ```python
  assert len(fake_storage.objects) == 1
  assert {link["target_type"] for link in active_links} == {"issue", "appeal"}
  assert any(link["ended_at"] for link in full_history)
  ```

- [ ] **Step 2: Run red.** `.venv/bin/python -m pytest healthflow/tests/api/test_documents.py healthflow/tests/tenancy/test_cross_broker_writes.py -q` fails on missing Link/archive routes.
- [ ] **Step 3: Implement state transitions.** Resolve target by typed FK under Broker tenant filter; derive Appeal Client through Issue; require target Client equals Document Client. Reject archived Client for new Link. Let active uniqueness indexes catch races and translate only their known `IntegrityError` to 409. Set `ended_at` rather than DELETE, `archived_at` rather than object removal. Each mutation adds `DocumentEvent` in the same transaction; a failed audit write rolls the mutation back. Active lists require `Document.archived_at IS NULL` and `DocumentLink.ended_at IS NULL`; history view does not.

  ```python
  if target_client_id != document.client_id:
      raise HTTPException(status_code=404, detail="Document not found")
  link.ended_at = _utcnow()
  ```

- [ ] **Step 4: Run green.** Repeat focused tests, run complete backend suite with `make test`, and `make lint`. Count object PUT calls and ensure Link/Unlink/archive/restore do not add/remove objects.
- [ ] **Step 5: Commit.** Stage service/router/test files only; `git commit -m "feat: reuse documents with historied links and archive"`.

### Task 7: Seed disposable demo Documents and make reset exact-target only

**Files:** Create `demo_documents/README.md`, checked-in synthetic PDF/JPG/PNG fixtures, `healthflow/workspace/demo_documents.py`, `scripts/reset_demo_documents.py`, tests `healthflow/tests/workspace/test_demo_documents.py`; modify `seed.py`, `healthflow/seed_data.py`, `scripts/demo_entrypoint.sh`, `fly.toml`.

**Interfaces:** `seed_demo_documents(session, storage, broker_id) -> int` creates deterministic synthetic fixture records/objects only if fixture marker absent, and never revives archived records. `reset_demo_documents(session, storage, broker_id, fixture_ids) -> int` requires an explicit exact allowlist of seed markers and admin invocation; it deletes only matched demo metadata and object keys before reseeding. `SEED_DEMO=1` remains upload-disabled. `healthflow/seed_data.py` test-worker reset clears DocumentLink then Document then Client, in worker scope only.

- [ ] **Step 1: Write failing tests.** Run seed twice: same Document IDs/object count; archive a fixture then seed again: remains archived. Reset a named fixture: only that fixture's object/metadata removed, unrelated uploaded object untouched. Non-admin reset fails; missing/broad wildcard IDs fail. Test-worker reset deletes only its own Document Links/Documents before Clients, without touching another Broker's objects.

  ```python
  first = await seed_demo_documents(session, fake_storage, demo_broker_id)
  second = await seed_demo_documents(session, fake_storage, demo_broker_id)
  assert first > 0 and second == 0
  assert len(fake_storage.objects) == first
  ```

- [ ] **Step 2: Run red.** `.venv/bin/python -m pytest healthflow/tests/workspace/test_demo_documents.py healthflow/tests/data/test_seed_data.py -q` fails on missing seeder/reset handling.
- [ ] **Step 3: Implement exact-fixture seed/reset.** Keep fixtures clearly labeled invented people/content. Store a stable, non-user-supplied fixture marker; never infer reset keys from a filename or list/delete a whole bucket. Invoke seeding only in demo entrypoint after app readiness. Make entrypoint fail if document seeding fails, rather than masking it behind the existing `seed.py || echo ...` catch. Admin script prints target IDs/count, requires explicit confirmation flag and admin authentication/context, then removes only selected fixture rows/objects; retain an audit event for reset. Do not provision real bucket or commit secrets. Configure bucket name/endpoint as environment/secrets in deployment docs.

  ```python
  if requested_marker not in DEMO_FIXTURE_MARKERS:
      raise ValueError("Unknown demo fixture")
  ```

- [ ] **Step 4: Run green.** Repeat focused tests, run `make test`, and dry-run seeding/reset against a local fake/private store; verify no real data or object keys appear in logs. Do not execute destructive reset against production demo during development.
- [ ] **Step 5: Commit.** Stage fixture/seeder/reset/config/test files only; `git commit -m "feat: seed and narrowly reset synthetic demo documents"`.

### Task 8: Add authenticated Document UI and direct-route browser coverage

**Files:** Modify `frontend/src/api/client.js`, `frontend/src/App.jsx`, `frontend/src/components/Sidebar.jsx`, `frontend/src/pages/ClientProfilePage.jsx`, `frontend/src/pages/EnrollmentsPage.jsx`, `frontend/src/pages/IssuesPage.jsx`, `frontend/src/pages/ClaimsAppealPage.jsx`, `frontend/src/workspace.css`, `scripts/smoke_deployed_routes.sh`; create `frontend/src/components/DocumentList.jsx`, `frontend/src/pages/DocumentArchivePage.jsx`, `frontend/tests/e2e/phase3-documents.spec.js`.

**Interfaces:** `api.uploadDocument(clientId, file)` sends FormData without JSON Content-Type; `api.openDocument(documentId)` fetches authenticated Blob and refreshes token through existing logic; `DocumentList({ clientId, targetType, targetId, archived })` renders the same owned Document/Link actions on Client/Enrollment/Issue/Appeal surfaces. New route `/documents/archive` supports direct refresh. Public-demo UI has no upload control; private-test UI shows upload only when a server-fetched capability says enabled, never from an untrusted local toggle.

- [ ] **Step 1: Write failing Playwright tests.** In public-demo mode, inspect Client Documents panel and direct POST: panel shows seeded synthetic Documents, no Upload button, POST is rejected. In private-test mode, upload synthetic PDF, link to Enrollment and Issue, open with authenticated request, unlink one, archive/restore, verify one still-active association and Archive route after direct navigation/refresh. Check Word uses download, PDF inline, and wrong-Broker view is absent.

  ```javascript
  await page.goto('/documents/archive')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Document archive' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload document' })).toHaveCount(0)
  ```

- [ ] **Step 2: Run red.** `cd frontend && npm run test:e2e -- --grep "Phase 3 documents"` fails on missing UI/route.
- [ ] **Step 3: Implement UI/request helper.** Share token refresh with JSON requests; for FormData omit `Content-Type`, for Blob do not JSON-parse response. Revoke temporary object URLs after use. Display safe filename/type/size, links, archive/restore, explicit Unlink (not delete). Show archived Client indicator and prohibit new upload/link on archived Client. Add `/documents/archive` to router/sidebar and smoke script. Treat backend capability as authoritative; upload-disabled errors are still handled visibly.

  ```javascript
  const form = new FormData()
  form.append('file', file)
  // The browser sets the multipart boundary; do not set Content-Type here.
  ```

- [ ] **Step 4: Run green.** Repeat focused Playwright tests, `cd frontend && npm run build`, then `make test` and `make lint`. Open `/documents/archive`, a Client, Enrollment, Issue, and Appeal directly in a local browser and refresh each. The deployed-route script must include `/documents/archive` as an unauthenticated SPA route check.
- [ ] **Step 5: Commit.** Stage only frontend/smoke/test files and `git commit -m "feat: show protected documents and archive in workspace"`.

### Task 9: Verify synthetic-demo release boundary without claiming deployment

**Files:** Create `docs/runbooks/phase3-synthetic-documents.md`; modify tests/config only to correct failures found by checks.

**Interfaces:** A release checklist records local evidence, private bucket provision/secret checks, public-demo upload denial, targeted reset proof, direct-route checks, and explicit real-data exclusions. No deployment is authorized by this plan alone.

- [ ] **Step 1: Write the failing boundary check.** Add a test or script assertion that startup with `SEED_DEMO=1 DOCUMENT_UPLOAD_ENABLED=true` fails, and one that POST is denied with default config even if UI is bypassed. Run those tests; expected red if Task 5 left a gap.
- [ ] **Step 2: Run complete local verification.** `make lint`, `make test`, `cd frontend && npm run build`, and focused Playwright Phase 3 suite. Record exact pass/fail counts and skipped tests in the runbook; do not call skipped database tests proof.
- [ ] **Step 3: Document release operations.** Include commands/checks for private Tigris bucket creation and access policy, demo-only credentials, environment `DOCUMENT_UPLOAD_ENABLED=false`, seed/reseed, admin reset dry-run, object access denial without app auth, API 404/503 probes, and rollback. The runbook explicitly says no bucket is provisioned and no deploy is done until authorized and verified.
- [ ] **Step 4: Review branch diff.** `git diff origin/main...HEAD --check`, inspect every changed file for secrets/real PHI, run full tests again if fixes were made, and ask for independent code review before PR. Do not treat review, merge, CI, deployment, and live-browser proof as interchangeable.
- [ ] **Step 5: Commit.** Stage only runbook or test fixes and `git commit -m "docs: record synthetic document release gates"`.

## Execution and handoff

Tasks 1–2 form a working Client-history slice; Tasks 3–6 form a working private Document API; Tasks 7–8 make the synthetic demo and UI usable; Task 9 records the release gate. Each slice can be reviewed and, if desired, proposed in a smaller PR without promising that all of OVE-139 is complete. Keep the Linear ticket open until accepted delivery; if a distinct reproducible defect appears, record evidence and check duplicates before filing it in the requested tracker. After plan approval, choose the execution approach before product-code changes.
