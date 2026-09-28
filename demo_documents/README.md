# Synthetic Demo Documents

Every checked-in PDF/JPG/PNG here visibly says SYNTHETIC DEMO. Eleanor Rigby
and reference DEMO-0001 are invented; these files contain no real records.
`generate.py` reproducibly creates the source fixtures using Pillow and pypdf.

Routine demo startup runs seeding after API readiness, only with SEED_DEMO=1.
It attaches these Documents to the seeded Eleanor Rigby Client. Existing
markers, including archived Documents, are skipped; archived Clients are not
revived. HTTP uploads remain disabled (DOCUMENT_UPLOAD_ENABLED=0).

Before deployment, provision and verify a **private, dedicated demo** Tigris
bucket. Configure DOCUMENT_STORAGE_BUCKET, DOCUMENT_STORAGE_ENDPOINT (HTTPS),
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION through deployment
environment/secrets, never source control. No bucket is provisioned by these
scripts. Missing storage configuration or a failed seed fails startup.

An already provisioned active administrator can preview an exact reset:

```sh
python -m scripts.reset_demo_documents --admin-email ADMIN_EMAIL --fixture synthetic-summary-v1
```

The password is prompted without echo. The script prints matched Document IDs
and count, never filenames, object keys, or credentials. Add `--confirm` to
remove and reseed; repeat `--fixture` for another exact marker:
`synthetic-card-v1` or `synthetic-notice-v1`. Wildcards, empty lists, unknown
markers, inactive administrators, and ordinary Brokers are rejected. It never
lists or deletes a bucket, and it only deletes Links attached to selected
Documents. Historical DocumentEvent rows survive. Reset is the explicit
exception that replaces archived fixtures; ordinary reseeding never does.

Before each object PUT, a private cleanup journal durably records the exact
Broker, allowlisted marker, and encrypted random key. If that write fails, no
object is written. Successful Document creation clears the journal in the same
transaction. If both metadata creation and object cleanup fail, the journal
survives; retrying seeding or confirming a reset for the exact marker recovers
only that key. Recovery checks for a committed Document before removing any
object and keeps its journal if cleanup fails. Keys never appear in ordinary
logs, reset previews, or DocumentEvent rows. Reset previews include pending
cleanup record IDs/count. Startup's idempotent schema bridge adds this internal
table to existing databases. This journal adds one private table and recovery
lifecycle to maintain; no bucket scan is needed.

Storage and database changes are not one transaction: a durable started event
precedes each remove, and success follows metadata deletion. After a failure,
retry the same exact markers; a missing object removal is idempotent. No
automatic purge runs. Worker test resets clear scoped metadata only and never
touch object storage. This recovery policy applies only to synthetic fixtures.
