# HealthFlow Broker Workspace

The Broker Workspace organizes a Broker's Clients and related work. Documents in the public demo use invented information and remain separate from any future real-client workspace.

## Language

**Client**:
A person whose enrollment and case work a Broker tracks in the workspace. A Client's past work remains part of the record when the Client is archived.

**Archived Client**:
A Client retained for historical reference but absent from ordinary active Client lists. Related work remains available, including open Tasks and scheduled Appointments.

**Document**:
A Broker-owned file belonging to exactly one Client that can also be associated with that Client's Enrollment, Issue, or Appeal. It is not shared between Clients. Archiving it hides it from all active views; restoring it reveals its existing Links again.

**Document Link**:
An association between a Document and one of its Client's related Enrollment, Issue, or Appeal records. A Link does not create another file and can end independently of the Document while its past association remains traceable.

**Approval**:
A change to a Broker's records that HealthFlow software proposes without the Broker directly asking for it (for example from Inbox matching, Ask HealthFlow, or a Connector), and that has no effect until the Broker approves it. The Broker either approves it, optionally adjusting the proposed values first, or rejects it with a reason. Anything the Broker starts directly is not an Approval: recording an Enrollment as submitted, or saving the draft a Tool produced at the Broker's request. A decided Approval is a permanent record and is never changed or deleted.
_Avoid_: Pending change, suggestion, request

**Ask HealthFlow**:
The workspace assistant a Broker converses with about their own Clients and work. It can read the Broker's records and propose Approvals, but never changes records itself.
_Avoid_: Chatbot, copilot, AI assistant

**Ask Conversation**:
One exchange between a Broker and Ask HealthFlow. It is kept for 90 days, or less if the Broker deletes it, while any Approval it produced keeps the excerpt that led to it.
_Avoid_: Chat, thread, session

**Working With**:
The one Client a Broker is currently focused on across the workspace. It sets the Client Context of a new Ask Conversation and prefills the Tools.
_Avoid_: Active client, selected client

**Client Context**:
The Clients a Broker has added to an Ask Conversation. Ask HealthFlow reads a Client's details only while that Client is in context; otherwise it sees the Broker's work with Clients referred to by stand-ins.

**Demo Document**:
A Document containing synthetic information for the public sandbox. It is never treated as a real Client Document or promoted into a real-data workspace.
