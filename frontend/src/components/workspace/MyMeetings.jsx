function AppointmentRows({ appointments, onStatusChange, timeZone }) {
  return appointments.length ? <ul className="workspace-list">{appointments.map((item) => <li className="workspace-list-row" key={item.id}>
    <div className="workspace-row-copy"><strong>{item.title}</strong><small>{new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.starts_at))}{item.client_name ? ` · ${item.client_name}` : ''}</small></div>
    {item.client_archived && <span className="status-label">Archived client</span>}
    {item.presentation_status === 'needs_follow_up' && <span className="workspace-tag">Needs follow-up</span>}
    <div className="workspace-row-actions"><button className="btn sm" onClick={() => onStatusChange(item, 'complete')}>Complete</button><button className="btn sm ghost" onClick={() => onStatusChange(item, 'cancel')}>Cancel</button></div>
  </li>)}</ul> : <p className="workspace-empty">No meetings scheduled.</p>
}

export default function MyMeetings({ today, upcoming, onStatusChange, timeZone }) {
  return <section className="card workspace-section"><h2>My Meetings</h2>
    <h3 className="workspace-subheading">Today</h3><AppointmentRows appointments={today} onStatusChange={onStatusChange} timeZone={timeZone} />
    <h3 className="workspace-subheading">Coming up</h3><AppointmentRows appointments={upcoming} onStatusChange={onStatusChange} timeZone={timeZone} />
  </section>
}
