import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { CalendarBlank, CaretLeft, CaretRight, CheckCircle, MagnifyingGlass, Plus, XCircle } from '@phosphor-icons/react'
import { useLocation } from 'react-router-dom'
import api from '../api/client'
import TopBar from '../components/TopBar'
import PageHead from '../components/ui/PageHead'
import { OrgMark } from '../components/ui/OrgLogo'
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
    Promise.all([workspaceApi.getPreferences(), api.get('/clients?linkable=true'), workspaceApi.listOrganizations(true)]).then(([preferences, clientData, orgData]) => {
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
  const today = zone ? dateInZone(new Date(), zone) : null
  const time = (iso) => new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  const dayTitle = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
  const rangeTitle = start ? `${new Date(`${start}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })} – ${new Date(`${addCalendarDays(start, 6)}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })}` : ''
  const actions = (item) => item.status === 'scheduled' && <div className="workspace-row-actions">
    <button className="btn sm ghost" onClick={() => status(item, 'complete')}><CheckCircle size={14} weight="duotone" /> Complete</button>
    <button className="btn sm ghost" onClick={() => status(item, 'cancel')}><XCircle size={14} weight="duotone" /> Cancel</button>
  </div>
  const statusChip = (item) => item.presentation_status === 'needs_follow_up'
    ? <span className="chip warn">Needs follow-up</span>
    : item.presentation_status === 'completed' ? <span className="chip pos">Completed</span> : null
  return <MotionConfig reducedMotion="user"><TopBar crumbs={['Workspace', 'Scheduling']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page wide ws-page-in">
    <PageHead
      icon="cal"
      eyebrow={rangeTitle || null}
      title="Scheduling"
      sub={`A clear view of the next seven days${zone ? `. Times in ${zone}` : ''}.`}
      actions={<button className="btn accent" disabled={!start} onClick={() => setCreating({ startDate: start, endDate: start })}><Plus size={15} weight="bold" /> New Appointment</button>}
    />
    <div className="workspace-agenda-controls">
      <button className="btn" disabled={!start} onClick={() => setStart(addCalendarDays(start, -7))}><CaretLeft size={14} weight="bold" /> Previous week</button>
      <button className="btn" disabled={!zone || start === today} onClick={() => setStart(dateInZone(new Date(), zone))}><CalendarBlank size={14} weight="duotone" /> Today</button>
      <button className="btn" disabled={!start} onClick={() => setStart(addCalendarDays(start, 7))}>Next week <CaretRight size={14} weight="bold" /></button>
    </div>
    {error && <p role="alert" className="workspace-error">{error}</p>}{targetError && <p role="alert" className="workspace-error">{targetError}</p>}{!appointments && !error && <p role="status" className="workspace-empty">Loading appointments…</p>}
    {targetAppointment && zone && <section className="card workspace-section ws-search-hit" aria-label="Matching appointment">
      <h2><MagnifyingGlass size={16} weight="duotone" aria-hidden="true" /> Search result</h2>
      <div className="workspace-list-row"><div className="workspace-row-copy"><strong>{targetAppointment.title}</strong><small>{new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(targetAppointment.starts_at))} · {targetAppointment.status.replace('_', ' ')}</small></div>{targetAppointment.client_archived && <span className="status-label">Archived client</span>}{actions(targetAppointment)}</div>
    </section>}
    {appointments && <div className="workspace-agenda">{days.map((day) => {
      const dayStart = new Date(localToUtc(day, '00:00', zone))
      const dayEnd = new Date(localToUtc(addCalendarDays(day, 1), '00:00', zone))
      const entries = appointments
        .filter((item) => item.status !== 'canceled' && new Date(item.starts_at) < dayEnd && new Date(item.ends_at) > dayStart)
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
      const isToday = day === today
      return <section className={`card workspace-section ws-day${isToday ? ' today' : ''}`} key={day} aria-label={dayTitle(day)}>
        <div className="between"><h2>{dayTitle(day)}{isToday && <span className="ws-day-pill">Today</span>}</h2><button className="btn ghost icon sm" aria-label={`Add appointment on ${day}`} onClick={() => setCreating({ startDate: day, endDate: day })}><Plus size={14} weight="bold" /></button></div>
        {entries.length ? <ul className="workspace-list"><AnimatePresence initial={false}>{entries.map((item) => <motion.li
          className={`workspace-list-row ws-slot${item.presentation_status === 'completed' ? ' done' : ''}`}
          key={item.id}
          layout="position"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        >
          <small className="mono">{time(item.starts_at)} to {time(item.ends_at)}</small>
          <strong>{item.title}</strong>
          {(item.client_name || item.organization_name) && <small className="ws-slot-who">{item.client_name}{item.client_name && item.organization_name && ' · '}{item.organization_name && <><OrgMark name={item.organization_name} size={14} />{item.organization_name}</>}</small>}
          {(statusChip(item) || item.client_archived) && <span className="ws-slot-chips">{statusChip(item)}{item.client_archived && <span className="status-label">Archived client</span>}</span>}
          {actions(item)}
        </motion.li>)}</AnimatePresence></ul> : <p className="workspace-empty">No meetings</p>}
      </section>
    })}</div>}
    {creating && <QuickCreateModal mode="appointment" initialValues={creating} clients={clients} organizations={organizations} timeZone={zone} onClose={() => setCreating(null)} onCreated={async () => { setCreating(null); try { await refresh() } catch { setError('Saved, but Scheduling could not refresh. Reload to see the update.') } }} />}
  </main></MotionConfig>
}
