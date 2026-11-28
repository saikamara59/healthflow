import { useEffect, useState } from 'react'
import { FloppyDisk } from '@phosphor-icons/react'
import api from '../../api/client'
import { workspaceApi } from '../../api/workspace'

// Matches MAX_OUTPUT_LENGTH in healthflow/workspace/tool_output_router.py.
export const MAX_OUTPUT_LENGTH = 20000

/**
 * Save temporary Tool output as a protected Document on a Client's record.
 * Nothing is stored until the Broker picks the Client, reviews the text, and confirms.
 * `fixedClientId` locks the Client when the output already belongs to one (Draft Appeal's Issue).
 */
export default function SaveToolOutput({ source, text, fixedClientId = '', label = 'Save as Document' }) {
  const [clients, setClients] = useState([])
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(fixedClientId)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    // Linkable Clients are always the Broker's own, even for admins, so every
    // choice here is one the server accepts.
    Promise.all([workspaceApi.listLinkableClients(), api.get('/documents/capabilities')]).then(([items, capability]) => {
      if (alive) { setClients(items); setEnabled(capability.upload_enabled) }
    }).catch(() => { if (alive) setError('Document saving is unavailable right now.') })
    return () => { alive = false }
  }, [])

  // New output, or output for a different Client, starts the review over.
  useEffect(() => { setSelected(fixedClientId); setConfirmed(false); setOpen(false); setSaved(false); setError('') }, [fixedClientId, text])

  const tooLong = text.length > MAX_OUTPUT_LENGTH
  const lockedClient = fixedClientId ? clients.find((client) => client.id === fixedClientId) : null

  async function save(event) {
    event.preventDefault()
    if (!confirmed || !selected || !text.trim() || tooLong || busy) return
    setBusy(true)
    setError('')
    try {
      await api.post('/tool-output/documents', { source, client_id: selected, text, confirmed: true })
      setSaved(true)
      setOpen(false)
      window.dispatchEvent(new Event('healthflow:documents-changed'))
    } catch (err) {
      setError(err.message || 'The Document could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  if (!text?.trim()) return null
  if (!enabled) return error ? <p role="alert" className="workspace-error">{error}</p> : null
  if (tooLong) {
    return <p className="workspace-small save-output">This output is too long to save as one Document ({text.length.toLocaleString()} of {MAX_OUTPUT_LENGTH.toLocaleString()} characters). Copy it instead.</p>
  }
  return <div className="save-output">
    {!open && !saved && <button type="button" className="btn sm" onClick={() => { setSelected(fixedClientId); setConfirmed(false); setOpen(true) }}>
      <FloppyDisk size={14} weight="duotone" /> {label}
    </button>}
    {open && <form className="save-output-review" onSubmit={save} aria-label="Review Document save">
      <h3>Review Document save</h3>
      <p className="workspace-small">This text becomes a protected Document on the Client's record. Check it before you confirm.</p>
      {fixedClientId
        ? <p>Related Client: <strong>{lockedClient?.full_name || 'the Issue’s Client'}</strong></p>
        : <label>Related Client
          <select required value={selected} onChange={(event) => { setSelected(event.target.value); setConfirmed(false) }}>
            <option value="">Choose a Client</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}
          </select>
        </label>}
      <textarea className="save-output-preview" aria-label="Document text to save" readOnly value={text} />
      <label className="save-output-confirm">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        I reviewed this text and want to save it as a Document for this Client.
      </label>
      <div className="save-output-actions">
        <button type="button" className="btn sm" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn accent sm" disabled={!confirmed || !selected || busy}>{busy ? 'Saving…' : 'Confirm and save'}</button>
      </div>
    </form>}
    {saved && <p role="status" className="workspace-small">Saved as a protected Document on the Client's record.</p>}
    {error && <p role="alert" className="workspace-error">{error}</p>}
  </div>
}
