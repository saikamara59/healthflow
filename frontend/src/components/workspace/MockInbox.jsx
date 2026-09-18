import { MOCK_INBOX } from '../../data/mockInbox'

export default function MockInbox({ onCreateTask, onCreateAppointment }) {
  return <section className="card workspace-section"><div className="between"><h2>Mock inbox</h2><span className="workspace-tag">Sample messages only</span></div><p className="workspace-small">A preview of how email could support your day. This is not connected to your inbox.</p>
    <ul className="workspace-list">{MOCK_INBOX.map((message) => <li className="workspace-list-row workspace-mail" key={message.id}>
      <div className="workspace-row-copy"><div className="between"><strong>{message.sender}</strong><small>{message.receivedLabel}</small></div><strong>{message.subject}</strong><small>{message.preview}</small><small>{message.organization}{message.clientMatch ? ` · Suggested client: ${message.clientMatch.label} — Confirm Client link` : ''}</small><div className="quick-create-actions"><button className="btn sm" onClick={() => onCreateTask(message)} aria-label={`Create task from ${message.subject}`}>Create Task</button><button className="btn sm ghost" onClick={() => onCreateAppointment(message)} aria-label={`Add appointment from ${message.subject}`}>Add Appointment</button></div></div>
    </li>)}</ul>
  </section>
}
