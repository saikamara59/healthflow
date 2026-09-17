import { useEffect, useState } from 'react'
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
  const load = () => workspaceApi.getOrganization(id).then(setOrganization)
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
    event.preventDefault(); setError('')
    const body = { full_name: fullName.trim(), role: role.trim() || null, email: email.trim() || null, phone: phone.trim() || null }
    try {
      if (editing === 'new') await workspaceApi.createContact(id, body)
      else await workspaceApi.updateContact(id, editing, body)
      setEditing(null); await load()
    } catch (err) { setError(err.message || 'Contact could not be saved.') }
  }
  async function archive(contactId) {
    if (!window.confirm('Archive this Contact?')) return
    try { await workspaceApi.archiveContact(id, contactId); await load() } catch (err) { setError(err.message || 'Contact could not be archived.') }
  }
  const visibleOrganization = organization?.id === id ? organization : null
  const contacts = (visibleOrganization?.contacts || []).filter((item) => !item.archived_at)
  return <><TopBar crumbs={['Workspace', 'Organizations', visibleOrganization?.name || 'Details']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><div className="page-head"><div><h1 className="page-title">{visibleOrganization?.name || 'Organization'}</h1><p className="page-sub">Contacts and shared context.</p></div>{visibleOrganization && <button className="btn accent" onClick={() => openForm()}>New Contact</button>}</div>
    {error && <p role="alert" className="workspace-error">{error}</p>}{!visibleOrganization && !error && <p role="status">Loading organization…</p>}
    {visibleOrganization && <><section className="card workspace-section"><h2>Organization details</h2><p>{visibleOrganization.kind.replace('_', ' ')}{visibleOrganization.phone ? ` · ${visibleOrganization.phone}` : ''}</p>{visibleOrganization.website && <p>{/^https?:\/\//i.test(visibleOrganization.website) ? <a href={visibleOrganization.website} target="_blank" rel="noreferrer">Website</a> : visibleOrganization.website}</p>}{visibleOrganization.notes && <p>{visibleOrganization.notes}</p>}</section>
      {editing && <form className="card workspace-section workspace-inline-form" onSubmit={save}><h2>{editing === 'new' ? 'New Contact' : 'Edit Contact'}</h2><div className="workspace-form-grid"><label>Contact name<input value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={200} /></label><label>Role<input value={role} onChange={(event) => setRole(event.target.value)} /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label></div><div className="quick-create-actions"><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="btn accent">{editing === 'new' ? 'Create Contact' : 'Save Contact'}</button></div></form>}
      <section className="card workspace-section"><h2>Contacts</h2>{contacts.length ? <ul className="workspace-list">{contacts.map((contact) => <li className="workspace-list-row" id={`contact-${contact.id}`} tabIndex={-1} key={contact.id}><div className="workspace-row-copy"><strong>{contact.full_name}</strong><small>{[contact.role, contact.email, contact.phone].filter(Boolean).join(' · ')}</small></div><button className="btn sm ghost" onClick={() => openForm(contact)}>Edit</button><button className="btn sm ghost" onClick={() => archive(contact.id)}>Archive</button></li>)}</ul> : <p className="workspace-empty">No contacts yet.</p>}</section>
    </>}
  </main></>
}
