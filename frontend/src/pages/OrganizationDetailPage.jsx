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
  useEffect(() => {
    let alive = true
    workspaceApi.getOrganization(id).then((data) => { if (alive) setOrganization(data) }).catch(() => { if (alive) setError('Organization could not be loaded.') })
    return () => { alive = false }
  }, [id])
  return <><TopBar crumbs={['Workspace', 'Organizations', organization?.name || 'Details']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><div className="page-head"><div><h1 className="page-title">{organization?.name || 'Organization'}</h1><p className="page-sub">Contacts and shared context.</p></div></div>{error && <p role="alert">{error}</p>}{!organization && !error && <p role="status">Loading organization…</p>}{organization && <section className="card workspace-section"><h2>Contacts</h2>{organization.contacts?.length ? <ul>{organization.contacts.map((contact) => <li key={contact.id}>{contact.full_name}</li>)}</ul> : <p>No contacts yet.</p>}</section>}</main></>
}
