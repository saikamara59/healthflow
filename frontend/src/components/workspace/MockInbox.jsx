import { useState } from 'react'
import { MOCK_INBOX } from '../../data/mockInbox'
import HfTile from '../ui/HfTile'

function withSuggestedClient(message, clients) {
  if (!message.clientMatch || clients.length === 0) return { ...message, clientMatch: null }
  const client = clients[message.clientMatch.clientIndex]
  if (!client) return { ...message, clientMatch: null }
  return { ...message, clientMatch: { id: client.id, label: client.full_name, state: message.clientMatch.state } }
}

export default function MockInbox({ clients = [], onCreateTask, onCreateAppointment }) {
  // Messages whose suggested Client the Broker confirmed here; nothing is linked until then.
  const [linked, setLinked] = useState({})
  return <section className="card workspace-section" aria-labelledby="today-inbox-heading">
    <div className="between"><h2 id="today-inbox-heading" className="ws-h2"><HfTile icon="mail" color="explain" />Inbox</h2><span className="chip ghost">Sample data</span></div>
    <p className="workspace-small td-inbox-note">Example messages only. No mailbox is connected and nothing is sent or stored.</p>
    <ul className="workspace-list">{MOCK_INBOX.map((fixture) => {
      const suggested = withSuggestedClient(fixture, clients)
      const message = { ...suggested, linkedClientId: suggested.clientMatch && linked[suggested.id] ? suggested.clientMatch.id : null }
      return <li className="workspace-list-row workspace-mail" key={message.id}>
        <span className="td-mail-avatar" aria-hidden="true">{message.organization.charAt(0)}</span>
        <div className="workspace-row-copy">
          <div className="between"><strong>{message.subject}</strong><small>{message.receivedLabel}</small></div>
          <small>{message.sender} · {message.organization}</small>
          <small className="td-preview">{message.preview}</small>
          {message.clientMatch && <div className="workspace-link-suggestion">
            <div><small>Possible client match</small> {message.linkedClientId ? <span className="workspace-link-confirmed">Linked to {message.clientMatch.label}</span> : <strong>{message.clientMatch.label}</strong>}</div>
            {!message.linkedClientId && <button className="btn sm" onClick={() => setLinked({ ...linked, [message.id]: true })} aria-label={`Confirm link to ${message.clientMatch.label}`}>Confirm link</button>}
          </div>}
          <div className="quick-create-actions">
            <button className="btn sm" onClick={() => onCreateTask(message)} aria-label={`Create task from ${message.subject}`}>Create task</button>
            <button className="btn sm" onClick={() => onCreateAppointment(message)} aria-label={`Create appointment from ${message.subject}`}>Create appointment</button>
          </div>
        </div>
      </li>
    })}</ul>
  </section>
}
