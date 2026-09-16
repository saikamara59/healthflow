import { useEffect, useRef, useState } from 'react'
import { workspaceApi } from '../../api/workspace'

const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function QuickCreateModal({ mode, initialValues = {}, clients = [], organizations = [], onClose, onCreated }) {
  const dialogRef = useRef(null)
  const titleRef = useRef(null)
  const [title, setTitle] = useState(initialValues.title || '')
  const [notes, setNotes] = useState(initialValues.notes || '')
  const [clientId, setClientId] = useState(initialValues.client_id || '')
  const [organizationId, setOrganizationId] = useState(initialValues.organization_id || '')
  const [contactId, setContactId] = useState(initialValues.contact_id || '')
  const [dueDate, setDueDate] = useState(initialValues.dueDate || '')
  const [dueTime, setDueTime] = useState(initialValues.dueTime || '17:00')
  const [startDate, setStartDate] = useState(initialValues.startDate || localDate())
  const [startTime, setStartTime] = useState(initialValues.startTime || '09:00')
  const [endDate, setEndDate] = useState(initialValues.endDate || localDate())
  const [endTime, setEndTime] = useState(initialValues.endTime || '09:30')
  const [followUp, setFollowUp] = useState(Boolean(initialValues.is_follow_up))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const contacts = organizations.find((item) => item.id === organizationId)?.contacts || []

  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    titleRef.current?.focus()
    const cancel = (event) => { event.preventDefault(); onClose() }
    dialog.addEventListener('cancel', cancel)
    return () => { dialog.removeEventListener('cancel', cancel); dialog.close() }
  }, [onClose])

  async function submit(event) {
    event.preventDefault()
    if (!title.trim()) { setError('Enter a title.'); titleRef.current?.focus(); return }
    const links = { client_id: clientId || null, organization_id: organizationId || null, contact_id: contactId || null }
    setSaving(true); setError('')
    try {
      if (mode === 'task') {
        await workspaceApi.createTask({ title: title.trim(), notes: notes.trim() || null, due_at: dueDate ? new Date(`${dueDate}T${dueTime}`).toISOString() : null, is_follow_up: followUp, ...links })
      } else {
        const startsAt = new Date(`${startDate}T${startTime}`)
        const endsAt = new Date(`${endDate}T${endTime}`)
        if (!(endsAt > startsAt)) { setError('The end must be after the start.'); setSaving(false); return }
        await workspaceApi.createAppointment({ title: title.trim(), notes: notes.trim() || null, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), ...links })
      }
      onCreated()
    } catch (err) { setError(typeof err.message === 'string' ? err.message : 'Could not save. Try again.') }
    finally { setSaving(false) }
  }

  return <dialog ref={dialogRef} className="workspace-dialog" aria-labelledby="quick-create-title"><form onSubmit={submit}>
    <div className="between"><h2 id="quick-create-title">New {mode === 'task' ? 'Task' : 'Appointment'}</h2><button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>×</button></div>
    <label>{mode === 'task' ? 'Task title' : 'Appointment title'}<input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={300} /></label>
    <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={6000} /></label>
    <div className="workspace-form-grid"><label>Client<select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">No client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label><label>Organization<select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setContactId('') }}><option value="">No organization</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label></div>
    {organizationId && <label>Contact<select value={contactId} onChange={(event) => setContactId(event.target.value)}><option value="">No contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name}</option>)}</select></label>}
    {mode === 'task' ? <><div className="workspace-form-grid"><label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><label>Due time<input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} disabled={!dueDate} /></label></div><label className="workspace-check"><input type="checkbox" checked={followUp} onChange={(event) => setFollowUp(event.target.checked)} /> Follow-up</label></> : <><div className="workspace-form-grid"><label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><label>Start time<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label><label>End date<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label><label>End time<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></label></div></>}
    {error && <p role="alert" className="workspace-error">{error}</p>}
    <div className="quick-create-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn accent" disabled={saving}>{saving ? 'Saving…' : `Create ${mode === 'task' ? 'Task' : 'Appointment'}`}</button></div>
  </form></dialog>
}
