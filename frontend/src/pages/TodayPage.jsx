import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../api/client'
import TopBar from '../components/TopBar'
import Icon from '../components/ui/Icon'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'
import TaskList from '../components/workspace/TaskList'
import MyMeetings from '../components/workspace/MyMeetings'
import QuickTools from '../components/workspace/QuickTools'
import MockInbox from '../components/workspace/MockInbox'
import QuickCreateModal from '../components/workspace/QuickCreateModal'

export default function TodayPage() {
  const { openMenu, openNotifications } = useLayout()
  const location = useLocation()
  const [today, setToday] = useState(null)
  const [openTasks, setOpenTasks] = useState([])
  const [clients, setClients] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)
  const triggerRef = useRef(null)

  const refresh = useCallback(async () => {
    const [data, tasks] = await Promise.all([workspaceApi.getToday(), workspaceApi.listTasks('status=open')])
    setToday(data)
    setOpenTasks(tasks)
    return data
  }, [])

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [preference, initialToday, clientData, organizationData, tasks] = await Promise.all([
          workspaceApi.getPreferences(), workspaceApi.getToday(), api.get('/clients'), workspaceApi.listOrganizations(true), workspaceApi.listTasks('status=open'),
        ])
        if (!alive) return
        let result = initialToday
        if (!preference.is_configured) {
          const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          await workspaceApi.saveTimezone(browserZone)
          result = await workspaceApi.getToday()
        }
        if (!alive) return
        setToday(result)
        setOpenTasks(tasks)
        setClients(Array.isArray(clientData) ? clientData : [])
        setOrganizations(Array.isArray(organizationData) ? organizationData : [])
      } catch {
        if (alive) setError('Today could not be loaded. Try refreshing the page.')
      }
    }
    load()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const taskId = new URLSearchParams(location.search).get('task')
    if (!taskId || !today) return
    const target = document.getElementById(`task-${taskId}`)
    target?.scrollIntoView({ block: 'center' })
    target?.focus()
  }, [location.search, today, openTasks])

  function openCreate(mode, initialValues = {}, trigger = null) {
    triggerRef.current = trigger || document.activeElement
    setModal({ mode, initialValues })
  }
  const closeCreate = useCallback(() => {
    setModal(null)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])
  async function created() {
    closeCreate()
    try { await refresh() } catch { setError('Saved, but Today could not refresh. Reload to see the update.') }
  }
  async function completeTask(task) {
    try { await workspaceApi.completeTask(task.id); await refresh() }
    catch { setError('The task could not be completed. Try again.') }
  }
  async function changeAppointment(item, action) {
    try {
      if (action === 'complete') await workspaceApi.completeAppointment(item.id)
      else await workspaceApi.cancelAppointment(item.id)
      await refresh()
    } catch { setError('The meeting could not be updated. Try again.') }
  }
  function taskFromMail(message) {
    openCreate('task', { title: message.subject, notes: `Sample email from ${message.sender} (${message.organization}): ${message.preview}`, is_follow_up: true })
  }
  function appointmentFromMail(message) {
    openCreate('appointment', { title: message.subject, notes: `Sample email from ${message.sender} (${message.organization}): ${message.preview}` })
  }
  const featuredTaskIds = new Set([...(today?.overdue_tasks || []), ...(today?.due_today_tasks || [])].map((task) => task.id))
  const otherOpenTasks = openTasks.filter((task) => !featuredTaskIds.has(task.id))

  return <>
    <TopBar crumbs={['Daily', 'Today']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page">
      <div className="page-head"><div><div className="eyebrow">Your day at a glance</div><h1 className="page-title">Today</h1><p className="page-sub">The work and conversations that need your attention.</p></div>
        <div className="quick-create-actions"><button className="btn accent" onClick={(event) => openCreate('task', {}, event.currentTarget)}><Icon name="plus" size={16} /> New Task</button><button className="btn" onClick={(event) => openCreate('appointment', {}, event.currentTarget)}><Icon name="calendar" size={16} /> New Appointment</button></div>
      </div>
      {error && <p role="alert" className="workspace-error">{error}</p>}
      {!today && !error && <p role="status">Loading Today…</p>}
      {today && <div className="today-grid">
        <div className="today-main">
          <TaskList title="Overdue" tasks={today.overdue_tasks} onToggle={completeTask} timeZone={today.timezone_name} emptyText="Nothing overdue. You're caught up." />
          <TaskList title="Due today" tasks={today.due_today_tasks} onToggle={completeTask} timeZone={today.timezone_name} emptyText="No tasks due today." />
          <TaskList title="Other open tasks" tasks={otherOpenTasks} onToggle={completeTask} timeZone={today.timezone_name} emptyText="No other open tasks." />
          <MockInbox onCreateTask={taskFromMail} onCreateAppointment={appointmentFromMail} />
        </div>
        <aside className="today-rail"><MyMeetings today={today.appointments_today} upcoming={today.appointments_next_seven_days} onStatusChange={changeAppointment} timeZone={today.timezone_name} /><QuickTools /></aside>
      </div>}
      {modal && <QuickCreateModal key={`${modal.mode}-${modal.initialValues.title || ''}`} mode={modal.mode} initialValues={modal.initialValues} clients={clients} organizations={organizations} timeZone={today?.timezone_name} onClose={closeCreate} onCreated={created} />}
    </main>
  </>
}
