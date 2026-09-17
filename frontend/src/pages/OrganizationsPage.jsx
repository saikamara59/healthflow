import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'

export default function OrganizationsPage() {
  const { openMenu, openNotifications } = useLayout()
  const [organizations, setOrganizations] = useState(null)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('provider_office')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const load = () => workspaceApi.listOrganizations().then(setOrganizations)
  useEffect(() => {
    let alive = true
    workspaceApi.listOrganizations().then((data) => { if (alive) setOrganizations(data) }).catch(() => { if (alive) setError('Organizations could not be loaded.') })
    return () => { alive = false }
  }, [])
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
      setEditing(null); await load()
    } catch (err) { setError(err.message || 'Organization could not be saved.') }
    finally { savingRef.current = false; setSaving(false) }
  }
  async function archive(id) {
    if (!window.confirm('Archive this Organization? Its Contacts will be hidden from the active directory.')) return
    try { await workspaceApi.archiveOrganization(id); await load() } catch (err) { setError(err.message || 'Organization could not be archived.') }
  }
  const shown = (organizations || []).filter((item) => `${item.name} ${item.kind}`.toLowerCase().includes(filter.toLowerCase()))
  return <><TopBar crumbs={['Workspace', 'Organizations']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><div className="page-head"><div><h1 className="page-title">Organizations</h1><p className="page-sub">Carriers, provider offices, employers, and partners.</p></div><button className="btn accent" onClick={() => openForm()}>New Organization</button></div>
    {error && <p role="alert" className="workspace-error">{error}</p>}
    {editing && <form className="card workspace-section workspace-inline-form" onSubmit={save}><h2>{editing === 'new' ? 'New Organization' : 'Edit Organization'}</h2><div className="workspace-form-grid"><label>Organization name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} /></label><label>Kind<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="provider_office">Provider office</option><option value="carrier">Carrier</option><option value="employer">Employer</option><option value="agency">Agency</option><option value="other">Other</option></select></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label>Website<input value={website} onChange={(event) => setWebsite(event.target.value)} /></label></div><label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></label><div className="quick-create-actions"><button type="button" className="btn" disabled={saving} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="btn accent" disabled={saving}>{saving ? 'Saving…' : editing === 'new' ? 'Create Organization' : 'Save Organization'}</button></div></form>}
    {!organizations && !error && <p role="status">Loading organizations…</p>}
    {organizations && <section className="card workspace-section"><label className="workspace-filter">Filter Organizations<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search name or kind" /></label>{shown.length ? <ul className="workspace-list">{shown.map((item) => <li className="workspace-list-row" key={item.id}><div className="workspace-row-copy"><Link to={`/organizations/${item.id}`}>{item.name}</Link><small>{item.kind.replace('_', ' ')} · {item.contact_count} contacts</small></div><button className="btn sm ghost" onClick={() => openForm(item)}>Edit</button><button className="btn sm ghost" onClick={() => archive(item.id)}>Archive</button></li>)}</ul> : <p className="workspace-empty">No organizations match.</p>}</section>}
  </main></>
}
