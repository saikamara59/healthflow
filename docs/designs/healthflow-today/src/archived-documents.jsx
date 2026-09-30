/* global React */
// Archived documents: search, filter, preview, and restore. Nothing is permanently deleted (ADR 0003). All data is synthetic.
const { useState: useSAr, useEffect: useEAr } = React;
const ArI = (n, cls = '') => <i className={`ph-duotone ph-${n} ${cls}`} aria-hidden="true" />;

// Enrich the seed with archive metadata and a few more archived records.
(function seedArchive() {
  const docs = window.SEED_DOCS || [];
  const d5 = docs.find(d => d.id === 'd5');
  if (d5) Object.assign(d5, { archivedOn: 'Sep 12', archivedBy: 'Sai Kamara', reason: 'Replaced by a newer version' });
  docs.push(
    { id: 'd6', name: 'Humana Gold Plus SOB 2025.pdf', type: 'PDF', size: '1.8 MB', client: 'Inés Ortega-Ruiz', related: 'Enrollment: Humana Gold Plus HMO', added: 'Jan 8', archived: true, archivedOn: 'Sep 3', archivedBy: 'Sai Kamara', reason: 'Plan year ended' },
    { id: 'd7', name: 'Duplicate Medicare card scan.jpg', type: 'JPG', size: '1.1 MB', client: 'Marjorie Calloway', related: '', added: 'Sep 24', archived: true, archivedOn: 'Sep 24', archivedBy: 'Sai Kamara', reason: 'Duplicate upload' },
    { id: 'd8', name: 'Level 1 appeal draft (v1).docx', type: 'DOCX', size: '46 KB', client: 'Otis Brewer', related: 'Appeal: Level 1 reconsideration', added: 'Sep 20', archived: true, archivedOn: 'Sep 22', archivedBy: 'Renata Aguirre', reason: 'Replaced by a newer version' },
    { id: 'd9', name: 'Pharmacy receipt March.png', type: 'PNG', size: '380 KB', client: 'Priya Ramanathan', related: '', added: 'Mar 30', archived: true, archivedOn: 'Aug 14', archivedBy: 'Sai Kamara', reason: 'No longer needed' },
    { id: 'd10', name: 'Employer coverage letter.pdf', type: 'PDF', size: '152 KB', client: 'Darnell Washington', related: 'Enrollment: Aetna Prime HMO', added: 'Jul 2', archived: true, archivedOn: 'Jul 28', archivedBy: 'Mehmet Aydın', reason: 'Uploaded to the wrong client' },
  );
})();

const TYPE_IC = { PDF: 'file-pdf', DOC: 'file-doc', DOCX: 'file-doc', JPG: 'file-image', JPEG: 'file-image', PNG: 'file-image' };
const REASONS = ['Replaced by a newer version', 'Duplicate upload', 'Plan year ended', 'Uploaded to the wrong client', 'No longer needed'];

function ArchivePreview({ d, onClose, onRestore }) {
  useEAr(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  return (
    <>
      <div className="cx-scrim" onClick={onClose} />
      <aside className="cx-drawer" role="dialog" aria-label={d.name}>
        <header className="cx-d-head">
          <span className="ar-type lg">{ArI(TYPE_IC[d.type] || 'file')}</span>
          <div className="cx-d-title"><h2 className="ar-d-name">{d.name}</h2><span className="cx-card-sub"><span className="cx-badge">{d.type}</span><small>{d.size}</small></span></div>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">{ArI('x')}</button>
        </header>
        <div className="cx-d-body">
          <div className="cx-note mute">{ArI('archive')}<div><strong>Archived {d.archivedOn}</strong><span>This file is read-only while archived. Restore it to attach it to new work or share it.</span></div></div>
          <div className="ar-page" aria-label="Document preview">
            <span className="ar-page-ic">{ArI(TYPE_IC[d.type] || 'file')}</span>
            <strong>{d.name}</strong>
            <small>Preview of a sample file</small>
          </div>
          <dl className="cx-meta cx-meta-d ar-meta">
            <div><dt>Client</dt><dd>{d.client}</dd></div>
            <div><dt>Linked record</dt><dd>{d.related ? d.related : 'None'}</dd></div>
            <div><dt>Uploaded</dt><dd>{d.added}</dd></div>
            <div><dt>Archived by</dt><dd>{d.archivedBy || 'Sai Kamara'}</dd></div>
            <div className="ar-span"><dt>Reason</dt><dd>{d.reason || 'No reason given'}</dd></div>
          </dl>
          <section>
            <h3>History</h3>
            <ul className="cx-act">
              <li><div><strong>Archived</strong><span className="cx-act-what">{d.archivedBy || 'Sai Kamara'} · {d.reason || 'No reason given'}</span><small>{d.archivedOn}</small></div></li>
              <li><div><strong>Uploaded</strong><span className="cx-act-what">Added to {d.client}{d.related ? ` · ${d.related}` : ''}</span><small>{d.added}</small></div></li>
            </ul>
          </section>
        </div>
        <footer className="cx-d-foot">
          <button className="btn accent" onClick={() => onRestore([d.id])}>{ArI('arrow-counter-clockwise')} Restore</button>
          <span className="workspace-small">Returns to {d.client}{d.related ? ' and its linked record' : ''}.</span>
        </footer>
      </aside>
    </>
  );
}

function ArchivedDocumentsPage({ ctx }) {
  const [q, setQ] = useSAr('');
  const [client, setClient] = useSAr('All clients');
  const [type, setType] = useSAr('All types');
  const [reason, setReason] = useSAr('All reasons');
  const [sel, setSel] = useSAr([]);
  const [open, setOpen] = useSAr(null);

  const archived = ctx.docs.filter(d => d.archived);
  const clients = [...new Set(archived.map(d => d.client))].sort();
  const list = archived
    .filter(d => client === 'All clients' || d.client === client)
    .filter(d => type === 'All types' || (type === 'Images' ? ['JPG', 'JPEG', 'PNG'].includes(d.type) : type === 'Word' ? ['DOC', 'DOCX'].includes(d.type) : d.type === type))
    .filter(d => reason === 'All reasons' || d.reason === reason)
    .filter(d => !q.trim() || `${d.name} ${d.client} ${d.related} ${d.reason}`.toLowerCase().includes(q.toLowerCase()));
  const filtered = client !== 'All clients' || type !== 'All types' || reason !== 'All reasons' || q.trim();
  const allOn = list.length > 0 && list.every(d => sel.includes(d.id));
  const toggle = (id) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const restore = (ids) => {
    const names = ctx.docs.filter(d => ids.includes(d.id)).map(d => d.name);
    ctx.setDocs(ds => ds.map(d => ids.includes(d.id) ? { ...d, archived: false } : d));
    setSel(s => s.filter(x => !ids.includes(x))); setOpen(null);
    const undo = () => ctx.setDocs(ds => ds.map(d => ids.includes(d.id) ? { ...d, archived: true } : d));
    ctx.flash(ids.length === 1 ? `Restored ${names[0]} to Documents.` : `Restored ${ids.length} documents to Documents.`, undo);
  };
  const openDoc = open && ctx.docs.find(d => d.id === open);
  const clear = () => { setQ(''); setClient('All clients'); setType('All types'); setReason('All reasons'); };

  return (
    <>
      <window.PageHead eyebrow="Workspace · Documents" title="Archived documents"
        sub="Files you removed from active work. They stay here, read-only, until you restore them."
        action={<button className="btn" onClick={() => ctx.nav('Documents')}>{ArI('arrow-left')} Back to Documents</button>} />

      <div className="card ar-policy">
        {ArI('shield-check')}
        <div><strong>Archived files are never deleted.</strong><span>HealthFlow keeps every client record so it can be reviewed later. Restore a file at any time to use it again.</span></div>
        <div className="ar-stat"><b>{archived.length}</b><small>archived</small></div>
      </div>

      <section className="card workspace-section">
        <div className="ar-filters">
          <label className="search ar-search">{ArI('magnifying-glass')}<input value={q} onChange={e => setQ(e.target.value)} placeholder="Search file name, client, or reason" aria-label="Search archived documents" /></label>
          <label className="workspace-filter">Client<select value={client} onChange={e => setClient(e.target.value)}><option>All clients</option>{clients.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="workspace-filter">Type<select value={type} onChange={e => setType(e.target.value)}>{['All types', 'PDF', 'Word', 'Images'].map(t => <option key={t}>{t}</option>)}</select></label>
          <label className="workspace-filter">Reason<select value={reason} onChange={e => setReason(e.target.value)}><option>All reasons</option>{REASONS.map(r => <option key={r}>{r}</option>)}</select></label>
        </div>

        {sel.length > 0 && (
          <div className="ar-bulk">
            <span><b>{sel.length}</b> selected</span>
            <button className="td-link" onClick={() => setSel([])}>Clear</button>
            <button className="btn sm accent" onClick={() => restore(sel)}>{ArI('arrow-counter-clockwise')} Restore {sel.length === 1 ? 'file' : `${sel.length} files`}</button>
          </div>
        )}

        {archived.length === 0 ? (
          <div className="ar-empty">
            <span className="cx-empty-ic">{ArI('archive')}</span>
            <strong>Nothing archived</strong>
            <p>When you archive a document it moves here, so active work stays tidy without losing any records.</p>
            <button className="btn" onClick={() => ctx.nav('Documents')}>Go to Documents</button>
          </div>
        ) : list.length === 0 ? (
          <div className="ar-empty">
            <strong>No archived documents match.</strong>
            {filtered && <button className="td-link" onClick={clear}>Clear filters</button>}
          </div>
        ) : (
          <div className="ar-table" role="table" aria-label="Archived documents">
            <div className="ar-row ar-headrow" role="row">
              <span role="columnheader"><input type="checkbox" className="cbx" checked={allOn} onChange={() => setSel(allOn ? [] : list.map(d => d.id))} aria-label="Select all" /></span>
              <span role="columnheader">Document</span><span role="columnheader">Client</span><span role="columnheader">Reason</span><span role="columnheader">Archived</span><span role="columnheader" />
            </div>
            {list.map(d => (
              <div key={d.id} role="row" className={`ar-row ${sel.includes(d.id) ? 'on' : ''}`}>
                <span role="cell"><input type="checkbox" className="cbx" checked={sel.includes(d.id)} onChange={() => toggle(d.id)} aria-label={`Select ${d.name}`} /></span>
                <button role="cell" className="ar-doc" onClick={() => setOpen(d.id)}>
                  <span className="ar-type">{ArI(TYPE_IC[d.type] || 'file')}</span>
                  <span className="ar-doc-copy"><strong>{d.name}</strong><small>{d.type} · {d.size}{d.related ? ` · ${d.related}` : ''}</small></span>
                </button>
                <span role="cell" className="ar-client">{d.client}</span>
                <span role="cell" className="ar-reason">{d.reason || 'No reason given'}</span>
                <span role="cell" className="ar-when"><b>{d.archivedOn}</b><small>{d.archivedBy || 'Sai Kamara'}</small></span>
                <span role="cell" className="ar-act"><button className="btn sm" onClick={() => restore([d.id])}>{ArI('arrow-counter-clockwise')} Restore</button></span>
              </div>
            ))}
          </div>
        )}
      </section>

      {openDoc && openDoc.archived && <ArchivePreview d={openDoc} onClose={() => setOpen(null)} onRestore={restore} />}
    </>
  );
}

window.WS_PAGES = Object.assign(window.WS_PAGES || {}, { 'Archived documents': ArchivedDocumentsPage });
