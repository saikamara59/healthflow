import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { CheckCircle, PaperPlaneTilt, PencilSimple, Prohibit, SealCheck } from '@phosphor-icons/react'
import { workspaceApi } from '../api/workspace'
import TopBar from '../components/TopBar'
import DocumentList from '../components/DocumentList'
import PageHead from '../components/ui/PageHead'
import { PlanLogo } from '../components/ui/OrgLogo'
import useLayout from '../components/ui/useLayout'

const EMPTY = { client_id: '', plan_name: '', effective_date: '', notes: '' }
const LABELS = {
  preparing: 'Preparing',
  ready_to_submit: 'Ready to submit',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  canceled: 'Canceled',
}
const TONE = { preparing: '', ready_to_submit: 'warn', submitted: 'accent', confirmed: 'pos', canceled: 'neg' }
const STEPS = ['preparing', 'ready_to_submit', 'submitted', 'confirmed']
const EASE = [0.22, 1, 0.36, 1]

const formatDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set')

function Progress({ status }) {
  const reached = status === 'canceled' ? -1 : STEPS.indexOf(status)
  return (
    <div className="ws-steps" aria-label={`Progress: ${LABELS[status]}`}>
      {STEPS.map((step, index) => <span key={step} className={index <= reached ? 'on' : ''}>{LABELS[step]}</span>)}
    </div>
  )
}

// The broker attests to the outside submission here; HealthFlow never sends applications.
function SubmitCheckpoint({ onSubmit, busy }) {
  const [confirmed, setConfirmed] = useState(false)
  return (
    <div className="workspace-link-suggestion ws-review">
      <div>
        <strong>Broker review checkpoint</strong>
        <small>Submit the application in the carrier portal, then record it here.</small>
        <label className="ws-confirm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I confirm the external submission succeeded
        </label>
      </div>
      <button className="btn sm accent" disabled={!confirmed || busy} onClick={onSubmit}>
        <PaperPlaneTilt size={14} weight="duotone" /> Record as submitted
      </button>
    </div>
  )
}

export default function EnrollmentsPage() {
  const { openMenu, openNotifications } = useLayout()
  const [enrollments, setEnrollments] = useState(null)
  const [clients, setClients] = useState([])
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [documentRecord, setDocumentRecord] = useState(null)
  const formRef = useRef(null)
  // Only the newest list request may update the page: the Status filter is
  // usable while the initial list loads, and a late response must not replace a
  // newer filter's result or clear its error.
  const listGeneration = useRef(0)

  async function refresh(nextFilter = filter) {
    const generation = ++listGeneration.current
    const query = nextFilter ? `status=${encodeURIComponent(nextFilter)}` : ''
    const records = await workspaceApi.listEnrollments(query)
    if (generation !== listGeneration.current) return
    setEnrollments(records)
    setError('')
  }

  async function applyFilter(value) {
    setFilter(value)
    const generation = listGeneration.current + 1
    try {
      await refresh(value)
    } catch {
      if (generation === listGeneration.current) setError('Enrollments could not be filtered.')
    }
  }

  useEffect(() => {
    let alive = true
    const generation = ++listGeneration.current
    Promise.all([workspaceApi.listEnrollments(), workspaceApi.listLinkableClients()]).then(([records, clientData]) => {
      if (!alive) return
      setClients(clientData)
      if (generation === listGeneration.current) { setEnrollments(records); setError('') }
    }).catch(() => { if (alive && generation === listGeneration.current) setError('Enrollments could not be loaded.') })
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
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function act(item, action) {
    setError('')
    setBusy(item.id)
    try {
      if (action === 'ready') await workspaceApi.readyEnrollment(item.id)
      if (action === 'submit') await workspaceApi.submitEnrollment(item.id, true)
      if (action === 'confirm') await workspaceApi.confirmEnrollment(item.id)
      if (action === 'cancel') {
        if (!window.confirm(`Cancel the ${item.plan_name} enrollment for ${item.client_name}?`)) return
        await workspaceApi.cancelEnrollment(item.id)
      }
      await refresh()
    } catch (err) { setError(err.message || 'Enrollment could not be updated.') }
    finally { setBusy(null) }
  }

  return <MotionConfig reducedMotion="user">
    <TopBar crumbs={['Workspace', 'Enrollments']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page wide ws-page-in">
      <PageHead icon="enroll" title="Enrollments" sub="Prepare and track client enrollments with a broker review checkpoint." />
      <div className="phase2-grid">
        <section className="card workspace-section" ref={formRef}>
          <h2>{editing ? 'Edit enrollment' : 'New enrollment'}</h2>
          <form className="workspace-inline-form" onSubmit={save}>
            <label>Client<select required value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })}><option value="">Choose a client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label>
            <label>Plan name<input required value={form.plan_name} onChange={(event) => setForm({ ...form, plan_name: event.target.value })} placeholder="Aetna Medicare Prime HMO" /></label>
            <label>Effective date<input type="date" value={form.effective_date} onChange={(event) => setForm({ ...form, effective_date: event.target.value })} /></label>
            <label>Notes<textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            <div className="quick-create-actions"><button className="btn accent" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create enrollment'}</button>{editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm(EMPTY) }}>Cancel edit</button>}</div>
          </form>
          <p className="ws-note">Ready to submit means the enrollment has passed your review. HealthFlow does not send applications. You mark it Submitted only after an external submission succeeds.</p>
        </section>
        <section className="card workspace-section">
          <div className="between ws-sec-head">
            <h2>Enrollment work</h2>
            <label className="workspace-filter ws-inline-filter">Status<select value={filter} onChange={(event) => applyFilter(event.target.value)}><option value="">All</option>{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          {error && <p role="alert" className="workspace-error">{error}</p>}
          {!enrollments && !error && <p role="status" className="workspace-empty">Loading enrollments…</p>}
          {enrollments && !enrollments.length && <p className="workspace-empty">No enrollments match this view.</p>}
          {enrollments && (
            <ul className="workspace-list">
              <AnimatePresence initial={false}>
                {enrollments.map((item) => (
                  <motion.li
                    key={item.id}
                    layout="position"
                    className="workspace-list-row ws-enr"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.28, ease: EASE }}
                  >
                    <PlanLogo planName={item.plan_name} size={40} />
                    <div className="workspace-row-copy">
                      <div className="between ws-enr-head">
                        <strong>{item.client_name}</strong>
                        <motion.span key={item.status} className={`chip ${TONE[item.status]}`} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>{LABELS[item.status]}</motion.span>
                      </div>
                      <small>{item.plan_name} · Effective {formatDate(item.effective_date)}</small>
                      {item.notes && <small>{item.notes}</small>}
                      <Progress status={item.status} />
                      {item.status === 'ready_to_submit' && <SubmitCheckpoint busy={busy === item.id} onSubmit={() => act(item, 'submit')} />}
                      <div className="quick-create-actions ws-enr-actions">
                        {item.status === 'preparing' && <button className="btn sm" disabled={busy === item.id} onClick={() => act(item, 'ready')}><CheckCircle size={14} weight="duotone" /> Mark ready to submit</button>}
                        {item.status === 'submitted' && <button className="btn sm" disabled={busy === item.id} onClick={() => act(item, 'confirm')}><SealCheck size={14} weight="duotone" /> Mark confirmed</button>}
                        <button className="btn sm ghost" onClick={() => edit(item)}><PencilSimple size={14} weight="duotone" /> Edit</button>
                        {!['confirmed', 'canceled'].includes(item.status) && <button className="btn sm ghost danger" disabled={busy === item.id} onClick={() => act(item, 'cancel')}><Prohibit size={14} weight="duotone" /> Cancel</button>}
                      </div>
                      <details className="ws-row-docs" open={documentRecord === item.id} onToggle={(event) => { if (event.currentTarget.open) setDocumentRecord(item.id); else setDocumentRecord((current) => current === item.id ? null : current) }}>
                        <summary>Documents · {item.client_name} · {item.plan_name}</summary>
                        {documentRecord === item.id && <DocumentList clientId={item.client_id} targetType="enrollment" targetId={item.id} />}
                      </details>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </div>
    </main>
  </MotionConfig>
}
