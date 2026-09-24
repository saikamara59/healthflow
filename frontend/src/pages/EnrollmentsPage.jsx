import { useEffect, useState } from 'react'
import { workspaceApi } from '../api/workspace'
import TopBar from '../components/TopBar'
import DocumentList from '../components/DocumentList'
import useLayout from '../components/ui/useLayout'

const EMPTY = { client_id: '', plan_name: '', effective_date: '', notes: '' }
const LABELS = {
  preparing: 'Preparing',
  ready_to_submit: 'Ready to submit',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  canceled: 'Canceled',
}

export default function EnrollmentsPage() {
  const { openMenu, openNotifications } = useLayout()
  const [enrollments, setEnrollments] = useState(null)
  const [clients, setClients] = useState([])
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [documentRecord, setDocumentRecord] = useState(null)

  async function refresh(nextFilter = filter) {
    const query = nextFilter ? `status=${encodeURIComponent(nextFilter)}` : ''
    setEnrollments(await workspaceApi.listEnrollments(query))
    setError('')
  }

  useEffect(() => {
    let alive = true
    Promise.all([workspaceApi.listEnrollments(), workspaceApi.listLinkableClients()]).then(([records, clientData]) => {
      if (alive) { setEnrollments(records); setClients(clientData); setError('') }
    }).catch(() => { if (alive) setError('Enrollments could not be loaded.') })
    return () => { alive = false }
  }, [])

  async function save(event) {
    event.preventDefault()
    setSaving(true); setError('')
    const body = { ...form, effective_date: form.effective_date || null, notes: form.notes || null }
    try {
      if (editing) await workspaceApi.updateEnrollment(editing, body)
      else await workspaceApi.createEnrollment(body)
      setEditing(null); setForm(EMPTY); await refresh()
    } catch (err) { setError(err.message || 'Enrollment could not be saved.') }
    finally { setSaving(false) }
  }

  function edit(item) {
    setEditing(item.id)
    setForm({
      client_id: item.client_id,
      plan_name: item.plan_name,
      effective_date: item.effective_date || '',
      notes: item.notes || '',
    })
  }

  async function act(item, action) {
    setError('')
    try {
      if (action === 'ready') await workspaceApi.readyEnrollment(item.id)
      if (action === 'submit') {
        const confirmed = window.confirm(
          'Confirm that you submitted this enrollment outside HealthFlow and the submission succeeded. HealthFlow will only update its record.'
        )
        if (!confirmed) return
        await workspaceApi.submitEnrollment(item.id, true)
      }
      if (action === 'confirm') await workspaceApi.confirmEnrollment(item.id)
      if (action === 'cancel') await workspaceApi.cancelEnrollment(item.id)
      await refresh()
    } catch (err) { setError(err.message || 'Enrollment could not be updated.') }
  }

  return <>
    <TopBar crumbs={['Workspace', 'Enrollments']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page">
      <div className="page-head"><div><h1 className="page-title">Enrollments</h1><p className="page-sub">Prepare and track client enrollments with a Broker review checkpoint.</p></div></div>
      <div className="phase2-grid">
        <section className="card workspace-section">
          <h2>{editing ? 'Edit Enrollment' : 'New Enrollment'}</h2>
          <form className="workspace-inline-form" onSubmit={save}>
            <label>Client<select required value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })}><option value="">Choose a Client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label>
            <label>Plan name<input required value={form.plan_name} onChange={(event) => setForm({ ...form, plan_name: event.target.value })} /></label>
            <label>Effective date<input type="date" value={form.effective_date} onChange={(event) => setForm({ ...form, effective_date: event.target.value })} /></label>
            <label>Notes<textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            <div className="quick-create-actions"><button className="btn accent" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create Enrollment'}</button>{editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm(EMPTY) }}>Cancel edit</button>}</div>
          </form>
          <div className="notice">Ready to submit means the Enrollment has passed your review. HealthFlow does not send applications; you mark Submitted only after an external submission succeeds.</div>
        </section>
        <section className="card workspace-section">
          <div className="between"><h2>Enrollment work</h2><label className="workspace-filter" style={{ margin: 0 }}>Status<select value={filter} onChange={async (event) => { const value = event.target.value; setFilter(value); try { await refresh(value) } catch { setError('Enrollments could not be filtered.') } }}><option value="">All</option>{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          {error && <p role="alert" className="workspace-error">{error}</p>}
          {!enrollments && !error && <p role="status">Loading enrollments…</p>}
          {enrollments && !enrollments.length && <p className="workspace-empty">No Enrollments match this view.</p>}
          {enrollments && <ul className="workspace-list">{enrollments.map((item) => <li className="workspace-list-row" key={item.id}><div className="workspace-row-copy"><strong>{item.client_name} · {item.plan_name}</strong><small>{LABELS[item.status]}{item.effective_date ? ` · Effective ${item.effective_date}` : ''}</small></div><div className="workspace-row-actions"><button className="btn sm ghost" onClick={() => edit(item)}>Edit</button>{item.status === 'preparing' && <button className="btn sm" onClick={() => act(item, 'ready')}>Ready to submit</button>}{item.status === 'ready_to_submit' && <button className="btn sm accent" onClick={() => act(item, 'submit')}>Mark Submitted</button>}{item.status === 'submitted' && <button className="btn sm" onClick={() => act(item, 'confirm')}>Confirm</button>}{!['confirmed', 'canceled'].includes(item.status) && <button className="btn sm ghost" onClick={() => act(item, 'cancel')}>Cancel</button>}</div></li>)}</ul>}
        </section>
      </div>
      {(enrollments || []).map((item) => <details className="card workspace-section" key={item.id} open={documentRecord === item.id} onToggle={(event) => { if (event.currentTarget.open) setDocumentRecord(item.id); else setDocumentRecord((current) => current === item.id ? null : current) }}><summary>Documents · {item.client_name} · {item.plan_name}</summary>{documentRecord === item.id && <DocumentList clientId={item.client_id} targetType="enrollment" targetId={item.id} />}</details>)}
    </main>
  </>
}
