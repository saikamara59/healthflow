import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Archive, ArrowSquareOut, DownloadSimple, LinkSimple, LockKey, UploadSimple } from '@phosphor-icons/react'
import api from '../api/client'
import { workspaceApi } from '../api/workspace'
import TopBar from '../components/TopBar'
import PageHead from '../components/ui/PageHead'
import { PlanLogo } from '../components/ui/OrgLogo'
import useLayout from '../components/ui/useLayout'
import { ACCEPTED, DocTypeTile, formatBytes, formatDay, isOpenable, linkLabel } from '../components/documents/documentFormat'

const EASE = [0.22, 1, 0.36, 1]

export default function DocumentsPage() {
  const { openMenu, openNotifications } = useLayout()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [upload, setUpload] = useState({ client_id: '', related: '', file: null })
  const [uploadError, setUploadError] = useState('')
  const [busy, setBusy] = useState(null)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    const [documents, archived, capability, clients, archivedClients, enrollments, issues] = await Promise.all([
      api.get('/documents/active'),
      api.get('/documents/archived'),
      api.get('/documents/capabilities'),
      workspaceApi.listLinkableClients(),
      api.get('/clients?archived=true').catch(() => []),
      workspaceApi.listEnrollments().catch(() => []),
      workspaceApi.listAllIssues().catch(() => []),
    ])
    const links = await Promise.all(documents.map((doc) => api.get(`/documents/${doc.id}/links`)))
    setData({
      documents: documents.map((doc, index) => ({ ...doc, links: links[index].filter((link) => !link.ended_at) })),
      archivedCount: archived.length,
      uploadEnabled: Boolean(capability?.upload_enabled),
      clients,
      clientNames: Object.fromEntries([...archivedClients, ...clients].map((item) => [item.id, item.full_name])),
      enrollments,
      issues,
    })
    setError('')
  }, [])

  useEffect(() => {
    let alive = true
    load().catch(() => { if (alive) setError('Documents could not be loaded.') })
    const refresh = () => { load().catch(() => {}) }
    window.addEventListener('healthflow:documents-changed', refresh)
    return () => { alive = false; window.removeEventListener('healthflow:documents-changed', refresh) }
  }, [load])

  const recordNames = useMemo(() => Object.fromEntries([
    ...(data?.enrollments || []).map((item) => [`enrollment:${item.id}`, item.plan_name]),
    ...(data?.issues || []).map((item) => [`issue:${item.id}`, item.title]),
  ]), [data])

  const related = useMemo(() => [
    ...(data?.enrollments || []).filter((item) => item.client_id === upload.client_id && item.status !== 'canceled')
      .map((item) => ({ value: `enrollment:${item.id}`, label: `Enrollment · ${item.plan_name}` })),
    ...(data?.issues || []).filter((item) => item.client_id === upload.client_id)
      .map((item) => ({ value: `issue:${item.id}`, label: `Issue · ${item.title}` })),
  ], [data, upload.client_id])

  const shown = (data?.documents || []).filter((doc) => !clientFilter || doc.client_id === clientFilter)
  const clientsWithDocs = data ? [...new Set(data.documents.map((doc) => doc.client_id))]
    .map((id) => ({ id, name: data.clientNames[id] || 'Unknown client' }))
    .sort((a, b) => a.name.localeCompare(b.name)) : []

  function chooseFile(event) {
    const file = event.target.files[0] || null
    setUploadError('')
    if (file && !ACCEPTED.includes(file.name.split('.').pop().toLowerCase())) {
      event.target.value = ''
      setUpload({ ...upload, file: null })
      setUploadError(`${file.name} is not a supported type. Use PDF, Word, JPG, or PNG.`)
      return
    }
    setUpload({ ...upload, file })
  }

  async function submitUpload(event) {
    event.preventDefault()
    if (busy) return
    if (!upload.client_id) { setUploadError('Choose a client before uploading.'); return }
    if (!upload.file) { setUploadError('Choose a file to upload.'); return }
    setBusy('upload'); setUploadError('')
    try {
      const created = await api.uploadDocument(upload.client_id, upload.file)
      if (upload.related) {
        const [target_type, target_id] = upload.related.split(':')
        await api.post(`/documents/${created.id}/links`, { target_type, target_id })
      }
      setUpload({ client_id: upload.client_id, related: '', file: null })
      if (fileRef.current) fileRef.current.value = ''
      window.dispatchEvent(new Event('healthflow:documents-changed'))
    } catch (err) {
      setUploadError(err.message || 'Document could not be uploaded.')
    } finally { setBusy(null) }
  }

  async function act(doc, action) {
    setBusy(doc.id); setError('')
    try {
      if (action === 'open') await api.openDocument(doc.id)
      if (action === 'archive') {
        await api.post(`/documents/${doc.id}/archive`)
        window.dispatchEvent(new Event('healthflow:documents-changed'))
      }
    } catch (err) { setError(err.message || 'Document could not be updated.') }
    finally { setBusy(null) }
  }

  return <MotionConfig reducedMotion="user">
    <TopBar crumbs={['Workspace', 'Documents']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page wide ws-page-in">
      <PageHead
        icon="docs"
        eyebrow={data ? `${data.documents.length} active document${data.documents.length === 1 ? '' : 's'}` : null}
        title="Documents"
        sub="Supporting records for your clients. One document can appear on a client and its enrollment, issue, or appeal."
      />

      {data && (data.uploadEnabled ? (
        <form className="card workspace-section workspace-inline-form doc-upload" onSubmit={submitUpload} noValidate>
          <h2>Upload</h2>
          <div className="ws-grid3">
            <label>Client<select value={upload.client_id} onChange={(event) => { setUpload({ ...upload, client_id: event.target.value, related: '' }); setUploadError('') }}><option value="">Choose a client</option>{data.clients.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
            <label>Related record<select value={upload.related} disabled={!upload.client_id} onChange={(event) => setUpload({ ...upload, related: event.target.value })}><option value="">None</option>{related.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label>File
              <span className="doc-file">
                <button type="button" className="btn" onClick={() => fileRef.current?.click()}><UploadSimple size={15} weight="duotone" /> {upload.file ? 'Change file' : 'Choose file'}</button>
                <span className="doc-file-name">{upload.file ? upload.file.name : 'No file chosen'}</span>
              </span>
            </label>
          </div>
          <input ref={fileRef} type="file" hidden aria-label="Document file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={chooseFile} />
          <div className="doc-upload-foot">
            <small className="workspace-small">PDF, Word, JPG, or PNG. Files open only inside your workspace.</small>
            <button className="btn accent" disabled={busy === 'upload' || !upload.file || !upload.client_id}>{busy === 'upload' ? 'Uploading…' : 'Upload document'}</button>
          </div>
          {uploadError && <span role="alert" className="td-err">{uploadError}</span>}
        </form>
      ) : (
        <div className="card doc-locked">
          <LockKey size={24} weight="duotone" aria-hidden="true" />
          <div><strong>Uploads are turned off here</strong><span>This environment only holds synthetic sample files. You can still open, link, and archive them.</span></div>
        </div>
      ))}

      <section className="card workspace-section">
        <div className="ws-filter-row">
          <label className="workspace-filter">Client<select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="">All clients</option>{clientsWithDocs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <Link className="btn sm doc-archive-link" to="/documents/archive"><Archive size={14} weight="duotone" /> Archived{data ? ` (${data.archivedCount})` : ''}</Link>
        </div>
        {error && <p role="alert" className="workspace-error">{error}</p>}
        {!data && !error && <p role="status" className="workspace-empty">Loading documents…</p>}
        {data && !shown.length && <p className="workspace-empty">{clientFilter ? 'No documents for this client.' : 'No documents yet. Upload a file or add one from a client profile.'}</p>}
        <ul className="workspace-list">
          <AnimatePresence initial={false}>
            {shown.map((doc, index) => (
              <motion.li
                key={doc.id}
                layout="position"
                className="workspace-list-row doc-row"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE, delay: Math.min(index, 8) * 0.03 } }}
                exit={{ opacity: 0, x: -16, transition: { duration: 0.2 } }}
              >
                <DocTypeTile type={doc.verified_type} />
                <div className="workspace-row-copy">
                  <strong>{doc.display_filename}</strong>
                  <small>
                    <Link to={`/clients/${doc.client_id}`}>{data.clientNames[doc.client_id] || 'Client record'}</Link>
                    {' · '}{doc.verified_type.toUpperCase()} · {formatBytes(doc.byte_length)} · Added {formatDay(doc.created_at)}
                  </small>
                  {doc.links.length > 0 && (
                    <span className="doc-links">{doc.links.map((link) => <span key={link.id} className="chip">{link.target_type === 'enrollment' && recordNames[`enrollment:${link.target_id}`] ? <PlanLogo planName={recordNames[`enrollment:${link.target_id}`]} size={14} /> : <LinkSimple size={11} weight="bold" aria-hidden="true" />}{linkLabel(link, recordNames)}</span>)}</span>
                  )}
                </div>
                <div className="workspace-row-actions">
                  <button className="btn sm" disabled={busy === doc.id} onClick={() => act(doc, 'open')}>
                    {isOpenable(doc.verified_type) ? <><ArrowSquareOut size={14} weight="duotone" /> Open</> : <><DownloadSimple size={14} weight="duotone" /> Download</>}
                  </button>
                  <button className="btn sm ghost" disabled={busy === doc.id} onClick={() => act(doc, 'archive')} aria-label={`Archive ${doc.display_filename}`}><Archive size={14} weight="duotone" /> Archive</button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </section>
    </main>
  </MotionConfig>
}
