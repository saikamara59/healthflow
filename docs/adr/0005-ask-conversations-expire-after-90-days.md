# Ask Conversations expire after 90 days

Ask Conversations contain PHI in free text ("Inés's insulin went to Tier 4, remind me to call her"), and nothing requires keeping them: CMS's 10-year recording rule covers sales calls with beneficiaries, not a Broker's exchanges with their own assistant. Anything that matters leaves a conversation as a Task, Appointment, or Approval, which are kept permanently. So conversations are stored encrypted, shown in the Broker's history, and deleted automatically after 90 days, or sooner when the Broker deletes one.

Each Approval copies the excerpt that led to it, so deleting a conversation never breaks the Approval's audit trail. We rejected keeping conversations for the life of the account (a growing store of sensitive free text with no lasting use) and not storing them at all (Brokers reasonably revisit yesterday's answer). Ninety days covers a full enrollment period and can be changed.
