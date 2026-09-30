import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { ArrowCounterClockwise, ArrowLeft, ArrowSquareOut, DownloadSimple, MagnifyingGlass, ShieldCheck } from '@phosphor-icons/react'
import api from '../api/client'
import { workspaceApi } from '../api/workspace'
import TopBar from '../components/TopBar'
import PageHead from '../components/ui/PageHead'
import useLayout from '../components/ui/useLayout'
import { DocTypeTile, TYPE_GROUPS, formatBytes, formatDay, isOpenable, linkLabel } from '../components/documents/documentFormat'

const EASE = [0.22, 1, 0.36, 1]

export default function DocumentArchivePage() {
  const { openMenu, openNotifications } = useLayout()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [documents, clients, archivedClients, enrollments, issues] = await Promise.all([
      api.get('/documents/archived'),
      api.get('/clients').catch(() => []),
      api.get('/clients?archived=true').catch(() => []),
      workspaceApi.listEnrollments().catch(() => []),
      workspaceApi.listAllIssues().catch(() => []),
    ])
    const links = await Promise.all(documents.map((doc) => api.get(`/documents/${doc.id}/links?include_ended=true`)))
    setData({
      documents: documents.map((doc, index) => ({ ...doc, links: links[index].filter((link) => !link.ended_at) })),
      clientNames: Object.fromEntries([...archivedClients, ...clients].map((item) => [item.id, item.full_name])),
      recordNames: Object.fromEntries([
        ...enrollments.map((item) => [`enrollment:${item.id}`, item.plan_name]),
        ...issues.map((item) => [`issue:${item.id}`, item.title]),
      ]),
    })
    setError('')
  }, [])

  useEffect(() => {
    let alive = true
    load().catch((err) => { if (alive) setError(err.message || 'Archived documents could not be loaded.') })
    const refresh = () => { load().catch(() => {}) }
    window.addEventListener('healthflow:documents-changed', refresh)
    return () => { alive = false; window.removeEventListener('healthflow:documents-changed', refresh) }
  }, [load])

  const clientName = (id) => data?.clientNames[id] || 'Client record'
  const clientOptions = data ? [...new Set(data.documents.map((doc) => doc.client_id))]
    .map((id) => ({ id, name: clientName(id) })).sort((a, b) => a.name.localeCompare(b.name)) : []
  const shown = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.documents
      .filter((doc) => !clientFilter || doc.client_id === clientFilter)
      .filter((doc) => !typeFilter || TYPE_GROUPS[typeFilter].includes(doc.verified_type.toLowerCase()))
      .filter((doc) => !q || `${doc.display_filename} ${data.clientNames[doc.client_id] || ''}`.toLowerCase().includes(q))
  }, [data, query, clientFilter, typeFilter])
  const filtering = Boolean(query.trim() || clientFilter || typeFilter)
  const allOn = shown.length > 0 && shown.every((doc) => selected.has(doc.id))
  const toggle = (id) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  async function run(action) {
    setBusy(true); setError('')
    try { await action(); window.dispatchEvent(new Event('healthflow:documents-changed')) }
    catch (err) { setError(err.message || 'Archived documents could not be updated.') }
    finally { setBusy(false) }
  }
  const restore = (ids) => run(async () => {
    for (const id of ids) await api.post(`/documents/${id}/restore`)
    setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
  })
  async function openDoc(doc) {
    setError('')
    try { await api.openDocument(doc.id) } catch (err) { setError(err.message) }
  }

  return <MotionConfig reducedMotion="user">
    <TopBar crumbs={['Workspace', 'Documents', 'Archived']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page wide ws-page-in">
      <PageHead
        icon="docs"
        eyebrow="Workspace · Documents"
        title="Document archive"
        sub="Files you removed from active work. Restoring one brings back its client and any records it is still linked to."
        actions={<Link className="btn" to="/documents"><ArrowLeft size={15} weight="bold" /> Back to Documents</Link>}
      />

      <div className="card ar-policy">
        <ShieldCheck size={26} weight="duotone" aria-hidden="true" />
        <div><strong>Archived files are never deleted.</strong><span>HealthFlow keeps every client record so it can be reviewed later. Restore a file at any time to use it again.</span></div>
        <div className="ar-stat"><b>{data ? data.documents.length : '–'}</b><small>archived</small></div>
      </div>

      <section className="card workspace-section" aria-label="Archived documents">
        <div className="ar-filters">
          <label className="search ar-search"><MagnifyingGlass size={15} weight="duotone" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search file name or client" aria-label="Search archived documents" /></label>
          <label className="workspace-filter">Client<select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="">All clients</option>{clientOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="workspace-filter">Type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">All types</option>{Object.keys(TYPE_GROUPS).map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        </div>

        {error && <p role="alert" className="workspace-error">{error}</p>}
        {!data && !error && <p role="status" className="workspace-empty">Loading archived documents…</p>}

        <AnimatePresence>
          {selected.size > 0 && (
            <motion.div className="ar-bulk" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
              <span><b>{selected.size}</b> selected</span>
              <button className="td-link" onClick={() => setSelected(new Set())}>Clear</button>
              <button className="btn sm accent" disabled={busy} onClick={() => restore([...selected])}><ArrowCounterClockwise size={14} weight="duotone" /> Restore {selected.size === 1 ? 'file' : `${selected.size} files`}</button>
            </motion.div>
          )}
        </AnimatePresence>

        {data && !data.documents.length && (
          <div className="ar-empty">
            <strong>No archived Documents.</strong>
            <p>When you archive a document it moves here, so active work stays tidy without losing any records.</p>
            <Link className="btn" to="/documents">Go to Documents</Link>
          </div>
        )}
        {data && data.documents.length > 0 && !shown.length && (
          <div className="ar-empty">
            <strong>No archived documents match.</strong>
            {filtering && <button className="td-link" onClick={() => { setQuery(''); setClientFilter(''); setTypeFilter('') }}>Clear filters</button>}
          </div>
        )}

        {shown.length > 0 && (
          <>
            <div className="ar-headrow">
              <label className="cl-all"><input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(shown.map((doc) => doc.id)))} aria-label="Select all archived documents" /> Select all</label>
            </div>
            <ul className="workspace-list">
              <AnimatePresence initial={false}>
                {shown.map((doc) => (
                  <motion.li
                    key={doc.id}
                    layout="position"
                    className={`document-row ar-row${selected.has(doc.id) ? ' on' : ''}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 16, transition: { duration: 0.2 } }}
                    transition={{ duration: 0.28, ease: EASE }}
                  >
                    <input type="checkbox" className="cl-cb" checked={selected.has(doc.id)} onChange={() => toggle(doc.id)} aria-label={`Select ${doc.display_filename}`} />
                    <DocTypeTile type={doc.verified_type} />
                    <div className="ar-doc-copy">
                      <strong>{doc.display_filename}</strong>
                      <small>{doc.verified_type.toUpperCase()} · {formatBytes(doc.byte_length)} · Added {formatDay(doc.created_at)}</small>
                      {doc.links.length > 0 && (
                        <ul className="document-links">{doc.links.map((link) => (
                          <li key={link.id}>
                            <span>{linkLabel(link, data.recordNames)}</span>
                            <button className="btn sm ghost" disabled={busy} onClick={() => run(() => api.del(`/documents/${doc.id}/links/${link.id}`))}>Unlink {link.target_type}</button>
                          </li>
                        ))}</ul>
                      )}
                    </div>
                    <Link className="ar-client" to={`/clients/${doc.client_id}`}>{clientName(doc.client_id)}</Link>
                    <span className="ar-when"><b>{doc.archived_at ? formatDay(doc.archived_at) : '—'}</b><small>Archived</small></span>
                    <span className="ar-act">
                      <button className="btn sm ghost" onClick={() => openDoc(doc)}>{isOpenable(doc.verified_type) ? <><ArrowSquareOut size={14} weight="duotone" /> Open</> : <><DownloadSimple size={14} weight="duotone" /> Download</>}</button>
                      <button className="btn sm" disabled={busy} onClick={() => restore([doc.id])}><ArrowCounterClockwise size={14} weight="duotone" /> Restore document</button>
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </>
        )}
      </section>
    </main>
  </MotionConfig>
}
