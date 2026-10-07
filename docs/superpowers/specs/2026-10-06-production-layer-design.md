# Production Layer

## Purpose and release boundary

HealthFlow today runs as one public environment, the Demo, holding invented information. This design adds everything needed for real Brokers to work with real Client PHI: a Production environment, a Staging environment to rehearse in, the release pipeline between them, the operational practices that keep Production safe, and the product changes real data requires.

Real Client information enters Production only when every item on the launch checklist at the end of this document is met. Until then Production exists but holds nothing real.

Launch users are one to three Design Partners: Brokers invited personally, each with a signed Business Associate Agreement (BAA) before their account exists. Three Brokers with a few hundred Clients each is the scale to design for.

Out of scope: public sign-up in Production, single sign-on, a contractual uptime guarantee, a second region, a formal certification such as SOC 2, a compliance automation platform, and multi-Broker agencies under one contract. Each is a later decision.

Governing decisions: [ADR 0006](../../adr/0006-production-on-fly-with-aws-for-documents-and-email.md) (hosting), [ADR 0007](../../adr/0007-postgres-is-the-only-engine-for-broker-data.md) (Postgres only), [ADR 0008](../../adr/0008-real-phi-never-leaves-production.md) (PHI boundary), [ADR 0009](../../adr/0009-request-state-lives-in-postgres-not-redis.md) (request state), [ADR 0010](../../adr/0010-offboarding-deletes-records-and-lets-backups-age-out.md) (Offboarding), and [ADR 0004](../../adr/0004-ask-healthflow-uses-client-pseudonyms.md) as updated (BAA with Anthropic). Terms follow `CONTEXT.md`.

## Starting point

Facts about the repository when this design was written:

- One Fly app, `healthflow-demo`, on a single 512 MB machine with SQLite on a volume.
- `fly-deploy.yml` deploys every push to `main` and does not wait for `ci.yml` or `e2e.yml`.
- `main` has no branch protection; the repository is private on GitHub's free plan, which does not offer it.
- Tables are created by `create_all` at startup, followed by three `ensure_*` functions in `schema_migrations.py`. Nothing records which changes a database has received.
- No Postgres driver is installed, and every test runs on in-memory SQLite.
- Session data lives in an in-process `InMemoryStore`; the request limiter is in-process; a backfill task starts inside the web process.
- Logfire receives allowlisted agent invocation metadata only. Nothing traces web requests, collects exceptions, or alerts.
- There is no dependency, secret, or image scanning.
- Already in place: PHI column encryption with key versions, the PHI access audit log, tenant isolation, auth hardening (password rules, lockout, refresh tokens), and the forensics replay tool.

## Environments

| | Demo | Staging | Production |
|---|---|---|---|
| Who can reach it | Anyone | The operator | Design Partners |
| Information | Invented | Invented | Real PHI |
| Sign-up | Open, demo Broker seeded | Invitation only | Invitation only |
| Document uploads | Off | On | On |
| Email | Logged, not sent | SES | SES |
| Two-factor sign-in for Brokers | Off | Required | Required |
| Document store | Tigris | AWS S3 | AWS S3 |
| Machines | One | One, may stop when idle | Two |

Staging is configured the same way as Production in every respect that affects behaviour, so that a release verified on Staging has exercised the paths that carry PHI.

Each environment has its own Fly app, database, bucket, deploy token, `JWT_SECRET`, `PHI_ENCRYPTION_KEY`, and AWS credentials. Nothing is shared. Real PHI never leaves Production ([ADR 0008](../../adr/0008-real-phi-never-leaves-production.md)).

Staging needs an invented data set large enough to rehearse migrations against realistic volumes.

## Hosting and vendors

Production and Staging run on Fly with Fly Managed Postgres; Documents use AWS S3 and email uses AWS SES ([ADR 0006](../../adr/0006-production-on-fly-with-aws-for-documents-and-email.md)).

Every vendor that can receive PHI from Production needs a signed BAA:

| Vendor | Receives | BAA |
|---|---|---|
| Fly | Application machines, database | Pre-signed, inside a paid Compliance Package |
| AWS | Documents, email, off-platform backups | Standard AWS BAA |
| Anthropic | Agent prompts | Through sales; tied to a zero-data-retention agreement |
| Logfire | Telemetry | Available on the Growth and enterprise plans |

Telemetry is designed to contain no PHI, so the Logfire BAA is a safety net for mistakes.

## Database and schema changes

Broker data runs on Postgres in every environment, CI, and local development ([ADR 0007](../../adr/0007-postgres-is-the-only-engine-for-broker-data.md)). The dialect branches for SQLite are removed. The read-only plan and drug catalog stays SQLite.

Schema changes use Alembic:

- Today's schema is captured as the first migration. Existing databases are marked as already at that point.
- Migrations run once per deploy as a release step, before new code starts. A failed migration stops the deploy and leaves the previous version running.
- The application no longer changes the schema at startup. `create_all` and the `ensure_*` functions are retired.
- Every migration must work while the previous version of the code is still running. Additions ship in one release and removals in a later one; a rename is add, copy, then drop across releases.

The Demo's existing SQLite data is invented, so the Demo is reseeded on Postgres instead of migrated.

## Runtime shape

Production runs two machines, and no state lives inside one process ([ADR 0009](../../adr/0009-request-state-lives-in-postgres-not-redis.md)):

- Session data moves from `InMemoryStore` to Postgres, encrypted like other PHI fields where it can contain PHI.
- Request-limiter counts move to Postgres.
- The startup backfill becomes a job run once per release.
- Redis is removed: the `RedisStore` class, the `redis` dependency, and the `redis` service in `docker-compose.yml`.

Fly replaces one machine at a time during a deploy, so a release does not interrupt Brokers.

## Release pipeline

1. A change reaches `main` only by pull request with the required checks passing.
2. A merge to `main` builds one image.
3. After the checks pass on `main`, that image deploys to Staging and the Demo, and the smoke checks run against each.
4. Production receives the same image, identified by its digest, through a deliberate human step. Each Production release gets a version tag.

Production never builds its own image. What ran on Staging is what runs in Production.

Required checks on a pull request:

- backend lint
- backend tests, on Postgres
- frontend build
- end-to-end tests in Chromium. Firefox and WebKit run and report but do not block.
- a migration check that applies the new migrations to a database at the previous release's schema
- dependency audits for Python and npm, secret scanning, and a scan of the built image. Critical findings block; others are reported.

`main` is protected: no direct pushes, with a documented override for emergencies. This requires a paid GitHub plan.

Rolling back means promoting the previous image. The migration compatibility rule is what makes that safe.

## Backups and recovery

Targets: lose at most 24 hours of data, and be back in service within 4 hours.

- **Database.** Fly's managed backups are the first line. A nightly encrypted dump also goes to an S3 bucket in the AWS account, so recovery does not depend on Fly.
- **Documents.** The Production bucket has versioning on, so an overwritten or deleted Document can be recovered.
- **Keys.** `PHI_ENCRYPTION_KEY` (every version) and `JWT_SECRET` are stored in a second place outside Fly, apart from the data they protect. Without the encryption key every backup is unreadable.
- **Restore drill.** On a schedule, the latest backup is restored to a temporary database inside Production's boundary, the application is pointed at it to confirm it can read and decrypt, and the temporary database is deleted. The first drill happens before launch.
- **After any restore,** Brokers offboarded since the backup was taken are deleted again before the data is put into service ([ADR 0010](../../adr/0010-offboarding-deletes-records-and-lets-backups-age-out.md)).

The backup retention window is a stated number, because Offboarding promises that copies in backups disappear within it.

## Monitoring and alerting

- **Uptime check.** An outside service requests a health endpoint every minute. The endpoint confirms the database answers.
- **Requests and errors.** Logfire is extended from agent invocations to every HTTP request and unhandled exception.
- **Logs.** Structured logs are shipped off the machine so they survive a restart.
- **Alerts to the operator's phone** for three conditions: the site is down, the error rate jumps, or the nightly backup did not report success. The backup job reports to a monitor that alerts when the report does not arrive.

Telemetry never contains PHI. Request tracing exports only named safe fields, the approach already used for agent invocations: no request bodies, no query strings, no Client details in error messages. A test proves the allowlist holds.

## Operator access

- Deploys to Production are made by the pipeline. The Production deploy token exists only in the pipeline's protected Production environment.
- Two-factor sign-in is on for every account that can reach Production: GitHub, Fly, AWS, Logfire, and the domain registrar.
- Opening a shell or the database in Production is break-glass. Each use is recorded with the date, the reason, and what was looked at.
- In-application admin actions are written to the existing audit log. This includes `promote_admin.py` and the forensics replay tool when used against Production.

## Product changes for real data

**Accounts by invitation.** In Production and Staging, public registration is off. The operator creates an invitation after the Design Partner's BAA is signed, and the Broker sets their password and second factor from it. The Demo keeps open access.

**Two-factor sign-in.** Every Broker account in Production and Staging signs in with a password and an authenticator-app code, with one-time recovery codes. Resetting a lost second factor requires the operator to verify the Broker's identity through a channel other than email; the procedure is a runbook.

**Offboarding** ([ADR 0010](../../adr/0010-offboarding-deletes-records-and-lets-backups-age-out.md)):

1. The account is deactivated at once.
2. The Broker receives an export of their Clients, Enrollments, Issues, Appeals, Tasks, Appointments, notes, Approvals, and Documents.
3. Within 30 days their records are deleted from the database, the document store, and the search index. This includes decided Approvals, the one exception to their permanence under [ADR 0003](../../adr/0003-approvals-gate-only-software-initiated-changes.md).
4. Copies in backups expire with those backups.
5. The audit trail is kept for six years, holding identifiers and actions only.
6. The Broker receives written confirmation.

The record of completed Offboardings is kept where a restore cannot erase it.

**Sending data to Claude** ([ADR 0004](../../adr/0004-ask-healthflow-uses-client-pseudonyms.md)). A signed BAA with Anthropic is a launch condition. Redaction and Client pseudonyms stay. Three gaps in the redaction boundary are closed for every agent: ZIP codes are truncated to three digits, dates relating to a person are reduced to the year, and ages over 89 are reported as 90 or over. The agents that read free text or Documents (Draft Appeal, Explain Coverage, Ask HealthFlow) can be switched off per environment, so Production can launch without them if the BAA is late.

## Incidents and support

- **Incident runbook.** Severity levels and a first-fifteen-minutes checklist: confirm, contain, communicate, fix.
- **Breach procedure.** A separate runbook for the case where PHI may have been exposed: how to assess it, what evidence to preserve, whom to notify, and by when. HIPAA requires notice without unreasonable delay and within 60 days of discovery; the signed BAAs may set a shorter period, and the runbook uses the shortest.
- **Incident reviews.** Every incident gets a written review in the repository, ending in at least one concrete change.
- **Support promise.** Responses within business hours, best-effort attention to alerts outside them, and no contractual uptime guarantee during the Design Partner phase. This is stated in the Design Partner agreement.

Runbooks live in `docs/runbooks/`.

## Non-code work

- **Risk analysis.** A written assessment of where PHI lives and flows, what could go wrong, and the safeguard for each risk. It starts as a draft early and is completed before launch. `docs/security-architecture.html` is the starting material.
- **Policies.** Short documents in the repository covering access, incidents, backups, device security, and sanctions, drawn from this design.
- **Contracts.** A healthcare lawyer drafts or reviews the BAA signed with each Design Partner and the Design Partner agreement. The vendor BAAs in the table above are signed.
- **Security officer and training.** The operator is the named security officer and completes a recognised HIPAA training course, keeping the certificate.

## Build order

Each phase leaves the Demo working and deployable.

| Phase | Work |
|---|---|
| 0. Start the clocks | Anthropic BAA inquiry; find a healthcare lawyer; confirm the Fly Compliance Package. Make deploys wait for passing checks; protect `main`. |
| 1. One database, stateless application | Postgres everywhere; Alembic with the baseline migration; sessions and limiter in Postgres; backfill as a release job; Redis removed; CI on Postgres. All on the Demo. |
| 2. Staging and the pipeline | Staging app and database; build once and promote; S3 and SES; security scans; the migration check. |
| 3. Product changes for real data | Invitations; two-factor sign-in; Offboarding export and deletion; the redaction gaps; the per-environment agent switch; the telemetry allowlist. |
| 4. Operations | Backups and the off-platform copy; key backup; alerts; runbooks; break-glass log; per-environment credentials. |
| 5. Production and launch | Create Production with no real data; rehearse a full release and a restore drill; finish the risk analysis and policies; sign the contracts; complete the launch checklist; invite the first Design Partner. |

## Launch checklist

Real Client information enters Production only when all of these are true.

Contracts and paperwork:

- [ ] Fly BAA active
- [ ] AWS BAA active
- [ ] Logfire BAA signed
- [ ] Anthropic BAA signed, or the free-text agents are switched off in Production
- [ ] BAA and Design Partner agreement reviewed by a healthcare lawyer
- [ ] Risk analysis complete
- [ ] Policies written
- [ ] HIPAA training completed and certificate kept

Engineering:

- [ ] Production shares no database, bucket, secret, or key with any other environment
- [ ] A release has been promoted from Staging to Production by digest, and rolled back, as a rehearsal
- [ ] A backup has been restored and read successfully in a drill
- [ ] `PHI_ENCRYPTION_KEY` and `JWT_SECRET` are backed up outside Fly
- [ ] All three alerts have been triggered on purpose and reached the operator's phone
- [ ] Public registration is off in Production and invitations work
- [ ] Two-factor sign-in is enforced and the recovery procedure has been walked through
- [ ] Offboarding has been run end to end on Staging
- [ ] The redaction gaps are closed and tested
- [ ] The telemetry allowlist test passes
- [ ] Two-factor sign-in is on for every operator account
- [ ] Incident and breach runbooks are written

## Open questions

These need an answer before the work that depends on them, and none reverses a decision above.

- **Fly:** the Compliance Package price, and what Managed Postgres provides for backup frequency, retention, and point-in-time recovery. Point-in-time recovery would tighten the 24-hour data-loss target at no extra effort.
- **Anthropic:** whether a BAA is available to a company at this stage, and which API features it excludes. The exclusions may include prompt caching, batch processing, and the Files API; the private `healthflow-agents` package has to be checked for use of each.
- **GitHub:** whether a required-reviewer rule is available for the Production environment on the chosen plan. If not, the human step is a workflow started by hand that takes the image digest.
- **Logfire:** whether the plan that includes a BAA fits the budget.
- **Legal:** whether each Design Partner is a business associate of a health plan (making HealthFlow a subcontractor) or a covered entity, and the exact scope of six-year audit retention.
- **HIPAA Security Rule update:** whether the proposed requirement for two-factor sign-in has been finalised.
- **Production's domain name.** The Demo currently holds `healthflow.work`.
- **Monthly budget** for the three environments and the vendor plans.
