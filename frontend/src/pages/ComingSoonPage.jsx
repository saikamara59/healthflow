import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar'
import HfTile from '../components/ui/HfTile'
import useLayout from '../components/ui/useLayout'

// Placeholder for sidebar destinations that are designed but not built yet.
export default function ComingSoonPage({ group, title, icon, description }) {
  const { openMenu, openNotifications } = useLayout()
  return <>
    <TopBar crumbs={[group, title]} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page">
      <div className="page-head"><div>
        <div className="ws-title-row"><HfTile icon={icon} large /><h1 className="page-title">{title}</h1></div>
        <p className="page-sub">{description}</p>
      </div></div>
      <section className="card workspace-section">
        <h2>Coming soon</h2>
        <p className="workspace-small">This part of HealthFlow isn't available yet. <Link to="/today">Back to Today</Link></p>
      </section>
    </main>
  </>
}
