import { Link } from 'react-router-dom'

// action_type values the tool pages record in /history.
const TOOL_LABELS = { compare: 'Compare Plans', calculate: 'Estimate Costs', verify: 'Check Network', plan_selected: 'Plan selected' }
const TOOL_TONE = { verify: 'warn', plan_selected: 'accent' }
const readable = (value) => (value || '').replace(/_/g, ' ')
const toolName = (type) => TOOL_LABELS[type] || readable(type) || 'Tool'

export function activityFromWorkspace(entry) {
  return {
    id: `workspace-${entry.id}`, source: 'Workspace', chip: readable(entry.action) || 'Update', tone: 'pos',
    title: entry.summary, date: entry.created_at, href: entry.client_id ? `/clients/${entry.client_id}` : null,
  }
}

export function activityFromTool(entry) {
  return {
    id: `tool-${entry.id}`, source: 'Tool', chip: toolName(entry.action_type), tone: TOOL_TONE[entry.action_type] || '',
    title: `${toolName(entry.action_type)}${entry.action_type === 'plan_selected' ? '' : ' run'}${entry.client_name ? ` for ${entry.client_name}` : ''}`,
    date: entry.created_at, href: entry.client_id ? `/clients/${entry.client_id}` : '/history',
  }
}

export function sinceLabel(iso) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// One timeline entry: a chip for what happened, the summary, and how long ago.
export function ActivityRow({ item, time = sinceLabel(item.date) }) {
  return <li className="workspace-list-row ws-activity-row">
    <span className={`chip ${item.tone}`}>{item.chip}</span>
    <div className="workspace-row-copy">{item.href ? <Link to={item.href}>{item.title}</Link> : <strong>{item.title}</strong>}</div>
    <span className="td-when">{time}</span>
  </li>
}
