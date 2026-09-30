import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Archive, ArrowCounterClockwise, ArrowSquareOut, CaretRight, PencilSimple, Plus, X } from '@phosphor-icons/react'
import TopBar from '../components/TopBar'
import OrgLogo, { COMMON_CARRIERS } from '../components/ui/OrgLogo'
import PageHead from '../components/ui/PageHead'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'

const KINDS = [['provider_office', 'Provider office'], ['carrier', 'Carrier'], ['employer', 'Employer'], ['agency', 'Agency'], ['other', 'Other']]
const kindLabel = (kind) => (KINDS.find(([value]) => value === kind) || [kind, kind.replace('_', ' ')])[1]
const EMPTY_CONTACT = { full_name: '', role: '', email: '', phone: '' }
const EASE = [0.22, 1, 0.36, 1]
const SPRING = { type: 'spring', stiffness: 420, damping: 32 }

// One-click chips for common carriers the broker has not added yet.
const missingCarriers = (organizations) => {
  const have = new Set(organizations.map((item) => item.name.trim().toLowerCase()))
  return COMMON_CARRIERS.filter((carrier) => !have.has(carrier.name.toLowerCase()))
}

function CarrierQuickAdd({ missing, onAdded, onError, prominent }) {
  const [adding, setAdding] = useState(() => new Set())
  const addingRef = useRef(new Set())
  async function add(carrier) {
    if (addingRef.current.has(carrier.name)) return
    addingRef.current.add(carrier.name)
    setAdding(new Set(addingRef.current))
    try {
      const created = await workspaceApi.createOrganization({ name: carrier.name, kind: 'carrier', website: carrier.website, phone: null, notes: null })
      await onAdded(created?.id)
    } catch (err) {
      onError(err.message || `${carrier.name} could not be added.`)
    } finally {
      addingRef.current.delete(carrier.name)
      setAdding(new Set(addingRef.current))
    }
  }
  return (
    <motion.div
      layout
      className={`ws-carriers${prominent ? ' prominent' : ''}`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0 }}
      transition={{ duration: 0.3, ease: EASE, layout: SPRING }}
      style={{ overflow: 'hidden' }}
    >
      <motion.div layout="position" className="ws-carriers-copy">
        <strong>{prominent ? 'Add the carriers you work with' : 'Add a carrier'}</strong>
        {prominent && <small>One click creates the carrier. Add contacts to it afterward.</small>}
      </motion.div>
      <div className="ws-carriers-chips">
        <AnimatePresence mode="popLayout" initial>
          {missing.map((carrier, index) => (
            <motion.button
              key={carrier.name}
              layout
              type="button"
              className={`ws-carrier-chip${adding.has(carrier.name) ? ' adding' : ''}`}
              disabled={adding.has(carrier.name)}
              onClick={() => add(carrier)}
              aria-label={`Add ${carrier.name}`}
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: 0.04 * index, duration: 0.32, ease: EASE } }}
              exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2 } }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.95 }}
              transition={SPRING}
            >
              <OrgLogo name={carrier.name} website={carrier.website} size={24} />
              {carrier.name}
              <Plus className="ws-carrier-plus" size={12} weight="bold" aria-hidden="true" />
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

// Expanded row: the organization's contacts, loaded on open, plus a quick add form.
function OrganizationContacts({ organization, onChanged }) {
  const [detail, setDetail] = useState(null)
  const [contact, setContact] = useState(EMPTY_CONTACT)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const load = () => workspaceApi.getOrganization(organization.id).then(setDetail)
  useEffect(() => {
    let alive = true
    workspaceApi.getOrganization(organization.id)
      .then((data) => { if (alive) setDetail(data) })
      .catch(() => { if (alive) setError('Contacts could not be loaded.') })
    return () => { alive = false }
  }, [organization.id])
  const set = (key) => (event) => setContact({ ...contact, [key]: event.target.value })
  async function addContact(event) {
    event.preventDefault()
    if (savingRef.current || !contact.full_name.trim()) return
    savingRef.current = true
    setSaving(true)
    setError('')
    const body = {
      full_name: contact.full_name.trim(), role: contact.role.trim() || null,
      email: contact.email.trim() || null, phone: contact.phone.trim() || null,
    }
    try {
      await workspaceApi.createContact(organization.id, body)
      setContact(EMPTY_CONTACT)
    } catch (err) { setError(err.message || 'Contact could not be saved.'); return }
    finally { savingRef.current = false; setSaving(false) }
    try { await load(); onChanged() }
    catch { setError('Contact saved, but the list could not refresh. Reload to see the update.') }
  }
  const contacts = (detail?.contacts || []).filter((item) => !item.archived_at)
  const website = organization.website
  return (
    <motion.div
      className="ws-org-body-wrap"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      style={{ overflow: 'hidden' }}
    >
    <div className="ws-org-body">
      {(organization.phone || website || organization.notes) && (
        <div className="ws-org-meta">
          {organization.phone && <span>{organization.phone}</span>}
          {website && (/^https?:\/\//i.test(website) ? <a href={website} target="_blank" rel="noreferrer">{website.replace(/^https?:\/\//i, '')}</a> : <span>{website}</span>)}
          {organization.notes && <span>{organization.notes}</span>}
        </div>
      )}
      {error && <p role="alert" className="workspace-error">{error}</p>}
      {!detail && !error && <p role="status" className="workspace-empty">Loading contacts…</p>}
      {detail && (contacts.length ? (
        <div className="ws-contacts">
          {contacts.map((item) => (
            <div key={item.id} className="ws-contact">
              <strong>{item.full_name}</strong>
              <small>{item.role || 'No role'}</small>
              <small>{item.email || 'No email'}</small>
              <small>{item.phone || 'No phone'}</small>
            </div>
          ))}
        </div>
      ) : <p className="workspace-empty">No contacts yet.</p>)}
      <form className="workspace-inline-form ws-contact-form" onSubmit={addContact}>
        <input placeholder="Contact name" aria-label="Contact name" value={contact.full_name} onChange={set('full_name')} maxLength={200} />
        <input placeholder="Role" aria-label="Role" value={contact.role} onChange={set('role')} />
        <input placeholder="Email" aria-label="Email" type="email" value={contact.email} onChange={set('email')} />
        <input placeholder="Phone" aria-label="Phone" value={contact.phone} onChange={set('phone')} />
        <button className="btn" disabled={saving || !contact.full_name.trim()}>{saving ? 'Adding…' : 'Add contact'}</button>
      </form>
    </div>
    </motion.div>
  )
}

export default function OrganizationsPage() {
  const { openMenu, openNotifications } = useLayout()
  const [organizations, setOrganizations] = useState(null)
  const [filter, setFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [open, setOpen] = useState(null)
  const [justAdded, setJustAdded] = useState(null)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('provider_office')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const load = () => workspaceApi.listOrganizations(false, showArchived).then((data) => { setOrganizations(data); setError('') })
  useEffect(() => {
    let alive = true
    setOrganizations(null)
    setOpen(null)
    workspaceApi.listOrganizations(false, showArchived).then((data) => { if (alive) { setOrganizations(data); setError('') } }).catch(() => { if (alive) setError('Organizations could not be loaded.') })
    return () => { alive = false }
  }, [showArchived])
  function openForm(item = {}) {
    setEditing(item.id || 'new'); setName(item.name || ''); setKind(item.kind || 'provider_office'); setPhone(item.phone || ''); setWebsite(item.website || ''); setNotes(item.notes || ''); setError('')
  }
  async function save(event) {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const body = { name: name.trim(), kind, phone: phone.trim() || null, website: website.trim() || null, notes: notes.trim() || null }
      if (editing === 'new') await workspaceApi.createOrganization(body)
      else await workspaceApi.updateOrganization(editing, body)
      setEditing(null)
    } catch (err) { setError(err.message || 'Organization could not be saved.'); return }
    finally { savingRef.current = false; setSaving(false) }
    try { await load() }
    catch { setError('Organization saved, but the list could not refresh. Reload to see the update.') }
  }
  async function archive(id) {
    if (!window.confirm('Archive this Organization? Its Contacts will be hidden from the active directory.')) return
    try { await workspaceApi.archiveOrganization(id); await load() } catch (err) { setError(err.message || 'Organization could not be archived.') }
  }
  async function restore(id) {
    try { await workspaceApi.restoreOrganization(id); await load() } catch (err) { setError(err.message || 'Organization could not be restored.') }
  }
  const refreshQuietly = () => load().catch(() => {})
  const carrierAdded = async (id) => {
    await refreshQuietly()
    if (id) setJustAdded(id)
  }
  useEffect(() => {
    if (!justAdded) return undefined
    const timer = setTimeout(() => setJustAdded(null), 1600)
    return () => clearTimeout(timer)
  }, [justAdded])
  const missing = organizations && !showArchived && !filter ? missingCarriers(organizations) : []
  const shown = (organizations || []).filter((item) => Boolean(item.archived_at) === showArchived && `${item.name} ${kindLabel(item.kind)}`.toLowerCase().includes(filter.toLowerCase()))
  return (
    <MotionConfig reducedMotion="user">
      <TopBar crumbs={['Workspace', 'Organizations']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
      <main className="page ws-page-in">
        <PageHead
          icon="orgs"
          title="Organizations"
          sub="Carriers, provider offices, employers, and partners."
          actions={<button className="btn accent" onClick={() => openForm()}><Plus size={15} weight="bold" /> New organization</button>}
        />
        {error && <p role="alert" className="workspace-error">{error}</p>}
        {editing && (
          <form className="card workspace-section workspace-inline-form ws-new" onSubmit={save}>
            <div className="between">
              <h2>{editing === 'new' ? 'New organization' : 'Edit organization'}</h2>
              <button type="button" className="btn ghost icon sm" disabled={saving} onClick={() => setEditing(null)} aria-label="Close"><X size={16} weight="bold" /></button>
            </div>
            <div className="workspace-form-grid">
              <label>Organization name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} autoFocus /></label>
              <label>Kind<select value={kind} onChange={(event) => setKind(event.target.value)}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
              <label>Website<input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="example.com" /></label>
            </div>
            <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></label>
            <div className="quick-create-actions">
              <button type="button" className="btn" disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn accent" disabled={saving}>{saving ? 'Saving…' : editing === 'new' ? 'Create organization' : 'Save organization'}</button>
            </div>
          </form>
        )}
        <section className="card workspace-section">
          <div className="ws-filter-row">
            <label className="workspace-filter">Filter organizations<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search name or kind" /></label>
            <div className="ws-seg" role="group" aria-label="Organization status">
              <button type="button" className={!showArchived ? 'on' : ''} aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>Active</button>
              <button type="button" className={showArchived ? 'on' : ''} aria-pressed={showArchived} onClick={() => setShowArchived(true)}>Archived</button>
            </div>
          </div>
          {!organizations && !error && <p role="status" className="workspace-empty">Loading organizations…</p>}
          <AnimatePresence initial={false}>
            {missing.length > 0 && (
              <CarrierQuickAdd key="carriers" missing={missing} onAdded={carrierAdded} onError={setError} prominent={!organizations.some((item) => !item.archived_at)} />
            )}
          </AnimatePresence>
          {organizations && !shown.length && (showArchived || filter) && <p className="workspace-empty">{showArchived ? 'No archived organizations.' : 'No organizations match.'}</p>}
          {organizations && shown.length > 0 && (
            <ul className="workspace-list">
              <AnimatePresence>
              {shown.map((item, index) => {
                const expanded = open === item.id && !showArchived
                return (
                  <motion.li
                    key={item.id}
                    layout="position"
                    className={`ws-org${justAdded === item.id ? ' ws-org-new' : ''}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE, delay: Math.min(index, 8) * 0.03 } }}
                    exit={{ opacity: 0, x: -16, transition: { duration: 0.2 } }}
                    transition={SPRING}
                  >
                    <div className="ws-org-head">
                      <button type="button" className="phase2-row-button" aria-expanded={expanded} disabled={showArchived} onClick={() => setOpen(expanded ? null : item.id)}>
                        {!showArchived && <CaretRight className="ws-org-caret" size={14} weight="bold" aria-hidden="true" />}
                        <OrgLogo name={item.name} website={item.website} />
                        <span><strong>{item.name}</strong><small>{item.contact_count} contact{item.contact_count === 1 ? '' : 's'}</small></span>
                      </button>
                      <span className="workspace-tag">{kindLabel(item.kind)}</span>
                      <Link className="btn ghost icon sm" to={`/organizations/${item.id}`} aria-label={`Open ${item.name}`} title="Open details"><ArrowSquareOut size={16} weight="duotone" /></Link>
                      {showArchived
                        ? <button className="btn sm" onClick={() => restore(item.id)}><ArrowCounterClockwise size={14} weight="duotone" /> Restore</button>
                        : <>
                          <button className="btn ghost icon sm" onClick={() => openForm(item)} aria-label={`Edit ${item.name}`} title="Edit"><PencilSimple size={16} weight="duotone" /></button>
                          <button className="btn sm" onClick={() => archive(item.id)}><Archive size={14} weight="duotone" /> Archive</button>
                        </>}
                    </div>
                    <AnimatePresence initial={false}>
                      {expanded && <OrganizationContacts key="contacts" organization={item} onChanged={refreshQuietly} />}
                    </AnimatePresence>
                  </motion.li>
                )
              })}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </main>
    </MotionConfig>
  )
}
