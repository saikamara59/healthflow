import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../api/client'
import TopBar from '../components/TopBar'
import { CalendarBlank, Plus } from '@phosphor-icons/react'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'
import MyMeetings from '../components/workspace/MyMeetings'
import MockInbox from '../components/workspace/MockInbox'
import QuickCreateModal from '../components/workspace/QuickCreateModal'
import TodayTasks from '../components/today/TodayTasks'
import TodayTools from '../components/today/TodayTools'
import WaitingForYou from '../components/today/WaitingForYou'
import HfTile from '../components/ui/HfTile'
import '../today-v2.css'

const OTHER_TASK_PAGE_SIZE = 25
const otherTaskQuery = (zone) => `status=open&schedule=other&timezone_name=${encodeURIComponent(zone)}`
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

function daySummary(today, overdueCount, dueTodayCount) {
  const now = new Date()
  const ahead = today.appointments_today.filter((item) => item.presentation_status === 'scheduled' && new Date(item.ends_at) > now).length
  return `${overdueCount} overdue, ${dueTodayCount} due later today, and ${plural(ahead, 'meeting')} still ahead.`
}

function dayHeading(today) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${today.local_date}T12:00:00Z`))
  return `${day} · Times in ${today.timezone_name}`
}

export default function TodayPage() {
  const { openMenu, openNotifications } = useLayout()
  const location = useLocation()
  const [today, setToday] = useState(null)
  const [otherTasks, setOtherTasks] = useState([])
  const [targetTask, setTargetTask] = useState(null)
  const [hasMoreTasks, setHasMoreTasks] = useState(false)
  const [loadingMoreTasks, setLoadingMoreTasks] = useState(false)
  const [clients, setClients] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [error, setError] = useState('')
  const [targetError, setTargetError] = useState('')
  const [modal, setModal] = useState(null)
  const triggerRef = useRef(null)
  const loadingMoreRef = useRef(false)
  const taskGenerationRef = useRef(0)

  const refresh = useCallback(async () => {
    const generation = ++taskGenerationRef.current
    const data = await workspaceApi.getToday()
    const tasks = await workspaceApi.listTasks(otherTaskQuery(data.timezone_name), { limit: OTHER_TASK_PAGE_SIZE })
    if (generation !== taskGenerationRef.current) return data
    setToday(data)
    setOtherTasks(tasks)
    setHasMoreTasks(tasks.length === OTHER_TASK_PAGE_SIZE)
    return data
  }, [])

  useEffect(() => {
    let alive = true
    const generation = ++taskGenerationRef.current
    async function load() {
      try {
        const [preference, initialToday, clientData, organizationData] = await Promise.all([
          workspaceApi.getPreferences(), workspaceApi.getToday(), api.get('/clients?linkable=true'), workspaceApi.listOrganizations(true),
        ])
        if (!alive || generation !== taskGenerationRef.current) return
        let result = initialToday
        if (!preference.is_configured) {
          const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          await workspaceApi.saveTimezone(browserZone)
          result = await workspaceApi.getToday()
        }
        const tasks = await workspaceApi.listTasks(otherTaskQuery(result.timezone_name), { limit: OTHER_TASK_PAGE_SIZE })
        if (!alive || generation !== taskGenerationRef.current) return
        setToday(result)
        setOtherTasks(tasks)
        setHasMoreTasks(tasks.length === OTHER_TASK_PAGE_SIZE)
        setClients(Array.isArray(clientData) ? clientData : [])
        setOrganizations(Array.isArray(organizationData) ? organizationData : [])
      } catch {
        if (alive) setError('Today could not be loaded. Try refreshing the page.')
      }
    }
    load()
    return () => { alive = false; taskGenerationRef.current += 1 }
  }, [])

  useEffect(() => {
    const taskId = new URLSearchParams(location.search).get('task')
    if (!taskId || !today) return
    const target = document.getElementById(`task-${taskId}`)
    target?.scrollIntoView({ block: 'center' })
    target?.focus()
  }, [location.search, today, otherTasks, targetTask])

  useEffect(() => {
    const taskId = new URLSearchParams(location.search).get('task')
    let alive = true
    setTargetTask(null)
    setTargetError('')
    if (taskId) workspaceApi.getTask(taskId).then((task) => {
      if (alive) { setTargetTask(task); setTargetError('') }
    }).catch(() => { if (alive) setTargetError('The matching Task could not be loaded.') })
    return () => { alive = false }
  }, [location.search])

  async function loadMoreTasks() {
    if (!today || !hasMoreTasks || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMoreTasks(true)
    const generation = taskGenerationRef.current
    try {
      const page = await workspaceApi.listTasks(otherTaskQuery(today.timezone_name), { limit: OTHER_TASK_PAGE_SIZE, offset: otherTasks.length })
      if (generation !== taskGenerationRef.current) return
      setOtherTasks((current) => [...current, ...page])
      setHasMoreTasks(page.length === OTHER_TASK_PAGE_SIZE)
    } catch { if (generation === taskGenerationRef.current) setError('More Tasks could not be loaded. Try again.') }
    finally { loadingMoreRef.current = false; setLoadingMoreTasks(false) }
  }

  function openCreate(mode, initialValues = {}, trigger = null) {
    if (!today) return
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
  async function toggleTargetTask(task) {
    try {
      if (task.status === 'completed') await workspaceApi.reopenTask(task.id)
      else await workspaceApi.completeTask(task.id)
      setTargetTask(await workspaceApi.getTask(task.id))
      await refresh()
    } catch { setError('The task could not be updated. Try again.') }
  }
  async function completeAppointment(item) {
    try { await workspaceApi.completeAppointment(item.id); await refresh() }
    catch { setError('The meeting could not be updated. Try again.') }
  }
  function taskFromMail(message) {
    openCreate('task', { title: message.subject, notes: `Sample email from ${message.sender} (${message.organization}): ${message.preview}`, is_follow_up: true, client_id: message.linkedClientId || '', suggested_client_id: message.linkedClientId ? null : message.clientMatch?.id })
  }
  function appointmentFromMail(message) {
    openCreate('appointment', { title: message.subject, notes: `Sample email from ${message.sender} (${message.organization}): ${message.preview}`, client_id: message.linkedClientId || '', suggested_client_id: message.linkedClientId ? null : message.clientMatch?.id })
  }
  const withoutStaleTarget = (tasks) => tasks.filter((task) => task.id !== targetTask?.id || task.status === targetTask.status)
  const overdueTasks = withoutStaleTarget(today?.overdue_tasks || [])
  const dueTodayTasks = withoutStaleTarget(today?.due_today_tasks || [])
  const visibleOtherTasks = withoutStaleTarget(otherTasks)
  const targetInToday = targetTask && [...overdueTasks, ...dueTodayTasks, ...visibleOtherTasks].some((task) => task.id === targetTask.id)
  return <>
    <TopBar crumbs={['Daily', 'Today']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page today-v2">
      <div className="page-head td-head"><div>
        <div className="eyebrow">{today ? dayHeading(today) : 'Your day at a glance'}</div>
        <div className="ws-title-row"><HfTile icon="today" large /><h1 className="page-title">Today</h1></div>
        <p className="page-sub">{today ? daySummary(today, overdueTasks.length, dueTodayTasks.length) : 'The work and conversations that need your attention.'}</p>
      </div>
        <div className="quick-create-actions"><button className="btn" disabled={!today} onClick={(event) => openCreate('appointment', {}, event.currentTarget)}><CalendarBlank weight="duotone" size={16} aria-hidden="true" /> New appointment</button><button className="btn accent" disabled={!today} onClick={(event) => openCreate('task', {}, event.currentTarget)}><Plus weight="bold" size={15} aria-hidden="true" /> New task</button></div>
      </div>
      {error && <p role="alert" className="workspace-error">{error}</p>}
      {targetError && <p role="alert" className="workspace-error">{targetError}</p>}
      {!today && !error && <p role="status">Loading Today…</p>}
      {today && <div className="today-grid">
        <div className="today-main">
          <TodayTasks
            searchResult={targetTask && !targetInToday ? targetTask : null}
            overdue={overdueTasks}
            dueToday={dueTodayTasks}
            other={visibleOtherTasks}
            hasMoreOther={hasMoreTasks}
            revealOther={Boolean(targetTask && visibleOtherTasks.some((task) => task.id === targetTask.id))}
            onToggle={completeTask}
            onToggleSearchResult={toggleTargetTask}
            timeZone={today.timezone_name}
            localDate={today.local_date}
            moreButton={hasMoreTasks && <button className="btn sm" disabled={loadingMoreTasks} onClick={loadMoreTasks}>{loadingMoreTasks ? 'Loading…' : 'Show more Tasks'}</button>}
          />
          <MyMeetings today={today.appointments_today} upcoming={today.appointments_next_seven_days} onComplete={completeAppointment} timeZone={today.timezone_name} />
        </div>
        <aside className="today-rail"><WaitingForYou /><MockInbox clients={clients} onCreateTask={taskFromMail} onCreateAppointment={appointmentFromMail} /><TodayTools /></aside>
      </div>}
      {modal && <QuickCreateModal key={`${modal.mode}-${modal.initialValues.title || ''}`} mode={modal.mode} initialValues={modal.initialValues} clients={clients} organizations={organizations} timeZone={today?.timezone_name} onClose={closeCreate} onCreated={created} />}
    </main>
  </>
}
