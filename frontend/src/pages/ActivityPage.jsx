import { useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import api from '../api/client'
import { workspaceApi } from '../api/workspace'
import TopBar from '../components/TopBar'
import PageHead from '../components/ui/PageHead'
import useLayout from '../components/ui/useLayout'
import { ActivityRow, activityFromTool, activityFromWorkspace } from '../components/workspace/ActivityRow'

const FILTERS = [['All', () => true], ['Workspace', (item) => item.source === 'Workspace'], ['Tools', (item) => item.source === 'Tool']]

function dayLabel(iso) {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86400000)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) })
}

/** Lists completed workspace activity grouped by the day it was recorded. */
export default function ActivityPage() {
  const { openMenu, openNotifications } = useLayout()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState('All')

  useEffect(() => {
    let alive = true
    Promise.allSettled([api.get('/history?limit=200'), workspaceApi.listActivity()])
      .then(([tools, workspace]) => {
        if (!alive) return
        const failures = Number(tools.status === 'rejected') + Number(workspace.status === 'rejected')
        if (failures === 2) setLoadError('Activity could not be loaded. Try refreshing the page.')
        else if (failures === 1) setLoadError('Some activity could not be loaded. This timeline may be incomplete.')
        const toolEntries = tools.status === 'fulfilled' && Array.isArray(tools.value) ? tools.value : []
        const workspaceEntries = workspace.status === 'fulfilled' && Array.isArray(workspace.value) ? workspace.value : []
        setItems([
          ...toolEntries.map(activityFromTool),
          ...workspaceEntries.map(activityFromWorkspace),
        ].sort((a, b) => new Date(b.date) - new Date(a.date)))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const test = FILTERS.find(([label]) => label === filter)[1]
  const shown = items.filter(test)
  const days = []
  for (const item of shown) {
    const label = dayLabel(item.date)
    const last = days[days.length - 1]
    if (last && last.label === label) last.items.push(item)
    else days.push({ label, items: [item] })
  }
  const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return <MotionConfig reducedMotion="user">
    <TopBar crumbs={['Account', 'Activity']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page ws-page-in">
      <PageHead
        icon="history"
        eyebrow={loading ? null : `${items.length} recorded activit${items.length === 1 ? 'y' : 'ies'}`}
        title="Activity"
        sub="Completed tasks, appointments, and tool work across your workspace, grouped by day."
      />
      {!loading && items.length > 0 && (
        <div className="ws-pills ov-pad" role="tablist" aria-label="Filter activity">
          {FILTERS.map(([label, match]) => (
            <button key={label} role="tab" aria-selected={filter === label} className={`ws-pill ${filter === label ? 'on' : ''}`} onClick={() => setFilter(label)}>
              {label}<span>{items.filter(match).length}</span>
            </button>
          ))}
        </div>
      )}
      {loading && <p role="status" className="workspace-empty">Loading activity…</p>}
      {loadError && <p role="alert" className="workspace-error">{loadError}</p>}
      {!loading && !loadError && items.length === 0 && (
        <div className="card cl-empty">
          <div className="empty-title">Nothing logged yet</div>
          <div>Complete a task, update an appointment, or run a tool to start a timeline.</div>
        </div>
      )}
      {!loading && items.length > 0 && !shown.length && <div className="card cl-empty">No {filter.toLowerCase()} activity yet.</div>}
      <AnimatePresence mode="popLayout" initial={false}>
        {days.map((day) => (
          <motion.section key={`${filter}-${day.label}`} className="card workspace-section ws-activity-day" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <div className="between"><h2>{day.label}</h2><span className="workspace-count">{day.items.length}</span></div>
            <ul className="workspace-list">{day.items.map((item) => <ActivityRow key={item.id} item={item} time={time(item.date)} />)}</ul>
          </motion.section>
        ))}
      </AnimatePresence>
    </main>
  </MotionConfig>
}
