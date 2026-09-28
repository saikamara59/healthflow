import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { workspaceApi } from '../api/workspace'
import TopBar from '../components/TopBar'
import DocumentList from '../components/DocumentList'
import useLayout from '../components/ui/useLayout'
import QuickCreateModal from '../components/workspace/QuickCreateModal'

const EMPTY = { client_id: '', title: '', description: '', deadline: '' }
const STATUS = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_outside_party: 'Waiting on an outside party',
  resolved: 'Resolved',
}

function AppealDocuments({ clientId, appeal }) {
  const [expanded, setExpanded] = useState(false)
  return <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Documents · {appeal.title}</summary>
    {expanded && <DocumentList clientId={clientId} targetType="appeal" targetId={appeal.id} />}
  </details>
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

  return <>
    <TopBar crumbs={['Workspace', 'Issues & Appeals']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page">
      <div className="page-head"><div><h1 className="page-title">Issues &amp; Appeals</h1><p className="page-sub">Keep the whole case together. An Issue can resolve without an Appeal.</p></div></div>
      {error && <p role="alert" className="workspace-error">{error}</p>}
      <div className="phase2-grid">
        <div className="workspace-stack">
          <section className="card workspace-section"><h2>New Issue</h2><form className="workspace-inline-form" onSubmit={create}><label>Client<select required value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })}><option value="">Choose a Client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label><label>Issue title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Deadline<input type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label><label>Description<textarea rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><button className="btn accent">Create Issue</button></form></section>
          <section className="card workspace-section"><h2>Issue work</h2>{!issues && !error && <p role="status">Loading issues…</p>}{issues && !issues.length && <p className="workspace-empty">No Issues yet.</p>}<ul className="workspace-list">{(issues || []).map((item) => <li className={`workspace-list-row ${selected?.id === item.id ? 'phase2-selected' : ''}`} key={item.id}><button className="phase2-row-button" onClick={async () => { try { setSelected(await workspaceApi.getIssue(item.id)); setError('') } catch { setError('Issue could not be opened.') } }}><span><strong>{item.title}</strong><small>{item.client_name} · {STATUS[item.status]}{item.deadline ? ` · Due ${item.deadline}` : ''}</small></span></button></li>)}</ul></section>
        </div>
        <section className="card workspace-section phase2-detail">
          {!selected && <><h2>Issue details</h2><p className="workspace-empty">Choose an Issue to see its deadline, Follow-ups, Appointments, and Appeals.</p></>}
          {selected && <><div className="between"><div><h2>{selected.title}</h2><p className="workspace-small">{selected.client_name}{selected.deadline ? ` · Deadline ${selected.deadline}` : ''}</p></div><span className="workspace-tag">{STATUS[selected.status]}</span></div>{selected.description && <p>{selected.description}</p>}<label className="workspace-filter">Status<select value={selected.status} onChange={(event) => setStatus(event.target.value)}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className="between"><h3 className="workspace-subheading">Follow-ups</h3><button className="btn sm ghost" onClick={() => setQuickCreate('task')}>Add Follow-up</button></div>{selected.follow_ups.length ? <ul className="workspace-list">{selected.follow_ups.map((item) => <li className="workspace-list-row" key={item.id}><div className="workspace-row-copy"><strong>{item.title}</strong><small>{item.status}</small></div></li>)}</ul> : <p className="workspace-empty">No linked Follow-ups.</p>}
            <div className="between"><h3 className="workspace-subheading">Appointments</h3><button className="btn sm ghost" onClick={() => setQuickCreate('appointment')}>Add Appointment</button></div>{selected.appointments.length ? <ul className="workspace-list">{selected.appointments.map((item) => <li className="workspace-list-row" key={item.id}><div className="workspace-row-copy"><strong>{item.title}</strong><small>{new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.starts_at))}</small></div></li>)}</ul> : <p className="workspace-empty">No linked Appointments.</p>}
            <h3 className="workspace-subheading">Appeals</h3>{selected.appeals.length ? <ul className="workspace-list">{selected.appeals.map((item) => <li className="workspace-list-row" key={item.id}><details className="workspace-appeal-draft"><summary><strong>{item.title}</strong><small>Draft</small></summary><div className="workspace-appeal-text">{item.draft_text || 'No draft text has been saved yet.'}</div></details></li>)}</ul> : <p className="workspace-empty">No Appeal is required unless the case needs a formal challenge.</p>}
            <form className="workspace-inline-form phase2-appeal-form" onSubmit={addAppeal}><label>New Appeal title<input required value={appealTitle} onChange={(event) => setAppealTitle(event.target.value)} /></label><div className="quick-create-actions"><button className="btn">Add Appeal</button><Link className="btn accent" to={`/appeals?issue=${selected.id}`}>Draft with HealthFlow</Link></div></form>
            <DocumentList key={selected.id} clientId={selected.client_id} targetType="issue" targetId={selected.id} />
            {selected.appeals.map((appeal) => <AppealDocuments key={appeal.id} clientId={selected.client_id} appeal={appeal} />)}
          </>}
        </section>
      </div>
      {quickCreate && selected && <QuickCreateModal mode={quickCreate} initialValues={{ client_id: selected.client_id, issue_id: selected.id, is_follow_up: quickCreate === 'task' }} clients={clients} organizations={organizations} timeZone={timeZone} onClose={() => setQuickCreate(null)} onCreated={async () => { setQuickCreate(null); await refresh(selected.id) }} />}
    </main>
  </>
}
