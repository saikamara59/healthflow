# Real PHI never leaves Production

HealthFlow has three environments: the Demo (public), Staging (private, set up like Production), and Production. Only Production ever holds real Client information. Staging and the Demo hold invented information only, and nothing is copied out of Production into them, including database dumps taken to reproduce a bug.

The rule keeps two of the three environments outside HIPAA scope, and it is enforced by separation as well as policy: each environment has its own database, bucket, secrets, and PHI encryption key, so Staging cannot read Production's Documents or decrypt its rows.

We rejected using the Demo as the rehearsal for Production. The Demo disables uploads, logs email instead of sending it, and allows public access, so it cannot exercise the paths that carry PHI.

## Consequences

- A Production problem that cannot be reproduced with invented data is investigated inside Production under the break-glass procedure, not by copying data down.
- Backup restore drills run against a temporary database inside Production's boundary, which is deleted afterwards. They never run on Staging.
- Staging needs its own realistic invented data set, large enough to rehearse migrations.
