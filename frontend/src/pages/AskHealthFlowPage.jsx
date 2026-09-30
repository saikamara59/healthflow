import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api from '../api/client'
import TopBar from '../components/TopBar'
import AgentMarkdown from '../components/ui/AgentMarkdown'
import useLayout from '../components/ui/useLayout'
import VoiceSession from '../components/workspace/VoiceSession'
import SaveToolOutput from '../components/workspace/SaveToolOutput'

export default function AskHealthFlowPage() {
  const { openMenu, openNotifications } = useLayout()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedClientId = searchParams.get('client') || ''
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState(requestedClientId)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [suggestion, setSuggestion] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [prepared, setPrepared] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionStatus, setActionStatus] = useState('')
  const [voiceTranscript, setVoiceTranscript] = useState([])
  const [voiceStatus, setVoiceStatus] = useState('idle')

  useEffect(() => {
    let active = true
    api.get('/clients').then((items) => {
      if (active) {
        const activeClients = items.filter((item) => !item.archived_at)
        setClients(activeClients)
        if (requestedClientId) {
          if (activeClients.some((item) => item.id === requestedClientId)) {
            setClientId(requestedClientId)
            setMessages([])
          } else {
            setClientId('')
            setError('The requested Client is unavailable.')
          }
        }
      }
    }).catch(() => {
      if (active) setError('Clients could not be loaded. Try refreshing the page.')
    })
    return () => { active = false }
  }, [requestedClientId])

  function changeClient(event) {
    setClientId(event.target.value)
    setMessages([])
    setSuggestion(null)
    setError('')
    setPrepared(null)
    setActionStatus('')
  }

  async function send(event) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || busy) return
    setBusy(true)
    setError('')
    setSuggestion(null)
    setPrepared(null)
    setActionStatus('')
    try {
      const history = messages.slice(-8).map(({ role, content }) => ({ role, content }))
      const result = await api.post('/ask-healthflow/text', {
        message,
        history,
        client_id: clientId || null,
      })
      setMessages((current) => [...current, { role: 'user', content: message }, { role: 'assistant', content: result.answer }])
      setSuggestion(result.suggested_tool)
      setDraft('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmPrepared(event) {
    event.preventDefault()
    if (!prepared || actionBusy || !prepared.title.trim()) return
    setActionBusy(true)
    setError('')
    try {
      const base = { title: prepared.title.trim(), notes: prepared.notes.trim() || null, client_id: clientId || null }
      if (prepared.type === 'task') {
        await api.post('/tasks', base)
        setActionStatus('Task created after your confirmation.')
      } else {
        if (!prepared.startsAt || !prepared.endsAt) throw new Error('Choose the Appointment start and end times.')
        const start = new Date(prepared.startsAt)
        const end = new Date(prepared.endsAt)
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error('End time must be after start time.')
        await api.post('/appointments', { ...base, starts_at: start.toISOString(), ends_at: end.toISOString() })
        setActionStatus('Appointment created after your confirmation.')
      }
      setPrepared(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setActionBusy(false)
    }
  }

  const activeClient = clients.find((client) => client.id === clientId)
  return <>
    <TopBar crumbs={['Tools', 'Ask HealthFlow']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page ask-page">
      <div className="page-head"><div>
        <div className="eyebrow">Your general Tool</div>
        <h1 className="page-title">Ask HealthFlow</h1>
        <p className="page-sub">Ask a question or prepare your next step. Review any suggested Tool before opening it.</p>
      </div></div>
      <div className="card card-pad ask-panel">
        <label className="ask-context-label" htmlFor="ask-client">Client context</label>
        <select id="ask-client" className="input" value={clientId} onChange={changeClient} disabled={busy || voiceStatus !== 'idle'}>
          <option value="">No Client selected</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}
        </select>
        <p className="muted ask-context-note">{activeClient ? `Active Client: ${activeClient.full_name}. Changing Client clears this conversation.` : 'Ask HealthFlow has no Client record access until you select one.'}</p>
        <div className="ask-conversation" role="log" aria-live="polite" aria-label="Ask HealthFlow conversation">
          {messages.length === 0 && <p className="muted">The conversation is temporary and is cleared when you leave this page.</p>}
          {messages.map((item, index) => <div className={`msg ${item.role === 'user' ? 'user' : 'agent'}`} key={index}>
            <div><div className="bub-label">{item.role === 'user' ? 'You asked' : 'Ask HealthFlow'}</div>
              <div className="bubble">{item.role === 'assistant' ? <AgentMarkdown>{item.content}</AgentMarkdown> : item.content}</div>
            </div>
          </div>)}
          {busy && <p className="muted" role="status">Ask HealthFlow is answering…</p>}
        </div>
        {suggestion && <div className="ask-suggestion">
          <p>Suggested Tool: <strong>{suggestion.name}</strong>. Opening it is your choice.</p>
          <button className="btn sm" type="button" onClick={() => navigate(suggestion.path)}>Review and open {suggestion.name}</button>
        </div>}
        {messages.length > 0 && !prepared && <div className="ask-prepare-actions">
          <button type="button" className="btn sm" onClick={() => setPrepared({ type: 'task', title: messages[messages.length - 2]?.content.slice(0, 300) || '', notes: '', startsAt: '', endsAt: '' })}>Prepare Task</button>
          <button type="button" className="btn sm" onClick={() => setPrepared({ type: 'appointment', title: messages[messages.length - 2]?.content.slice(0, 300) || '', notes: '', startsAt: '', endsAt: '' })}>Prepare Appointment</button>
        </div>}
        {prepared && <form className="ask-prepared" onSubmit={confirmPrepared}>
          <h2>Review {prepared.type === 'task' ? 'Task' : 'Appointment'}</h2>
          <p className="muted">Nothing is created until you confirm. {activeClient ? `This will link to ${activeClient.full_name}.` : 'No Client will be linked.'}</p>
          <label>Title<input className="input" required maxLength={300} value={prepared.title} onChange={(event) => setPrepared({ ...prepared, title: event.target.value })} /></label>
          <label>Notes<textarea className="textarea" maxLength={6000} value={prepared.notes} onChange={(event) => setPrepared({ ...prepared, notes: event.target.value })} /></label>
          {prepared.type === 'appointment' && <div className="ask-dates">
            <label>Starts<input className="input" type="datetime-local" required value={prepared.startsAt} onChange={(event) => setPrepared({ ...prepared, startsAt: event.target.value })} /></label>
            <label>Ends<input className="input" type="datetime-local" required value={prepared.endsAt} onChange={(event) => setPrepared({ ...prepared, endsAt: event.target.value })} /></label>
          </div>}
          <div className="ask-actions"><button type="button" className="btn sm ghost" onClick={() => setPrepared(null)}>Cancel</button><button className="btn primary" disabled={actionBusy}>Confirm and create</button></div>
        </form>}
        {actionStatus && <p role="status">{actionStatus}</p>}
        <SaveToolOutput source="conversation" text={messages.map((item) => `${item.role === 'user' ? 'Broker' : 'Ask HealthFlow'}: ${item.content}`).join('\n\n')} />
        {error && <p role="alert" className="ask-error">{error}</p>}
        <form onSubmit={send} className="ask-form">
          <label htmlFor="ask-message">Your question</label>
          <textarea id="ask-message" className="textarea" maxLength={4000} rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What would you like to work through?" />
          <div className="ask-actions"><span className="muted">Nothing is saved or performed by asking.</span><button className="btn primary" disabled={busy || !draft.trim()}>Send</button></div>
        </form>
      </div>
      <VoiceSession clientId={clientId} clientName={activeClient?.full_name} onTranscriptChange={setVoiceTranscript} onStatusChange={setVoiceStatus} />
      {voiceStatus === 'idle' && <SaveToolOutput source="conversation" label="Save voice conversation" text={voiceTranscript.map((entry) => `${entry.role}: ${entry.content}`).join('\n\n')} />}
    </main>
  </>
}
