import { useEffect, useState } from 'react'
import api from '../../api/client'

export default function SaveToolOutput({ source, text, fixedClientId = '', label = 'Save as Document' }) {
  const [clients, setClients] = useState([])
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(fixedClientId)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(null)

  useEffect(() => {
    let alive = true
    Promise.all([api.get('/clients'), api.get('/documents/capabilities')]).then(([items, capability]) => {
      if (alive) { setClients(items.filter((item) => !item.archived_at)); setEnabled(capability.upload_enabled) }
    }).catch(() => { if (alive) setError('Document saving is unavailable right now.') })
    return () => { alive = false }
  }, [])

  useEffect(() => { setSelected(fixedClientId); setConfirmed(false); setOpen(false); setSaved(null) }, [fixedClientId, text])

  async function save(event) {
    event.preventDefault()
    if (!confirmed || !selected || !text.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api.post('/tool-output/documents', {
        source, client_id: selected, text, confirmed: true,
      })
      setSaved(result)
      setOpen(false)
      window.dispatchEvent(new Event('healthflow:documents-changed'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!text?.trim()) return null
  return <div className="ask-save-output">
    {!enabled && <p className="muted">Saving Documents is unavailable in this workspace.</p>}
    {enabled && !open && !saved && <button type="button" className="btn sm" onClick={() => { setSelected(fixedClientId); setConfirmed(false); setOpen(true) }}>{label}</button>}
    {open && <form className="ask-prepared" onSubmit={save}>
      <h2>Review Document save</h2>
      <p className="muted">Choose the Client record for this protected Document. Review the temporary text before confirming.</p>
      <label>Related Client
        <select className="input" required value={selected} disabled={Boolean(fixedClientId)} onChange={(event) => { setSelected(event.target.value); setConfirmed(false) }}>
          <option value="">Choose Client</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}
        </select>
      </label>
      <textarea className="textarea ask-save-preview" aria-label="Document text to save" readOnly value={text} />
      <label className="ask-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed this text and confirm saving it as a Document for this Client.</label>
      <div className="ask-actions"><button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={!confirmed || !selected || busy}>Confirm Save as Document</button></div>
    </form>}
    {saved && <p role="status">Saved as a protected Document on the selected Client record.</p>}
    {error && <p role="alert" className="ask-error">{error}</p>}
  </div>
}
