# Offboarding deletes records and lets backups age out

A Business Associate Agreement requires PHI to be returned or destroyed when the relationship ends. When a Design Partner is offboarded, their access stops at once, they receive an export of their records and Documents, and HealthFlow deletes those records from the database, the document store, and the search index within 30 days. Copies inside backups are not edited; they disappear as the backups expire, within a stated window. The audit trail of who accessed what is kept for six years and holds record identifiers and actions, never Client details.

We rejected keeping a departed Broker's data in case they return, which carries PHI with no reason to hold it, and deleting immediately, which leaves no recovery from a mistaken or disputed request. We rejected rewriting backups to remove one Broker because it is error-prone and weakens the backups themselves.

This differs deliberately from archiving a Client ([ADR 0002](0002-archive-clients-to-preserve-work.md)), which preserves work for reference. Nothing offboarded remains available.

## Approvals are deleted too

[ADR 0003](0003-approvals-gate-only-software-initiated-changes.md) makes a decided Approval a permanent record. Offboarding overrides that. An Approval's excerpt, proposed values, and rejection reason contain Client PHI, and the duty to destroy PHI at the end of the relationship outranks keeping a record whose only reader, the Broker, has left. We rejected keeping Approvals with their free text stripped: what remains (a kind, a time, a decision) has no use to anyone and would still need to be shown to be free of PHI. The Broker's copy of their Approvals is in the export. The audit trail still records that each Approval was decided, by identifier and action only.

## Consequences

- Offboarding is the only thing that deletes a decided Approval. While a Broker uses HealthFlow, their Approvals remain permanent and unchangeable.

- After any restore from backup, Brokers offboarded since that backup was taken must be deleted again before the restored data is put into service. The record of completed Offboardings therefore has to survive a restore.
- The six-year retention figure follows HIPAA's period for required documentation; its exact scope is to be confirmed when the BAA is reviewed by a lawyer.
