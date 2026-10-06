import { Link } from 'react-router-dom'
import HfTile, { RecordLinks } from '../ui/HfTile'

const STATUS_CHIPS = {
  needs_follow_up: <span className="chip warn">Needs follow-up</span>,
  completed: <span className="chip pos">Completed</span>,
  canceled: <span className="chip">Canceled</span>,
}

function AppointmentRow({ item, onComplete, timeZone, showDay, now }) {
  const time = (value, options) => new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(new Date(value))
  const clock = (value) => time(value, { hour: 'numeric', minute: '2-digit' })
  const scheduled = item.presentation_status === 'scheduled'
  const current = scheduled && new Date(item.starts_at) <= now && new Date(item.ends_at) > now
  const closed = item.presentation_status === 'completed' || item.presentation_status === 'canceled'
  return <li className={`workspace-list-row td-appt${current ? ' td-now' : ''}${closed ? ' td-muted' : ''}`}>
    <div className="td-time">
      <strong>{showDay ? time(item.starts_at, { weekday: 'short', month: 'short', day: 'numeric' }) : clock(item.starts_at)}</strong>
      <small>{showDay ? clock(item.starts_at) : clock(item.ends_at)}</small>
    </div>
    <div className="workspace-row-copy"><strong>{item.title}</strong><RecordLinks record={item} /></div>
    <div className="td-row-meta">
      {item.client_archived && <span className="status-label">Archived client</span>}
      {current && <span className="chip accent">In progress</span>}
      {STATUS_CHIPS[item.presentation_status]}
      {item.presentation_status === 'needs_follow_up' && <button className="btn sm" onClick={() => onComplete(item)} aria-label={`Mark ${item.title} completed`}>Mark completed</button>}
    </div>
  </li>
}

function AppointmentList({ appointments, emptyText, ...rowProps }) {
  return appointments.length
    ? <ul className="workspace-list">{appointments.map((item) => <AppointmentRow key={item.id} item={item} {...rowProps} />)}</ul>
    : <p className="workspace-empty workspace-small">{emptyText}</p>
}

export default function MyMeetings({ today, upcoming, onComplete, timeZone }) {
  const now = new Date()
  return <>
    <section className="card workspace-section" aria-labelledby="today-meetings-heading">
      <div className="between"><h2 id="today-meetings-heading" className="ws-h2"><HfTile icon="cal" color="today" />My Meetings</h2><Link className="td-link" to="/scheduling">Open Scheduling</Link></div>
      <AppointmentList appointments={today} emptyText="No meetings today." onComplete={onComplete} timeZone={timeZone} now={now} />
    </section>
    <section className="card workspace-section" aria-labelledby="today-upcoming-heading">
      <div className="between"><h2 id="today-upcoming-heading" className="ws-h2"><HfTile icon="cal" color="compare" />Upcoming</h2><span className="workspace-small">Next 7 days</span></div>
      <AppointmentList appointments={upcoming} emptyText="Nothing scheduled this week." onComplete={onComplete} timeZone={timeZone} now={now} showDay />
    </section>
  </>
}
