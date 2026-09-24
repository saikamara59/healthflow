import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'

export default function DocumentList({ clientId, targetType, targetId, archived = false }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState(null)
  const [selected, setSelected] = useState('')
  const [version, setVersion] = useState(0)
  const archiveView = !clientId

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1)
    window.addEventListener('healthflow:documents-changed', refresh)
    return () => window.removeEventListener('healthflow:documents-changed', refresh)
  }, [])

  useEffect(() => {
    let alive = true
    setState(null); setError(''); setSelected(''); setFile(null)
    async function load() {
      const [documents, client, capability, available] = await Promise.all([
        api.get(archiveView ? '/documents/archived' : targetType
          ? `/documents?target_type=${targetType}&target_id=${targetId}` : `/clients/${clientId}/documents`),
        clientId ? api.get(`/clients/${clientId}`) : null,
        clientId ? api.get('/documents/capabilities') : null,
        targetType ? api.get(`/clients/${clientId}/documents`) : [],
      ])
      const links = await Promise.all(documents.map((doc) => api.get(`/documents/${doc.id}/links${archiveView ? '?include_ended=true' : ''}`)))
      if (alive) setState({ documents: documents.map((doc, index) => ({ ...doc, links: links[index].filter((link) => !link.ended_at) })), client, capability, available })
    }
    load().catch((err) => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [clientId, targetType, targetId, archiveView, version])

  async function act(action) {
    setBusy(true); setError('')
    try { await action(); window.dispatchEvent(new Event('healthflow:documents-changed')) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  const clientArchived = archived || Boolean(state?.client?.archived_at)
  const candidates = state?.available.filter((doc) => !state.documents.some((item) => item.id === doc.id)) || []
  return <section className="document-panel" aria-label="Documents">
    <div className="between"><h2>Documents</h2>{!archiveView && <Link to="/documents/archive">Document archive</Link>}</div>
    {clientArchived && <p className="notice">Archived client — restore the Client before uploading or linking Documents.</p>}
    {error && <p role="alert" className="workspace-error">{error}</p>}
    {!state && !error && <p role="status">Loading Documents…</p>}
    {state && <>
      {!archiveView && !clientArchived && state.capability?.upload_enabled && <form className="document-controls" onSubmit={(event) => { event.preventDefault(); if (file) act(() => api.uploadDocument(clientId, file)) }}>
        <label>Choose synthetic file<input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(event) => setFile(event.target.files[0] || null)} /></label>
        <button className="btn" disabled={busy || !file}>Upload document</button>
      </form>}
      {targetType && !clientArchived && <form className="document-controls" onSubmit={(event) => { event.preventDefault(); if (selected) act(() => api.post(`/documents/${selected}/links`, { target_type: targetType, target_id: targetId })) }}>
        <label>Client Document<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose a Document</option>{candidates.map((doc) => <option key={doc.id} value={doc.id}>{doc.display_filename}</option>)}</select></label>
        <button className="btn" disabled={busy || !selected}>Link document</button>
      </form>}
      {!state.documents.length && <p className="workspace-empty">No {archiveView ? 'archived' : 'active'} Documents.</p>}
      <ul className="workspace-list">{state.documents.map((doc) => <li className="document-row" key={doc.id}>
        <div><strong>{doc.display_filename}</strong><small>{doc.verified_type.toUpperCase()} · {doc.byte_length.toLocaleString()} bytes</small>
          {archiveView && <Link to={`/clients/${doc.client_id}`}>Client record</Link>}
          {doc.links.length > 0 && <ul className="document-links">{doc.links.map((link) => <li key={link.id}><span>{link.target_type} · {link.target_id.slice(0, 8)}</span><button className="btn sm ghost" disabled={busy} onClick={() => act(() => api.del(`/documents/${doc.id}/links/${link.id}`))}>Unlink {link.target_type}</button></li>)}</ul>}
        </div>
        <div className="workspace-row-actions"><button className="btn sm" disabled={busy} onClick={async () => { setError(''); try { await api.openDocument(doc.id) } catch (err) { setError(err.message) } }}>{['doc', 'docx'].includes(doc.verified_type) ? 'Download' : 'Open'}</button><button className="btn sm ghost" disabled={busy} onClick={() => act(() => api.post(`/documents/${doc.id}/${archiveView ? 'restore' : 'archive'}`))}>{archiveView ? 'Restore document' : 'Archive document'}</button></div>
      </li>)}</ul>
    </>}
  </section>
}
