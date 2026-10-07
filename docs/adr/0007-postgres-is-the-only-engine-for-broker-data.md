# Postgres is the only engine for Broker data

HealthFlow began on SQLite and grew Postgres branches that were never run: no Postgres driver was installed and every test used in-memory SQLite. Production uses Managed Postgres ([ADR 0006](0006-production-on-fly-with-aws-for-documents-and-email.md)), so Broker data now runs on Postgres in Production, Staging, the Demo, CI, and local development, and SQLite support for it is removed.

We rejected keeping SQLite for tests and the Demo because Production would then be the first place the code met Postgres, and the engines differ in type strictness, locking, and constraint behaviour. Supporting both also means writing and testing every schema change twice. The cost is slower tests than in-memory SQLite, a Postgres container for local work, and a paid database for the Demo.

The read-only plan and drug catalog (`healthflow_data.db`) stays SQLite. It holds public reference data, no PHI, and is rebuilt from source rather than migrated.
