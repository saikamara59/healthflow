import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { CalendarPlus, CheckCircle, ListPlus, PencilSimpleLine } from '@phosphor-icons/react'
import { workspaceApi } from '../api/workspace'
import { dateInZone } from '../api/workspaceTime'
import TopBar from '../components/TopBar'
import DocumentList from '../components/DocumentList'
import PageHead from '../components/ui/PageHead'
import useLayout from '../components/ui/useLayout'
import QuickCreateModal from '../components/workspace/QuickCreateModal'

const EMPTY = { client_id: '', title: '', description: '', deadline: '' }
const STATUS = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_outside_party: 'Waiting on an outside party',
  resolved: 'Resolved',
}
const TONE = { open: '', in_progress: 'accent', waiting_on_outside_party: 'warn', resolved: 'pos' }
const EASE = [0.22, 1, 0.36, 1]

const formatDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set')

// Days until an ISO date, counted from today in the workspace time zone rather
// than the device's, so a broker travelling or working near midnight sees the
// same countdown as their workspace calendar.
function daysUntil(iso, timeZone) {
  if (!iso) return null
  const dayNumber = (date) => Date.UTC(...date.split('-').map((part, index) => Number(part) - (index === 1 ? 1 : 0)))
  return Math.round((dayNumber(iso) - dayNumber(dateInZone(new Date(), timeZone))) / 86400000)
}

function DeadlineLabel({ iso, resolved, timeZone }) {
  const days = daysUntil(iso, timeZone)
  if (days === null) return <>No deadline</>
  if (resolved) return <>Due {formatDate(iso)}</>
  if (days < 0) return <span className="ws-due neg">Overdue · {formatDate(iso)}</span>
  if (days <= 14) return <span className="ws-due warn">Due in {days} day{days === 1 ? '' : 's'} · {formatDate(iso)}</span>
  return <>Due {formatDate(iso)}</>
}

function AppealDocuments({ clientId, appeal }) {
  const [expanded, setExpanded] = useState(false)
  return <details className="ws-row-docs" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Documents · {appeal.title}</summary>
    {expanded && <DocumentList clientId={clientId} targetType="appeal" targetId={appeal.id} />}
  </details>
}

function Linked({ title, count, action, children }) {
  return (
    <div className="ws-linked">
      <div className="between">
        <h3 className="workspace-subheading">{title} · {count}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function IssuesPage() {
  const { openMenu, openNotifications } = useLayout()
  const [issues, setIssues] = useState(null)
  const [clients, setClients] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [timeZone, setTimeZone] = useState('UTC')
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [appealTitle, setAppealTitle] = useState('')
  const [error, setError] = useState('')
  const [quickCreate, setQuickCreate] = useState(null)

  async function refresh(selectId = selected?.id) {
    const records = await workspaceApi.listAllIssues()
    setIssues(records)
    if (selectId) {
      const detail = await workspaceApi.getIssue(selectId)
      setSelected(detail)
    }
    setError('')
  }

  useEffect(() => {
    let alive = true
    Promise.all([workspaceApi.listAllIssues(), workspaceApi.listLinkableClients(), workspaceApi.listOrganizations(true), workspaceApi.getPreferences()]).then(([records, clientData, organizationData, preferences]) => {
      if (alive) { setIssues(records); setClients(clientData); setOrganizations(organizationData); setTimeZone(preferences.timezone_name); setError('') }
    }).catch(() => { if (alive) setError('Issues could not be loaded.') })
    return () => { alive = false }
  }, [])

  async function create(event) {
    event.preventDefault(); setError('')
    try {
      const issue = await workspaceApi.createIssue({ ...form, description: form.description || null, deadline: form.deadline || null })
      setForm(EMPTY); await refresh(issue.id)
    } catch (err) { setError(err.message || 'Issue could not be created.') }
  }

  async function open(item) {
    try { setSelected(await workspaceApi.getIssue(item.id)); setError('') } catch { setError('Issue could not be opened.') }
  }

  async function setStatus(status) {
    try { const detail = await workspaceApi.updateIssue(selected.id, { status }); setSelected(detail); await refresh(detail.id); setError('') }
    catch (err) { setError(err.message || 'Issue could not be updated.') }
  }

  async function addAppeal(event) {
    event.preventDefault()
    try {
      await workspaceApi.createAppeal({ issue_id: selected.id, title: appealTitle })
      setAppealTitle(''); await refresh(selected.id); setError('')
    } catch (err) { setError(err.message || 'Appeal could not be created.') }
  }

  const formatWhen = (iso) => new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

  return <MotionConfig reducedMotion="user">
    <TopBar crumbs={['Workspace', 'Issues & Appeals']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page wide ws-page-in">
      <PageHead icon="issues" title="Issues & Appeals" sub="Keep the whole case together. An issue can resolve without an appeal." />
      {error && <p role="alert" className="workspace-error">{error}</p>}
      <div className="phase2-grid">
        <div className="workspace-stack">
          <section className="card workspace-section">
            <h2>New issue</h2>
            <form className="workspace-inline-form" onSubmit={create}>
              <label>Client<select required value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })}><option value="">Choose a client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label>
              <label>Issue title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Prior authorization denied" /></label>
              <label>Deadline<input type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label>
              <label>Description<textarea rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
              <div><button className="btn accent">Create issue</button></div>
            </form>
          </section>
          <section className="card workspace-section">
            <h2>Issue work</h2>
            {!issues && !error && <p role="status" className="workspace-empty">Loading issues…</p>}
            {issues && !issues.length && <p className="workspace-empty">No issues yet.</p>}
            <ul className="workspace-list">
              <AnimatePresence initial={false}>
                {(issues || []).map((item) => (
                  <motion.li
                    key={item.id}
                    layout="position"
                    className={`workspace-list-row ws-issue-row ${selected?.id === item.id ? 'phase2-selected' : ''}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.28, ease: EASE }}
                  >
                    <button className="phase2-row-button" aria-current={selected?.id === item.id ? 'true' : undefined} onClick={() => open(item)}>
                      <span><strong>{item.title}</strong><small>{item.client_name} · <DeadlineLabel iso={item.deadline} resolved={item.status === 'resolved'} timeZone={timeZone} /></small></span>
                    </button>
                    <span className={`chip ${TONE[item.status]}`}>{STATUS[item.status]}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        </div>
        <section className="card workspace-section phase2-detail">
          {!selected && <><h2>Issue details</h2><p className="workspace-empty">Choose an issue to see its deadline, follow-ups, appointments, and appeals.</p></>}
          {selected && <>
            <motion.div key={selected.id} className="ws-detail-in" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }}>
              <div className="eyebrow">{selected.client_name}</div>
              <h2 className="ws-detail-title">{selected.title}</h2>
              <div className="workspace-form-grid ws-detail-meta">
                <label className="workspace-filter">Status<select value={selected.status} onChange={(event) => setStatus(event.target.value)}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <div className="ws-kv"><small>Deadline</small><strong><DeadlineLabel iso={selected.deadline} resolved={selected.status === 'resolved'} timeZone={timeZone} /></strong></div>
              </div>
              {selected.description && <p className="ws-desc">{selected.description}</p>}

              <Linked title="Follow-ups" count={selected.follow_ups.length} action={<button className="btn sm ghost" onClick={() => setQuickCreate('task')}><ListPlus size={14} weight="duotone" /> Add Follow-up</button>}>
                {selected.follow_ups.length ? <ul className="workspace-list">{selected.follow_ups.map((item) => <li className="workspace-list-row" key={item.id}><div className="workspace-row-copy"><strong>{item.title}</strong><small>{item.status}</small></div></li>)}</ul> : <p className="workspace-empty">No linked follow-ups.</p>}
              </Linked>
              <Linked title="Appointments" count={selected.appointments.length} action={<button className="btn sm ghost" onClick={() => setQuickCreate('appointment')}><CalendarPlus size={14} weight="duotone" /> Add Appointment</button>}>
                {selected.appointments.length ? <ul className="workspace-list">{selected.appointments.map((item) => <li className="workspace-list-row" key={item.id}><div className="workspace-row-copy"><strong>{item.title}</strong><small>{formatWhen(item.starts_at)}</small></div></li>)}</ul> : <p className="workspace-empty">No linked appointments.</p>}
              </Linked>
              <Linked title="Appeals" count={selected.appeals.length}>
                {selected.appeals.length ? <ul className="workspace-list">{selected.appeals.map((item) => <li className="workspace-list-row" key={item.id}><details className="workspace-appeal-draft"><summary><strong>{item.title}</strong><span className="chip accent">Draft</span></summary><div className="workspace-appeal-text">{item.draft_text || 'No draft text has been saved yet.'}</div></details></li>)}</ul> : <p className="workspace-empty">No Appeal is required unless the case needs a formal challenge.</p>}
              </Linked>
              <form className="workspace-inline-form phase2-appeal-form" onSubmit={addAppeal}>
                <label>New Appeal title<input required value={appealTitle} onChange={(event) => setAppealTitle(event.target.value)} placeholder="Level 1 reconsideration" /></label>
                <div className="quick-create-actions"><button className="btn">Add Appeal</button><Link className="btn accent" to={`/appeals?issue=${selected.id}`}><PencilSimpleLine size={15} weight="duotone" /> Draft with HealthFlow</Link></div>
              </form>
              {selected.status !== 'resolved' && (
                <div className="quick-create-actions ws-detail-actions">
                  <button className="btn ghost" onClick={() => setStatus('resolved')}><CheckCircle size={15} weight="duotone" /> Mark resolved</button>
                </div>
              )}
            </motion.div>
            <DocumentList key={selected.id} clientId={selected.client_id} targetType="issue" targetId={selected.id} />
            {selected.appeals.map((appeal) => <AppealDocuments key={appeal.id} clientId={selected.client_id} appeal={appeal} />)}
          </>}
        </section>
      </div>
      {quickCreate && selected && <QuickCreateModal mode={quickCreate} initialValues={{ client_id: selected.client_id, issue_id: selected.id, is_follow_up: quickCreate === 'task' }} clients={clients} organizations={organizations} timeZone={timeZone} onClose={() => setQuickCreate(null)} onCreated={async () => { setQuickCreate(null); await refresh(selected.id) }} />}
    </main>
  </MotionConfig>
}
