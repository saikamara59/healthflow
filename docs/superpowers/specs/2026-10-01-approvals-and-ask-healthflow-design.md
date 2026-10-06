# Approvals and Ask HealthFlow

## Purpose and release boundary

HealthFlow is being built for real Brokers and real Client PHI; sample data in the plan catalog, drug table, and provider networks are placeholders until real sources arrive. This design adds two pieces that ship together:

- **Approvals**: a queue of changes that HealthFlow software proposes without the Broker directly asking for them. Nothing in an Approval affects a Broker's records until the Broker approves it.
- **Ask HealthFlow**: a workspace assistant that answers questions about the Broker's day and Clients, runs read-only Tools on request, hands off Draft Appeal, and proposes Tasks and Appointments as Approvals.

Ask HealthFlow is the first real proposer of Approvals. Approvals are not built on the mock inbox, and an empty queue is not shipped on its own. Later proposers (Inbox matching once email is connected, the Google Calendar connector) reuse the same Approval model.

Out of scope for this release: saving an Ask Conversation as a Document, voice mode (needs a speech vendor with its own BAA), Approvals that modify or delete existing records, bulk approval, delegated approval by a team member, push notifications, and reading Document contents. Each is a later increment with its own decision.

Governing decisions: [ADR 0003](../../adr/0003-approvals-gate-only-software-initiated-changes.md) (Approval boundary, create-only, outcomes, permanence), [ADR 0004](../../adr/0004-ask-healthflow-uses-client-pseudonyms.md) (Client pseudonyms), [ADR 0005](../../adr/0005-ask-conversations-expire-after-90-days.md) (conversation retention), and [ADR 0002](../../adr/0002-archive-clients-to-preserve-work.md) (archived Clients). Terms follow `CONTEXT.md`.

## Domain and data ownership

**Approval.** Each Approval belongs to one Broker and records: its proposer (agent, model, and source such as an Ask Conversation), the excerpt that led to it, the kind of record it would create (Task or Appointment in this release), the proposed values, the Client and other records it would link to, and its state. States are **pending**, **approved**, and **rejected**. There is no "changes requested" state and no automatic expiry.

Approving may adjust the proposed values first; the Approval keeps both the original proposal and the approved values. Rejecting requires a reason. A decided Approval also records who decided, when, and where (Ask HealthFlow or the Approvals page). Once decided it is immutable and never deleted. The record it created stores a reference to its Approval so the record can show "Created from Ask HealthFlow, approved by you." Approval free text (titles, notes, excerpt, values, reason) is encrypted like other PHI fields.

Approvals in this release only create records: Tasks (including follow-up Tasks) and Appointments. They never modify or delete existing records, which avoids overwriting a change the Broker made after the proposal. Allowing modifications later requires a staleness check that blocks approval when the target changed since the proposal.

**Ask Conversation.** Each Ask Conversation belongs to one Broker and holds the messages, its Client Context, and references to Approvals it produced. Messages are encrypted. Conversations are deleted automatically 90 days after their last message, or earlier when the Broker deletes one. Deletion never touches Approvals, which keep their own excerpt. Conversations are private to their Broker.

**Client Context and Working With.** The top bar's Working With picker becomes the single source of focus. Choosing a Client there sets the Client Context of a new Ask Conversation and prefills the Tools (Compare Plans, Estimate Costs, Check Network, Draft Appeal). Inside a conversation, the Broker can add or remove Clients for that conversation only. Naming a Client who is not in context makes Ask ask "Add Marjorie Calloway to this conversation?" instead of reading them. Archived Clients never appear in Working With; a Broker may add one to a conversation explicitly, and its chip shows that it is archived.

## What Ask HealthFlow reads

- **Always:** the Broker's work, meaning overdue and due-today Tasks, upcoming Appointments, Issue deadlines, Enrollments waiting on the Broker, and workspace counts. Clients named in these items appear only as stand-ins.
- **With Client Context only:** details for Clients in context, meaning age, ZIP area, medications, doctors, plans, and open Issues and Enrollments.
- **Never in this release:** Document contents, other Brokers' data (already impossible under tenant scoping), and archived Clients unless explicitly added.

A whole-book search ("all my clients on Humira") is excluded because one question would send many Clients' medical details at once. It can return later as a deliberate feature with its own safeguards.

## Client pseudonyms

Claude never receives a Client's name or other direct identifiers ([ADR 0004](../../adr/0004-ask-healthflow-uses-client-pseudonyms.md)). For each conversation the server assigns each Client a stable stand-in ("Client A") and sends only de-identified attributes, such as age, a truncated ZIP, medications, doctors and NPIs, and plan names, consistent with the agents package's redaction boundary (healthflow-agents ADR 0006). Free text from records goes through the same redaction before it reaches a prompt. The stand-in mapping lives only on the server for the conversation and is never part of anything sent to Claude.

When Claude answers or proposes, the server replaces stand-ins with real Clients before showing the message or building the Approval. A proposal that references an unknown stand-in or a Client outside context is discarded and logged, never guessed. Pseudonyms remain the default even after a BAA with Anthropic, under HIPAA's minimum necessary standard.

## Components and user flow

**Approvals service and API.** It creates pending Approvals for a proposer, lists them by state for the owning Broker, returns one with its proposal and audit details, and decides them. Approve validates the final values against the current state before writing:

- the linked Client must still be active; new work for an archived Client requires restoring it first ([ADR 0002](../../adr/0002-archive-clients-to-preserve-work.md)), even if the Broker added that Client to an Ask Conversation to read it
- a Task's due time and an Appointment's time must not be in the past
- an Appointment must end after it starts
- all references must belong to the Broker

When a check fails, approval is blocked with a plain reason, and the Broker adjusts the values or rejects. Approving creates the record, links it to the Approval, records the decision, and writes a Workspace Activity entry, all in one transaction. Reject records the reason and creates nothing. Deciding an already-decided Approval returns a conflict, so a double click or two open tabs cannot create two records.

**Ask service.** It runs the conversation on Claude Sonnet with tool use. Its tools are:

- **read tools** for the Broker's work and for Clients in context, returning pseudonymized data
- **inline Tool runs** for Compare Plans, Estimate Costs, Check Network, and Explain Coverage, using their existing endpoints and models
- **hand-off preparation** for Draft Appeal, which opens Draft Appeal with the Issue selected and never runs it
- **proposal tools** that create pending Approvals for a Task or an Appointment

Inline runs show the inputs Ask assumed ("ZIP 10025, age 67, 3 medications from Marjorie's record") and keep the Tools' existing decision records and history entries. Their result card links to the full Tool page with the same inputs.

**Time interpretation.** Ask always proposes exact values in the Broker's saved time zone, using fixed defaults: morning is 9:00 AM, afternoon 1:00 PM, end of day 5:00 PM, "next week" means Monday 9:00 AM, and Appointments last 30 minutes. When a request is too vague to place ("sometime soon"), Ask asks a follow-up question instead of guessing. A proposed Appointment that overlaps an existing one is flagged on the proposal ("Overlaps: Plan review with Otis, 2:00 to 2:30 PM") but not blocked. A "remind me to call…" request becomes a Task marked as a follow-up.

**Workspace UI.**

- **Approvals page:** Needs review and Decided tabs, a type filter, and a review drawer showing what will happen, the editable proposed values, why it was proposed (the excerpt and proposer), and Approve / Reject with a reason.
- **Today:** pending Approvals join "Waiting for you" next to ready-to-submit Enrollments and Issue deadlines.
- **Sidebar:** shows the pending count.
- **Created records:** show "Created from Ask HealthFlow, approved by you."
- **Ask page:** Client Context chips, suggested prompts, streamed answers with the tool progress line while working, inline proposal cards with Approve / Edit / Reject (the same Approval as everywhere else), Tool result cards, and a conversation history of up to 90 days with delete.

## Ask HealthFlow limits

Ask's instructions and behavior enforce these limits:

1. **No medical advice.** It can explain coverage, tiers, and costs.
2. **No plan choice for the Broker.** It ranks and explains, and never says which plan to enroll a Client in. Choosing a plan with the Client is the licensed Broker's job under CMS marketing rules.
3. **No actions outside HealthFlow.** It never sends, submits, files, or contacts anyone.
4. **No changes without an Approval.** Ask never writes to records itself ([ADR 0003](../../adr/0003-approvals-gate-only-software-initiated-changes.md)).
5. **Record text is data, not instructions.** Text from notes and, later, messages is never followed as a command.
6. **No guessing who a Client is.** When a name is ambiguous, Ask asks.
7. **Honest sources.** Answers that rely on placeholder data say so, matching the Tools' source chips.

A small set of adversarial prompts must pass before every release: a medical question, "just enroll her in Aetna", a note containing hidden instructions, an ambiguous Client name, a vague time, and a request that would act outside HealthFlow.

## Usage, authorization, audit, and failure behavior

**Usage cap and cost tracking.** Each Broker gets 200 Ask messages per day, resetting at midnight in the Broker's time zone. Past the cap, Ask explains the limit and the rest of HealthFlow keeps working. Every Claude call made for Ask is logged with model, token counts, duration, and outcome through the existing agent invocation logging, so pricing can later be based on real numbers.

**Authorization and tenant scope.** Approvals and Ask Conversations join the tenant-scope registry and PHI-audit coverage. Only the owning Broker can see or decide an Approval, or see a conversation. Cross-Broker IDs return the same not-found response as nonexistent ones. Proposal tools can only reference records the read tools returned to that conversation.

**Audit.** Decisions are durable on the Approval itself and also appear in Activity. Logs never contain message text, proposal values, or stand-in mappings. They identify the Broker, conversation, Approval, action, and outcome only.

**Failure behavior.**

- When Claude is unavailable or a call fails, Ask says so and proposes nothing. A partial answer never creates an Approval.
- A failed inline Tool run is reported in the conversation without retrying silently.
- A proposal that cannot be de-pseudonymized or validated is dropped and logged.
- The 90-day cleanup job deletes only expired conversations and never touches Approvals or records.

## Verification and deployment gate

**Backend tests** cover:

- Approval states and immutability, approve with adjusted values (original and approved both kept), reject with required reason, and conflict on a second decision
- every approval-time check (archived Client, past time, end before start, foreign references), the created record's link back to its Approval, and the Activity entry
- tenant isolation for Approvals and conversations
- pseudonymization: no Client name or identifier appears in any prompt sent to Claude, stable stand-ins within a conversation, unknown stand-ins rejected
- Client Context limits: no details read for Clients outside context
- the time defaults and the vague-time follow-up, overlap flagging, the daily cap and its reset, the 90-day cleanup, and usage logging

**Agent evaluations** run the adversarial prompt set above and fail the release on any violation.

**Frontend tests** cover:

- approving from the Approvals page and inline in Ask, with both views showing the same decided Approval
- editing values before approving, rejecting with a reason, the blocked-approval explanation, and the pending count on Today and the sidebar
- Working With setting a new conversation's Client Context, adding and removing context Clients, an inline Tool run with its assumed inputs, the Draft Appeal hand-off, and the daily-cap message

Before enabling Ask for real Clients, confirm the deployment's data-handling posture: that pseudonymized prompts still satisfy the organization's HIPAA position without a BAA, or that a BAA is in place, and that conversation encryption and the 90-day cleanup are running in that environment.
