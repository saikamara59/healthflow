import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../api/client'
import TopBar from '../components/TopBar'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'
import { addCalendarDays, dateInZone, localToUtc } from '../api/workspaceTime'
import QuickCreateModal from '../components/workspace/QuickCreateModal'

export default function SchedulingPage() {
  const { openMenu, openNotifications } = useLayout()
  const location = useLocation()
  const [appointments, setAppointments] = useState(null)
  const [targetAppointment, setTargetAppointment] = useState(null)
  const [clients, setClients] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [zone, setZone] = useState(null)
  const [start, setStart] = useState(null)
  const [creating, setCreating] = useState(null)
  const [error, setError] = useState('')
  const [targetError, setTargetError] = useState('')
  const requestRef = useRef(0)
  const selectedRef = useRef(null)
  selectedRef.current = start && zone ? `${start}:${zone}` : null
  const weekQuery = (day, timeZone) => `ends_after=${encodeURIComponent(localToUtc(day, '00:00', timeZone))}&starts_before=${encodeURIComponent(localToUtc(addCalendarDays(day, 7), '00:00', timeZone))}`
  async function refresh() {
    const selected = `${start}:${zone}`
    if (selected !== selectedRef.current) return
    const request = ++requestRef.current
    const items = await workspaceApi.listAppointments(weekQuery(start, zone))
    if (request === requestRef.current && selected === selectedRef.current) setAppointments(items)
  }
  useEffect(() => {
    let alive = true
    Promise.all([workspaceApi.getPreferences(), api.get('/clients'), workspaceApi.listOrganizations(true)]).then(([preferences, clientData, orgData]) => {
      if (alive) { setZone(preferences.timezone_name); setStart(dateInZone(new Date(), preferences.timezone_name)); setClients(clientData); setOrganizations(orgData) }
    }).catch(() => { if (alive) setError('Scheduling could not be loaded.') })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!zone || !start) return
    let alive = true
    setAppointments(null)
    refresh().catch(() => { if (alive) setError('Scheduling could not be loaded.') })
    return () => { alive = false; requestRef.current += 1 }
  }, [start, zone])
  useEffect(() => {
    const appointmentId = new URLSearchParams(location.search).get('appointment')
    let alive = true
    setTargetAppointment(null)
    setTargetError('')
    if (appointmentId) workspaceApi.getAppointment(appointmentId).then((item) => {
      if (alive) { setTargetAppointment(item); setTargetError('') }
    }).catch(() => { if (alive) setTargetError('The matching Appointment could not be loaded.') })
    return () => { alive = false }
  }, [location.search])
  async function status(item, action) {
    try {
      if (action === 'complete') await workspaceApi.completeAppointment(item.id)
      else await workspaceApi.cancelAppointment(item.id)
      await refresh()
      if (targetAppointment?.id === item.id) setTargetAppointment(await workspaceApi.getAppointment(item.id))
    } catch { setError('Appointment could not be updated.') }
  }
  const days = start ? Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index)) : []
  return <><TopBar crumbs={['Workspace', 'Scheduling']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><div className="page-head"><div><h1 className="page-title">Scheduling</h1><p className="page-sub">A clear view of the next seven days{zone ? ` · ${zone}` : ''}.</p></div><button className="btn accent" disabled={!start} onClick={() => setCreating({ startDate: start, endDate: start })}>New Appointment</button></div>
    <div className="workspace-agenda-controls"><button className="btn" disabled={!start} onClick={() => setStart(addCalendarDays(start, -7))}>Previous week</button><button className="btn" disabled={!zone} onClick={() => setStart(dateInZone(new Date(), zone))}>Today</button><button className="btn" disabled={!start} onClick={() => setStart(addCalendarDays(start, 7))}>Next week</button></div>
    {error && <p role="alert" className="workspace-error">{error}</p>}{targetError && <p role="alert" className="workspace-error">{targetError}</p>}{!appointments && !error && <p role="status">Loading appointments…</p>}
    {targetAppointment && zone && <section className="card workspace-section" aria-label="Matching appointment"><h2>Search result</h2><div className="workspace-list-row"><div className="workspace-row-copy"><strong>{targetAppointment.title}</strong><small>{new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(targetAppointment.starts_at))} · {targetAppointment.status.replace('_', ' ')}</small></div>{targetAppointment.status === 'scheduled' && <div className="workspace-row-actions"><button className="btn sm ghost" onClick={() => status(targetAppointment, 'complete')}>Complete</button><button className="btn sm ghost" onClick={() => status(targetAppointment, 'cancel')}>Cancel</button></div>}</div></section>}
    {appointments && <div className="workspace-agenda">{days.map((day) => {
      const dayStart = new Date(localToUtc(day, '00:00', zone))
      const dayEnd = new Date(localToUtc(addCalendarDays(day, 1), '00:00', zone))
      const entries = appointments.filter((item) => item.status === 'scheduled' && new Date(item.starts_at) < dayEnd && new Date(item.ends_at) > dayStart)
      return <section className="card workspace-section" key={day}><div className="between"><h2>{new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })}</h2><button className="btn sm ghost" aria-label={`Add appointment on ${day}`} onClick={() => setCreating({ startDate: day, endDate: day })}>+</button></div>
        {entries.length ? <ul className="workspace-list">{entries.map((item) => <li className="workspace-list-row" key={item.id}><div className="workspace-row-copy"><strong>{item.title}</strong><small>{new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(item.starts_at))}{item.client_name ? ` · ${item.client_name}` : ''}</small></div><div className="workspace-row-actions"><button className="btn sm ghost" onClick={() => status(item, 'complete')}>Complete</button><button className="btn sm ghost" onClick={() => status(item, 'cancel')}>Cancel</button></div></li>)}</ul> : <p className="workspace-empty">No meetings</p>}
      </section>
    })}</div>}
    {creating && <QuickCreateModal mode="appointment" initialValues={creating} clients={clients} organizations={organizations} timeZone={zone} onClose={() => setCreating(null)} onCreated={async () => { setCreating(null); try { await refresh() } catch { setError('Saved, but Scheduling could not refresh. Reload to see the update.') } }} />}
  </main></>
}
