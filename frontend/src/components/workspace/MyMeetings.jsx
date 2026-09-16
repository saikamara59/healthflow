function AppointmentRows({ appointments, onStatusChange }) {
  return appointments.length ? <ul className="workspace-list">{appointments.map((item) => <li className="workspace-list-row" key={item.id}>
    <div className="workspace-row-copy"><strong>{item.title}</strong><small>{new Date(item.starts_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}{item.client_name ? ` · ${item.client_name}` : ''}</small></div>
    {item.presentation_status === 'needs_follow_up' && <span className="workspace-tag">Needs follow-up</span>}
    <div className="workspace-row-actions"><button className="btn sm" onClick={() => onStatusChange(item, 'complete')}>Complete</button><button className="btn sm ghost" onClick={() => onStatusChange(item, 'cancel')}>Cancel</button></div>
  </li>)}</ul> : <p className="workspace-empty">No meetings scheduled.</p>
}

export default function MyMeetings({ today, upcoming, onStatusChange }) {
  return <section className="card workspace-section"><h2>My Meetings</h2>
    <h3 className="workspace-subheading">Today</h3><AppointmentRows appointments={today} onStatusChange={onStatusChange} />
    <h3 className="workspace-subheading">Coming up</h3><AppointmentRows appointments={upcoming} onStatusChange={onStatusChange} />
  </section>
}
