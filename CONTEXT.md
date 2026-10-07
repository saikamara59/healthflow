# HealthFlow Broker Workspace

The Broker Workspace organizes a Broker's Clients and related work. Documents in the Demo use invented information and remain separate from Production.

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
A change to a Broker's records that HealthFlow software proposes without the Broker directly asking for it (for example from Inbox matching, Ask HealthFlow, or a Connector), and that has no effect until the Broker approves it. The Broker either approves it, optionally adjusting the proposed values first, or rejects it with a reason. Anything the Broker starts directly is not an Approval: recording an Enrollment as submitted, or saving the draft a Tool produced at the Broker's request. A decided Approval is a permanent record and is never changed, and is deleted only by Offboarding.
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

**Production**:
The HealthFlow environment where Design Partners work with real Client information. It is the only environment that ever holds real Client information, and nothing is copied out of it into another environment.
_Avoid_: Live, prod workspace, real-data workspace

**Staging**:
A private HealthFlow environment set up the same way as Production but holding only invented information, where each change is checked before it reaches Production.
_Avoid_: Test environment, pre-prod, QA

**Demo**:
The public HealthFlow environment anyone can try, holding only invented information. It shares nothing with Production.
_Avoid_: Sandbox, playground

**Design Partner**:
A Broker invited to use HealthFlow with real Client information before general availability. A Design Partner has a signed Business Associate Agreement with HealthFlow before their account exists, and never joins by signing up themselves.
_Avoid_: Beta user, pilot customer, early adopter

**Offboarding**:
The end of a Design Partner's use of HealthFlow. Their access stops at once, they receive a copy of their records, and HealthFlow then removes those records, including decided Approvals, keeping only the trail of who accessed what. Unlike an Archived Client, nothing offboarded remains available for reference.
_Avoid_: Account deletion, churn, deactivation

**Demo Document**:
A Document containing invented information for the Demo. It is never treated as a real Client Document or moved into Production.
