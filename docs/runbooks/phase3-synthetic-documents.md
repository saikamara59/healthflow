# Synthetic Document release gates

This branch is synthetic-only. No bucket has been provisioned and no deployment has been performed by this task. Release requires separate authorization and verified evidence below. Real Client files are excluded from this public sandbox and from the private test environment; format validation is not malware scanning or detection of real health information. Real-data use requires a separate application, database, bucket, credentials, provider-agreement review, retention, backups, recovery and security review.

## Local verification

Final commands and results are recorded below. Existing `test_default_upload_disabled` directly POSTs with default settings and expects 503; `test_demo_upload_conflict_fails_startup` exercises `SEED_DEMO=1 DOCUMENT_UPLOAD_ENABLED=true` and expects startup rejection. These already implemented boundary assertions were verified rather than duplicated. A green test is regression evidence, not an invented RED result.

- `make lint`: passed, all checks passed.
- `make test`: 830 passed, 3 skipped, 1 warning in 266.91 seconds after the fixture correction. The three skipped opt-in live-provider cases are RxNav metformin search and NPPES NPI/name lookups. Passlib emits a crypt deprecation warning; this suite is local SQLite evidence, not PostgreSQL or live-provider proof.
- `cd frontend && npm run build`: passed; Vite reports a bundle over 500 kB.
- `cd frontend && npx playwright test --config=node_modules/.phase3-playwright.config.mjs`: 7 passed, 1 skipped (19.1 seconds); isolated backend 18000 and frontend 15173. The public-demo test is skipped because this server enables trusted synthetic uploads. Browser output includes Node color-environment warnings.

Initial unprivileged test/build attempts failed on sandbox write permissions; the reruns use authorized access to this worktree. Skipped database/live-provider tests are not proof of PostgreSQL or external-provider behavior. Task 8's public-mode browser evidence is prior evidence, distinct from the current private-test browser run. The unrelated preference persistence race reported as GH87 is not a Document release gate result.

The first complete suite reported 829 passed, 1 failed, 3 skipped in 260.64 seconds. The DOCX round-trip test regenerated a ZIP fixture across its two-second wall-clock timestamp boundary, causing a byte comparison mismatch at header index 10; the controller recorded this duplicate-checked defect as [GH88](https://github.com/saikamara59/healthflow/issues/88). Fixture generation now fixes each ZIP entry timestamp to 1980-01-01 and retains DEFLATE compression. The focused reproduction before the correction passed 7 cases (35 deselected), confirming why that intermittent test result was insufficient on its own. The final full rerun is recorded above when complete.

## Authorized provisioning and configuration

Only after authorization, create a dedicated private Tigris bucket for this synthetic demo using the provider console or the current Fly CLI (`fly storage create --help` first, then `fly storage create --app healthflow-demo`). Verify the selected bucket is private, has no public-read policy, and has no anonymous access. Record bucket identity and access-policy verification outside public output; do not paste credentials or object keys into tickets, logs or this file. Do not reuse any real-data bucket. Use dedicated demo-only credentials restricted to that bucket and a separate database/bucket/credentials set for trusted synthetic upload testing.

Configure `DOCUMENT_STORAGE_BUCKET`, `DOCUMENT_STORAGE_ENDPOINT` (HTTPS), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` (normally `auto`) with the deployment secret manager. Check secret names with `fly secrets list --app healthflow-demo`, never print values. Provisioning tools may attach differently named secrets: explicitly map them to the names the storage adapter consumes. Preserve `SEED_DEMO=1` and `DOCUMENT_UPLOAD_ENABLED=false` (the checked-in Fly value `0` is equivalent). Confirm startup rejects enabled uploads alongside demo seeding in the actual deployment configuration. No administrator is automatically created; use a separately authorized administrator account and deployment-specific password.

Official operator references checked for this runbook: [Fly storage create](https://fly.io/docs/flyctl/storage-create/) documents the app/name flags and public-access opt-in; never pass `--public`. [Fly storage update](https://fly.io/docs/flyctl/storage-update/) documents `fly storage update '<exact-demo-bucket>' --private --app healthflow-demo` when an authorized operator must correct public access. Independently verify the resulting access setting in the [Tigris dashboard](https://fly.io/docs/flyctl/storage-dashboard/) and with unsigned probes. [Fly object storage configuration](https://fly.io/docs/js/the-basics/object-storage/) lists provisioned `BUCKET_NAME` and `AWS_ENDPOINT_URL_S3`; map these explicitly to `DOCUMENT_STORAGE_BUCKET` and `DOCUMENT_STORAGE_ENDPOINT` rather than assuming the app reads the provisioner's aliases.

## Seed, reset and storage proof

In the configured synthetic environment run `.venv/bin/python seed.py`. Repeat once and verify identical fixture counts and object identities, with no revival of archived Documents or Clients. Inspect only metadata and fixture markers. The entrypoint also seeds after readiness and fails boot if seeding fails.

Preview a single known fixture with:

```sh
SEED_DEMO=1 .venv/bin/python -m scripts.reset_demo_documents \
  --admin-email '<authorized-admin-email>' --fixture synthetic-summary-v1
```

The password is prompted, and without `--confirm` this is a dry-run. Record matched Document IDs and exact cleanup-record counts privately. Verify only the intended synthetic fixture is matched. After explicit reset authorization repeat that exact command with `--confirm`, then prove the fixture is reseeded, other fixture IDs/objects remain intact, and unrelated/non-demo objects remain intact. Never clear a bucket or prefix. Local fake-storage reset tests do not establish Tigris reset behavior.

For an exact synthetic object URL supplied privately by the operator, make an unsigned GET and verify denial (403 or concealed 404), without app authentication or signed query parameters. Repeat for anonymous bucket listing. Authenticated app content access must succeed for its Broker with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`; no public or presigned storage URL may appear in app responses. Record durable open-attempt/outcome events without filenames or bytes. Audit failure must deny bytes. Probe missing storage objects and a controlled unavailable-store condition only in the isolated synthetic test environment and expect 503 with no public fallback.

## API and browser gates after authorized release

Use synthetic IDs and a privately supplied Broker session. Directly POST a valid invented fixture to `/clients/{client_id}/documents` and verify 503 with public-demo settings, even when bypassing the UI. Check `/documents/capabilities` returns `upload_enabled: false`. A valid different-Broker session requesting `/documents/{document_id}/content` must receive the same 404 as a nonexistent ID; no session must receive 401. Check invalid same-Client associations are denied and successful Link/Unlink does not duplicate or destroy bytes.

Run `HEALTHFLOW_BASE_URL='<authorized-environment-url>' bash scripts/smoke_deployed_routes.sh`, then independently sign in, directly navigate and refresh a Client profile and `/documents/archive`, and open a synthetic Document. Verify archive/restore and related Enrollment, Issue and Appeal Links, archived Client indicators, and absence of public upload controls. Check JSON API responses separately from SPA HTML; `/health` alone is not route or storage proof.

## Review, rollback and evidence boundaries

Before a PR run `git diff origin/main...HEAD --check`, inspect every changed file for credentials and real information, and request independent code review. The narrow `demo_documents/*.pdf binary` attribute preserves PDF cross-reference entry whitespace; it does not suppress checks for unrelated PDFs. Track local checks, independent review, PR/merge, post-merge CI, deployment revision, provider checks and live browser proof as separate evidence. Keep OVE-139 open until accepted delivery. This task authorizes no push, deployment or provisioning.

If the authorized release fails, stop public traffic to the failing revision and return to the last verified application release using the normal deployment rollback procedure after checking database compatibility. Never roll back by deleting Client history or clearing storage. Keep upload disabled throughout. Preserve database/audit evidence and exact cleanup intents; recover synthetic fixture objects through the targeted reset/reseed procedure after diagnosis. A previous release without these routes is not proof that the new routes work.
