# Approvals gate only software-initiated changes

An Approval exists only for a change HealthFlow software proposes without the Broker directly asking for it (Ask HealthFlow, Inbox matching, a Connector). Steps the Broker starts stay on the record they affect: recording an Enrollment as submitted keeps its inline attestation, and a draft a Tool produces at the Broker's request is saved directly as a draft. The Claude Design mockup routes all of these through one queue, but that would have Brokers approving their own actions and blur who proposed a change versus who decided it. The rule Brokers can rely on is "software never changes your records on its own."

The first version only creates records (tasks, follow-ups, appointments, document and contact links). Approvals do not modify existing records yet, because a proposal could otherwise overwrite a change the Broker made after it was proposed. Adding modifications later needs a staleness check that blocks approving a proposal whose target has changed since.

Approvals have two outcomes: approved, optionally after the Broker adjusts the proposed values, or rejected with a reason. There is no "request changes" state, because a software proposer cannot revise in response, and there is no automatic expiry: a proposal that no longer holds (a past due time, an archived Client) is blocked at approval until the Broker adjusts or rejects it. A decided Approval is a permanent, unchangeable record of the original proposal, what was approved, and who decided.

## Update, 2026-10-06: Offboarding is the one exception to permanence

A decided Approval stays permanent and unchangeable for as long as its Broker uses HealthFlow. When a Broker is offboarded, their Approvals are deleted with the rest of their records ([ADR 0010](0010-offboarding-deletes-records-and-lets-backups-age-out.md)). Nothing else deletes or changes a decided Approval.
