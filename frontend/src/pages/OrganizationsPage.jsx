import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'

export default function OrganizationsPage() {
  const { openMenu, openNotifications } = useLayout()
  const [organizations, setOrganizations] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    workspaceApi.listOrganizations().then((data) => { if (alive) setOrganizations(data) }).catch(() => { if (alive) setError('Organizations could not be loaded.') })
    return () => { alive = false }
  }, [])
  return <><TopBar crumbs={['Workspace', 'Organizations']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><div className="page-head"><div><h1 className="page-title">Organizations</h1><p className="page-sub">Carriers, provider offices, employers, and partners.</p></div></div>{error && <p role="alert">{error}</p>}{!organizations && !error && <p role="status">Loading organizations…</p>}{organizations && <section className="card workspace-section">{organizations.length ? <ul>{organizations.map((item) => <li key={item.id}><Link to={`/organizations/${item.id}`}>{item.name}</Link></li>)}</ul> : <p>No organizations yet.</p>}</section>}</main></>
}
