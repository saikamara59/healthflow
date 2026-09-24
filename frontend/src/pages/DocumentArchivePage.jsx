import DocumentList from '../components/DocumentList'
import TopBar from '../components/TopBar'
import useLayout from '../components/ui/useLayout'

export default function DocumentArchivePage() {
  const { openMenu, openNotifications } = useLayout()
  return <><TopBar crumbs={['Workspace', 'Document archive']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><h1 className="page-title">Document archive</h1><p className="page-sub">Open or restore archived Documents. Restoring preserves active Links.</p><DocumentList /></main></>
}
