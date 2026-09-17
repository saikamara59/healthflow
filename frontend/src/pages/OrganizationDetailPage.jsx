import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import TopBar from '../components/TopBar'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'

export default function OrganizationDetailPage() {
  const { id } = useParams()
  const { openMenu, openNotifications } = useLayout()
  const [organization, setOrganization] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const activeIdRef = useRef(id)
  activeIdRef.current = id
  const load = (organizationId = id) => workspaceApi.getOrganization(organizationId).then((data) => {
    if (activeIdRef.current === organizationId) setOrganization(data)
  })
  useEffect(() => {
    let alive = true
    setOrganization(null)
    setEditing(null)
    setError('')
    workspaceApi.getOrganization(id).then((data) => { if (alive) setOrganization(data) }).catch(() => { if (alive) setError('Organization could not be loaded.') })
    return () => { alive = false }
  }, [id])
  useEffect(() => {
    if (!organization || organization.id !== id || !window.location.hash.startsWith('#contact-')) return
    const target = document.getElementById(window.location.hash.slice(1))
    target?.scrollIntoView({ block: 'center' })
    target?.focus()
  }, [organization, id])
  function openForm(contact = {}) {
    setEditing(contact.id || 'new'); setFullName(contact.full_name || ''); setRole(contact.role || ''); setEmail(contact.email || ''); setPhone(contact.phone || ''); setError('')
  }
  async function save(event) {
    event.preventDefault()
    if (savingRef.current) return
    const organizationId = id
    savingRef.current = true
    setSaving(true)
    setError('')
    const body = { full_name: fullName.trim(), role: role.trim() || null, email: email.trim() || null, phone: phone.trim() || null }
    try {
      if (editing === 'new') await workspaceApi.createContact(organizationId, body)
      else await workspaceApi.updateContact(organizationId, editing, body)
      if (activeIdRef.current === organizationId) setEditing(null)
    } catch (err) { if (activeIdRef.current === organizationId) setError(err.message || 'Contact could not be saved.'); return }
    finally { savingRef.current = false; setSaving(false) }
    try { await load(organizationId) }
    catch { if (activeIdRef.current === organizationId) setError('Contact saved, but the list could not refresh. Reload to see the update.') }
  }
  async function archive(contactId) {
    if (!window.confirm('Archive this Contact?')) return
    const organizationId = id
    try { await workspaceApi.archiveContact(organizationId, contactId); await load(organizationId) }
    catch (err) { if (activeIdRef.current === organizationId) setError(err.message || 'Contact could not be archived.') }
  }
  const visibleOrganization = organization?.id === id ? organization : null
  const contacts = (visibleOrganization?.contacts || []).filter((item) => !item.archived_at)
  return <><TopBar crumbs={['Workspace', 'Organizations', visibleOrganization?.name || 'Details']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><div className="page-head"><div><h1 className="page-title">{visibleOrganization?.name || 'Organization'}</h1><p className="page-sub">Contacts and shared context.</p></div>{visibleOrganization && <button className="btn accent" disabled={saving} onClick={() => openForm()}>New Contact</button>}</div>
    {error && <p role="alert" className="workspace-error">{error}</p>}{!visibleOrganization && !error && <p role="status">Loading organization…</p>}
    {visibleOrganization && <><section className="card workspace-section"><h2>Organization details</h2><p>{visibleOrganization.kind.replace('_', ' ')}{visibleOrganization.phone ? ` · ${visibleOrganization.phone}` : ''}</p>{visibleOrganization.website && <p>{/^https?:\/\//i.test(visibleOrganization.website) ? <a href={visibleOrganization.website} target="_blank" rel="noreferrer">Website</a> : visibleOrganization.website}</p>}{visibleOrganization.notes && <p>{visibleOrganization.notes}</p>}</section>
      {editing && <form className="card workspace-section workspace-inline-form" onSubmit={save}><h2>{editing === 'new' ? 'New Contact' : 'Edit Contact'}</h2><div className="workspace-form-grid"><label>Contact name<input value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={200} /></label><label>Role<input value={role} onChange={(event) => setRole(event.target.value)} /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label></div><div className="quick-create-actions"><button type="button" className="btn" disabled={saving} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="btn accent" disabled={saving}>{saving ? 'Saving…' : editing === 'new' ? 'Create Contact' : 'Save Contact'}</button></div></form>}
      <section className="card workspace-section"><h2>Contacts</h2>{contacts.length ? <ul className="workspace-list">{contacts.map((contact) => <li className="workspace-list-row" id={`contact-${contact.id}`} tabIndex={-1} key={contact.id}><div className="workspace-row-copy"><strong>{contact.full_name}</strong><small>{[contact.role, contact.email, contact.phone].filter(Boolean).join(' · ')}</small></div><button className="btn sm ghost" disabled={saving} onClick={() => openForm(contact)}>Edit</button><button className="btn sm ghost" disabled={saving} onClick={() => archive(contact.id)}>Archive</button></li>)}</ul> : <p className="workspace-empty">No contacts yet.</p>}</section>
    </>}
  </main></>
}
