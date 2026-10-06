/* global React */
const { useState: useS, useRef: useR, useEffect: useE } = React;
const IC = (p) => { const C = window.Ico; return <C {...p} />; };
const Head = (p) => { const H = window.PageHead; return <H {...p} />; };
const names = () => window.CLIENT_ROWS.map(c => c.name);

window.SEED_DOCS = [
  { id: 'd1', name: 'Cigna denial letter.pdf', type: 'PDF', size: '212 KB', client: 'Otis Brewer', related: 'Issue: Cardiac catheterization denied by Cigna', added: 'Sep 19' },
  { id: 'd2', name: 'Scope of Appointment (signed).pdf', type: 'PDF', size: '88 KB', client: 'Marjorie Calloway', related: 'Enrollment: Aetna Prime HMO', added: 'Sep 24' },
  { id: 'd3', name: 'Medicare card (front).jpg', type: 'JPG', size: '1.2 MB', client: 'Marjorie Calloway', related: '', added: 'Sep 24' },
  { id: 'd4', name: 'Pharmacy network notice.png', type: 'PNG', size: '640 KB', client: 'Inés Ortega-Ruiz', related: 'Issue: Preferred pharmacy left the plan network', added: 'Sep 25' },
  { id: 'd5', name: 'Old intake notes.docx', type: 'DOCX', size: '24 KB', client: 'Howard Tenenbaum', related: '', added: 'Aug 30', archived: true },
];
const RELATED = ['Enrollment: Aetna Prime HMO', 'Enrollment: Humana Gold Plus HMO', 'Issue: Cardiac catheterization denied by Cigna', 'Issue: Preferred pharmacy left the plan network', 'Appeal: Level 1 reconsideration'];
const TOOL_HISTORY = [
  { tool: 'Compare Plans', client: 'Marjorie Calloway', summary: 'Aetna Prime HMO ranked first of 8 plans', when: 'Today, 9:58 AM', model: 'claude-haiku-4-5' },
  { tool: 'Explain Coverage', client: 'Marjorie Calloway', summary: 'Dental crowns: 50% after deductible, $1,500 annual limit', when: 'Today, 9:20 AM', model: 'claude-haiku-4-5' },
  { tool: 'Check Network', client: 'Otis Brewer', summary: '1 provider checked, listed in 2 of 3 plans', when: 'Yesterday, 4:12 PM', model: 'rules' },
  { tool: 'Draft Appeal', client: 'Otis Brewer', summary: 'Level 1 reconsideration draft, not saved', when: 'Sep 25, 2:40 PM', model: 'claude-sonnet-4' },
  { tool: 'Estimate Costs', client: 'Howard Tenenbaum', summary: 'Humana Gold Plus lowest at $1,910 per year', when: 'Sep 24, 11:05 AM', model: 'rules' },
];

function SaveDocDialog({ open, onClose, onSave, defaultName, defaultClient }) {
  const ref = useR(null);
  const [f, setF] = useS({});
  useE(() => {
    const el = ref.current; if (!el) return;
    if (open && !el.open) { setF({ name: defaultName, client: defaultClient || '', related: '', ok: false }); el.showModal(); }
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} className="workspace-dialog" onClose={onClose} aria-labelledby="sd-t">
      {open && (
        <form onSubmit={e => { e.preventDefault(); if (f.client && f.ok) onSave(f); }}>
          <div className="between"><h2 id="sd-t">Save as document</h2><button type="button" className="btn ghost icon sm" onClick={onClose} aria-label="Close"><IC n="x" className="" /></button></div>
          <p className="workspace-small">Tool output is temporary until you save it. Saved documents stay with the client record.</p>
          <label>Document name<input value={f.name || ''} onChange={e => setF({ ...f, name: e.target.value })} /></label>
          <label>Client<select value={f.client} onChange={e => setF({ ...f, client: e.target.value })}><option value="">Choose a client</option>{names().map(n => <option key={n}>{n}</option>)}</select></label>
          <label>Related record<select value={f.related} onChange={e => setF({ ...f, related: e.target.value })}><option value="">None</option>{RELATED.map(r => <option key={r}>{r}</option>)}</select></label>
          <label className="workspace-check"><input type="checkbox" checked={!!f.ok} onChange={e => setF({ ...f, ok: e.target.checked })} /> I reviewed this output and want to save it to the record</label>
          <div className="quick-create-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn accent" disabled={!f.client || !f.ok}>Save document</button></div>
        </form>
      )}
    </dialog>
  );
}

function useSaveDoc(ctx, defaultName, defaultClient) {
  const [open, setOpen] = useS(false);
  const el = <SaveDocDialog open={open} onClose={() => setOpen(false)} defaultName={defaultName} defaultClient={defaultClient}
    onSave={(f) => { ctx.setDocs(d => [{ id: 'd' + Date.now(), name: f.name, type: 'PDF', size: 'Generated', client: f.client, related: f.related, added: 'Today' }, ...d]); ctx.flash(`Saved to ${f.client}'s documents.`); setOpen(false); }} />;
  return [el, () => setOpen(true)];
}

function OverviewPage({ ctx }) {
  const { NOW, TODAY0, DAY_MS } = window.WS;
  const open = ctx.tasks.filter(t => !ctx.done.includes(t.id));
  const wk = ctx.appts.filter(a => a.start >= NOW && a.start < new Date(TODAY0.getTime() + 8 * DAY_MS) && a.status !== 'Canceled');
  const cards = [
    ['Clients', window.CLIENT_ROWS.length, 'Clients'], ['Organizations', 5, 'Organizations'], ['Open tasks', open.length, 'Follow-ups'],
    ['Overdue', open.filter(t => t.due && t.due < NOW).length, 'Today'], ['Next 7 days', wk.length, 'Scheduling'], ['Active enrollments', 3, 'Enrollments'], ['Open issues', 3, 'Issues & Appeals'],
  ];
  const workload = [['Follow-ups', open.filter(t => t.followup).length], ['Other tasks', open.filter(t => !t.followup && t.due).length], ['Unscheduled', open.filter(t => !t.due).length]];
  const max = Math.max(1, ...workload.map(w => w[1]));
  return (
    <>
      <Head eyebrow="Whole workspace" title="Overview" sub="A read-only summary of your clients, work, and recent activity. Select a card to open its list." />
      <div className="ov-cards">
        {cards.map(([l, n, to]) => (
          <button key={l} className={`card ov-card ${l === 'Overdue' && n ? 'neg' : ''}`} onClick={() => ctx.nav(to)}><small>{l}</small><strong>{n}</strong><span>Open {to} <IC n="chev" s={12} className="" /></span></button>
        ))}
      </div>
      <div className="today-grid">
        <section className="card workspace-section">
          <div className="between"><h2>Recent activity</h2><button className="td-link" onClick={() => ctx.nav('Activity')}>View all</button></div>
          <ActivityList items={ctx.activity.slice(0, 6)} />
        </section>
        <section className="card workspace-section">
          <h2>Workload</h2>
          {workload.map(([l, n]) => <div key={l} className="ov-bar"><div className="between"><span>{l}</span><strong className="mono">{n}</strong></div><div className="ws-bar"><span style={{ width: `${(n / max) * 100}%` }} /></div></div>)}
          <div className="workspace-subheading">Upcoming</div>
          <ul className="workspace-list">{wk.slice(0, 4).map(a => <li key={a.id} className="workspace-list-row"><div className="workspace-row-copy"><strong>{a.title}</strong><small>{window.WS.fmtDay(a.start)} · {window.WS.fmtTime(a.start)}{a.client ? ` · ${a.client}` : ''}</small></div></li>)}</ul>
        </section>
      </div>
    </>
  );
}

function ActivityList({ items }) {
  if (!items.length) return <p className="workspace-empty">No activity yet.</p>;
  return <ul className="workspace-list">{items.map((a, i) => (
    <li key={i} className="workspace-list-row"><span className={`chip ${a.tone || ''}`}>{a.kind}</span><div className="workspace-row-copy"><strong>{a.text}</strong>{a.client && <small>{a.client}</small>}</div><span className="td-when">{a.when}</span></li>
  ))}</ul>;
}

function ActivityPage({ ctx }) {
  const [kind, setKind] = useS('All');
  const kinds = ['All', ...Array.from(new Set(ctx.activity.map(a => a.kind)))];
  const items = ctx.activity.filter(a => kind === 'All' || a.kind === kind);
  return (
    <>
      <Head title="Activity" sub="Completed tasks, appointments, and Tool work across your workspace." />
      <div className="ws-pills ov-pad">{kinds.map(k => <button key={k} className={`ws-pill ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k}<span>{k === 'All' ? ctx.activity.length : ctx.activity.filter(a => a.kind === k).length}</span></button>)}</div>
      <section className="card workspace-section"><ActivityList items={items} /></section>
    </>
  );
}

function ToolHistoryPage({ ctx }) {
  return (
    <>
      <Head title="Tool history" sub="Every Tool run with its client, result summary, and model. Results you did not save stay here only." />
      <section className="card ws-table-card"><div className="ws-scroll"><table className="tbl">
        <thead><tr><th>Tool</th><th>Client</th><th>Result</th><th>Source</th><th>When</th><th aria-label="Actions"></th></tr></thead>
        <tbody>{TOOL_HISTORY.map((r, i) => (
          <tr key={i}><td><strong>{r.tool}</strong></td><td>{r.client}</td><td>{r.summary}</td><td>{(() => { const k = { 'Compare Plans': 'compare', 'Explain Coverage': 'explain', 'Check Network': 'network', 'Draft Appeal': 'appeal', 'Estimate Costs': 'cost' }[r.tool]; const s = window.TOOL_FLOW[k].sources[0]; return <window.SourceChip label={s[0]} detail={s[1]} />; })()}</td><td className="muted">{r.when}</td>
            <td><button className="btn sm" onClick={() => ctx.nav(r.tool)}>Open Tool</button></td></tr>
        ))}</tbody>
      </table></div></section>
    </>
  );
}

const ACCEPT = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
function DocumentsPage({ ctx }) {
  const [view, setView] = useS('Active');
  const [client, setClient] = useS('All clients');
  const [up, setUp] = useS({ client: '', related: '', err: '' });
  const [preview, setPreview] = useS(null);
  const fileRef = useR(null);
  const list = ctx.docs.filter(d => !d.archived).filter(d => client === 'All clients' || d.client === client);
  const upload = (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ACCEPT.includes(ext)) return setUp({ ...up, err: `${file.name} is not a supported type. Use PDF, Word, JPG, or PNG.` });
    if (!up.client) return setUp({ ...up, err: 'Choose a client before uploading.' });
    ctx.setDocs(d => [{ id: 'd' + Date.now(), name: file.name, type: ext.toUpperCase(), size: `${Math.max(1, Math.round(file.size / 1024))} KB`, client: up.client, related: up.related, added: 'Today', url: ['jpg', 'jpeg', 'png'].includes(ext) ? URL.createObjectURL(file) : null }, ...d]);
    setUp({ ...up, err: '' }); ctx.flash(`Uploaded ${file.name}.`);
  };
  const toggleArch = (doc) => { ctx.setDocs(ds => ds.map(d => d.id === doc.id ? { ...d, archived: !d.archived, archivedOn: 'Today', archivedBy: 'Sai Kamara', reason: d.reason || 'No longer needed' } : d)); ctx.flash(doc.archived ? `${doc.name} restored.` : `${doc.name} archived. Restore it from Archived.`); };
  return (
    <>
      <Head title="Documents" sub="Supporting records for your clients. One document can appear on a client and its enrollment, issue, or appeal." />
      <section className="card workspace-section workspace-inline-form doc-upload">
        <h2>Upload</h2>
        <div className="ws-grid3">
          <label>Client<select value={up.client} onChange={e => setUp({ ...up, client: e.target.value, err: '' })}><option value="">Choose a client</option>{names().map(n => <option key={n}>{n}</option>)}</select></label>
          <label>Related record<select value={up.related} onChange={e => setUp({ ...up, related: e.target.value })}><option value="">None</option>{RELATED.map(r => <option key={r}>{r}</option>)}</select></label>
          <label>File<button type="button" className="btn" onClick={() => fileRef.current.click()}><IC n="download" s={15} className="doc-up-ic" /> Choose file</button></label>
        </div>
        <input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={upload} />
        <small className="workspace-small">PDF, Word, JPG, or PNG. Files open only inside your workspace.</small>
        {up.err && <span className="td-err">{up.err}</span>}
      </section>
      <section className="card workspace-section">
        <div className="ws-filter-row">
          <label className="workspace-filter">Client<select value={client} onChange={e => setClient(e.target.value)}><option>All clients</option>{names().map(n => <option key={n}>{n}</option>)}</select></label>
          <button className="btn sm ar-open-link" onClick={() => ctx.nav('Archived documents')}><IC n="archive" s={13} className="" /><span>{`Archived (${ctx.docs.filter(d => d.archived).length})`}</span></button>
        </div>
        {list.length === 0 && <p className="workspace-empty">No documents for this view.</p>}
        <ul className="workspace-list">{list.map(d => (
          <li key={d.id} className="workspace-list-row">
            <span className="doc-type">{d.type}</span>
            <div className="workspace-row-copy"><strong>{d.name}</strong><small>{d.client}{d.related ? ` · ${d.related}` : ''} · {d.size} · Added {d.added}</small></div>
            <div className="workspace-row-actions">
              {!d.archived && <button className="btn sm" onClick={() => setPreview(d)}>Open</button>}
              <button className="btn sm" onClick={() => toggleArch(d)}><IC n="archive" s={13} className="" /> {d.archived ? 'Restore' : 'Archive'}</button>
            </div>
          </li>
        ))}</ul>
      </section>
      {preview && (
        <div className="doc-preview" role="dialog" aria-label={preview.name} onClick={() => setPreview(null)}>
          <div className="card" onClick={e => e.stopPropagation()}>
            <div className="between"><h2>{preview.name}</h2><button className="btn ghost icon sm" aria-label="Close" onClick={() => setPreview(null)}><IC n="x" className="" /></button></div>
            {preview.url ? <img src={preview.url} alt={preview.name} /> : <div className="doc-page"><strong>{preview.name}</strong><small>{preview.client}</small><p>Preview of stored document. In the app this opens through your secure, broker-only link.</p></div>}
          </div>
        </div>
      )}
    </>
  );
}

const PLANS_C = [
  { name: 'Aetna Prime (HMO)', premium: 0, ded: 0, oop: 4150, stars: 4.5, est: 1864 },
  { name: 'Humana Gold Plus (HMO)', premium: 29, ded: 0, oop: 6700, stars: 4.0, est: 2596 },
  { name: 'UHC Complete II (PPO)', premium: 42, ded: 250, oop: 7550, stars: 4.0, est: 3120 },
];
const fromClient = (name, base) => { const c = window.CLIENT_ROWS.find(x => x.name === name); return c ? { ...base, client: c.name, zip: c.zip, age: String(c.age), income: c.income[0].toUpperCase() + c.income.slice(1) } : { ...base, client: '' }; };
function ComparePlansPage({ ctx }) {
  const [f, setF] = useS(() => fromClient(ctx.client, { client: '', zip: '10025', age: '67', income: 'Medium', meds: 'Metformin, Lisinopril' }));
  useE(() => { if ((ctx.client || '') !== f.client) setF(v => fromClient(ctx.client, v)); }, [ctx.client]);
  const [st, setSt] = useS('idle');
  const [dlg, openSave] = useSaveDoc(ctx, 'Plan comparison.pdf', f.client);
  const run = (e) => { e.preventDefault(); if (!/^\d{5}$/.test(f.zip) || !f.age) return; setSt('loading'); setTimeout(() => setSt('ok'), window.flowTime('compare', f)); };
  return (
    <>
      <Head eyebrow="Medicare Advantage · 2026 plan year" title="Compare plans." sub="Rank plans in a client's ZIP by estimated annual cost, weighted to their medications and providers." />
      <form className="card workspace-section workspace-inline-form" onSubmit={run}>
        <div className="ws-grid3">
          <label>Client<select value={f.client} onChange={e => { setF(fromClient(e.target.value, f)); ctx.setClient(e.target.value); }}><option value="">None</option>{names().map(n => <option key={n}>{n}</option>)}</select></label>
          <label>ZIP code<input value={f.zip} maxLength={5} onChange={e => setF({ ...f, zip: e.target.value })} /></label>
          <label>Age<input type="number" value={f.age} onChange={e => setF({ ...f, age: e.target.value })} /></label>
          <label>Income<select value={f.income} onChange={e => setF({ ...f, income: e.target.value })}><option>Low</option><option>Medium</option><option>High</option></select></label>
          <label className="cp-span2">Medications<input value={f.meds} onChange={e => setF({ ...f, meds: e.target.value })} placeholder="Comma separated" /></label>
        </div>
        <div className="ws-submit"><button className="btn accent lg" disabled={st === 'loading'}><IC n="compare" s={16} className="" /> {st === 'loading' ? 'Comparing…' : 'Compare plans'}</button></div>
      </form>
      {st === 'loading' && <section className="card workspace-section"><window.RunSteps steps={window.TOOL_FLOW.compare.steps(f)} title="Comparing plans" /></section>}
      {st === 'ok' && (
        <section className="card workspace-section ws-results">
          <div className="between"><h2>Recommendation</h2><div className="quick-create-actions"><button className="btn sm" onClick={openSave}>Save as document</button></div></div>
          <p className="cp-rec"><strong>{PLANS_C[0].name}</strong> ranks first of 8 plans for ZIP {f.zip}. It has no premium or deductible, the lowest out-of-pocket maximum, and all listed medications are on Tier 1 or 2.</p>
          <window.SourceRow items={window.TOOL_FLOW.compare.sources} />
          <div className="cp-grid">{PLANS_C.map((p, i) => (
            <div key={p.name} className={`cp-plan ${i === 0 ? 'best' : ''}`}>
              {i === 0 && <span className="chip pos">Best fit</span>}
              <h3>{p.name}</h3><small>{p.stars.toFixed(1)} stars</small>
              <dl><div><dt>Premium</dt><dd>${p.premium}/mo</dd></div><div><dt>Deductible</dt><dd>${p.ded}</dd></div><div><dt>Out-of-pocket max</dt><dd>${p.oop.toLocaleString()}</dd></div><div><dt>Estimated per year</dt><dd>${p.est.toLocaleString()}</dd></div></dl>
            </div>
          ))}</div>
          <window.RunRecord kind="compare" input={f} note="Estimates use CMS 2026 plan data. Confirm details with the plan before enrollment." />
        </section>
      )}
      {dlg}
    </>
  );
}

const SOB = `SUMMARY OF BENEFITS · AETNA PRIME HMO
1.2 Emergency care: $120 copay, waived if admitted within 24 hours.
2.1 Primary care: $0 copay. Specialist: $35 copay, referral required.
3.2 Inpatient stay: $350 per day for days 1 to 5, $0 after.
4.1 Prescription drugs: Tier 1 $0, Tier 2 $8, Tier 3 $40, Tier 4 $95, Tier 5 33%.
5.3 Dental: preventive covered in full. Crowns 50% after deductible, $1,500 annual limit.`;
const ANSWERS = [
  [/er|emergency|admit/i, 'The emergency room copay is $120. It is waived if the client is admitted within 24 hours, and the stay then falls under the inpatient benefit at $350 per day for days 1 to 5.', ['1.2 Emergency care', '3.2 Inpatient stay']],
  [/dental|crown|teeth/i, 'Preventive dental is covered in full. Crowns are covered at 50% after the deductible, up to a $1,500 annual limit.', ['5.3 Dental']],
  [/specialist|referral/i, 'Specialist visits have a $35 copay and need a referral from the primary care doctor.', ['2.1 Primary care']],
  [/drug|tier|rx|medication/i, 'Drug costs by tier: Tier 1 $0, Tier 2 $8, Tier 3 $40, Tier 4 $95, and Tier 5 is 33% coinsurance.', ['4.1 Prescription drugs']],
];
function ExplainCoveragePage({ ctx }) {
  const [doc, setDoc] = useS(SOB);
  const [q, setQ] = useS('');
  const [msgs, setMsgs] = useS([]);
  const [busy, setBusy] = useS(false);
  const [dlg, openSave] = useSaveDoc(ctx, 'Coverage answers.pdf', 'Marjorie Calloway');
  const ask = (text) => {
    const t = (text || q).trim(); if (!t || busy) return;
    setQ(''); setMsgs(m => [...m, { role: 'you', text: t }]); setBusy(true);
    setTimeout(() => {
      const hit = ANSWERS.find(([re]) => re.test(t));
      setMsgs(m => [...m, hit ? { role: 'tool', text: hit[1], cites: hit[2] } : { role: 'tool', text: 'I could not find that in this document. Try asking about emergency care, specialists, drugs, or dental.', cites: [] }]);
      setBusy(false);
    }, window.flowTime('explain'));
  };
  return (
    <>
      <Head eyebrow="Plain-language answers with citations" title="Explain coverage." sub="Paste a Summary of Benefits and ask a question. Each answer cites the section it came from." />
      <div className="phase2-grid">
        <section className="card workspace-section workspace-inline-form"><h2>Document</h2><label>Summary of Benefits text<textarea className="ec-doc" rows={14} value={doc} onChange={e => setDoc(e.target.value)} /></label></section>
        <section className="card workspace-section">
          <div className="between"><h2>Questions</h2>{msgs.some(m => m.role === 'tool') && <button className="btn sm" onClick={openSave}>Save as document</button>}</div>
          {msgs.length === 0 && <p className="workspace-empty">Ask about copays, drug tiers, referrals, or dental.</p>}
          <div className="ec-thread">{msgs.map((m, i) => (
            <div key={i} className={`ec-msg ${m.role}`}><small>{m.role === 'you' ? 'You asked' : 'Explain Coverage'}</small><p>{m.text}</p>{m.cites && m.cites.length > 0 && <window.SourceRow lead="Cited" items={m.cites.map(x => ['Summary of Benefits', `§${x}`])} />}{m.role === 'tool' && <window.MsgRecord kind="explain" cites={m.cites} />}</div>
          ))}{busy && <div className="ec-msg tool"><small>Explain Coverage</small><window.RunSteps compact steps={window.TOOL_FLOW.explain.steps()} /></div>}</div>
          <form className="ec-ask" onSubmit={e => { e.preventDefault(); ask(); }}><input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about this plan" aria-label="Question" /><button className="btn accent" disabled={!q.trim() || busy}>Ask</button></form>
          <div className="ws-chips ec-suggest">{['What is the ER copay if admitted?', 'Are crowns covered?', 'Do specialists need a referral?'].map(s => <button key={s} className="btn sm" onClick={() => ask(s)}>{s}</button>)}</div>
        </section>
      </div>
      {dlg}
    </>
  );
}

const ISSUES_C = ['Cardiac catheterization denied by Cigna', 'Preferred pharmacy left the plan network', 'Humira moved to a higher tier'];
function DraftAppealPage({ ctx }) {
  const [issue, setIssue] = useS('');
  const [newIssue, setNewIssue] = useS(false);
  const [f, setF] = useS({ title: '', reason: 'Cardiac catheterization was denied as not medically necessary.' });
  const [draft, setDraft] = useS('');
  const [busy, setBusy] = useS(false);
  const [dlg, openSave] = useSaveDoc(ctx, 'Appeal draft.docx', 'Otis Brewer');
  const ready = issue || (newIssue && f.title.trim());
  const gen = () => {
    setBusy(true);
    setTimeout(() => { setDraft(`Re: Request for reconsideration\nIssue: ${issue || f.title}\n\nI am writing on behalf of my client to request reconsideration of the denial dated September 18, 2026. ${f.reason}\n\nThe attending cardiologist's letter documents ongoing symptoms and abnormal stress test results. Under CMS LCD L33559, diagnostic catheterization is covered when noninvasive testing indicates significant ischemia.\n\nWe ask that the plan reverse the denial and approve the procedure. The supporting records are attached.\n\nSincerely,\nSai Kamara, licensed broker`); setBusy(false); }, window.flowTime('appeal'));
  };
  return (
    <>
      <Head eyebrow="Every appeal belongs to an issue" title="Draft an appeal." sub="Choose the issue this appeal is for, add the denial reason, and review the draft before saving it." />
      <div className="phase2-grid">
        <section className="card workspace-section workspace-inline-form">
          <h2>1. Issue</h2>
          {!newIssue ? (
            <label>Existing issue<select value={issue} onChange={e => setIssue(e.target.value)}><option value="">Choose an issue</option>{ISSUES_C.map(i => <option key={i}>{i}</option>)}</select></label>
          ) : (
            <label>New issue title<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="What went wrong?" /></label>
          )}
          <button type="button" className="td-link" onClick={() => { setNewIssue(!newIssue); setIssue(''); }}>{newIssue ? 'Use an existing issue instead' : 'Create a new issue for this appeal'}</button>
          {newIssue && f.title.trim() && <p className="ws-note">A new issue named “{f.title.trim()}” will be created when you generate the draft.</p>}
          <h2 className="da-step">2. Denial details</h2>
          <label>Denial reason<textarea rows={4} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></label>
          <button type="button" className="btn accent" disabled={!ready || busy} onClick={gen}><IC n="appeal" s={15} className="" /> {busy ? 'Drafting…' : 'Generate draft'}</button>
        </section>
        <section className="card workspace-section">
          <div className="between"><h2>Draft</h2>{draft && <button className="btn sm" onClick={openSave}>Save as document</button>}</div>
          {busy ? <window.RunSteps steps={window.TOOL_FLOW.appeal.steps()} title="Drafting" /> : !draft ? <p className="workspace-empty">{ready ? 'Generate a draft to review it here.' : 'Choose an issue to start.'}</p> : (
            <><textarea className="da-draft" rows={16} value={draft} onChange={e => setDraft(e.target.value)} aria-label="Appeal draft" />
              <window.RunRecord kind="appeal" note="This draft is temporary until you save it. Review it before filing with the carrier." /></>
          )}
        </section>
      </div>
      {dlg}
    </>
  );
}

const ASK_PROMPTS = [
  ['What needs my attention today?', 'Overdue tasks, meetings, and flags'],
  ['Remind me to follow up tomorrow', 'Prepares a task for you to review'],
  ['Schedule a plan review', 'Prepares an appointment'],
  ['Summarize this client', 'Needs a client in context'],
  ['Compare plans for this client', 'Prepares Compare Plans for you to open'],
  ['Is Dr. Patel in network?', 'Routes to Check Network'],
];
const PHRASE = 'Remind me to call about the plan review tomorrow morning';

const ASK_ROUTES = [
  { name: 'Draft Appeal', ic: 'appeal', re: /appeal|denial|denied/i, inputs: r => [['Client', r.name], ['Issue', 'Choose on the next step']] },
  { name: 'Check Network', ic: 'network', re: /network|in-network|doctor|provider|pharmacy/i, needsClient: true, inputs: r => [['Client', r.name], ['ZIP code', r.zip], ['Providers', '2 on file']] },
  { name: 'Estimate Costs', ic: 'cost', re: /cost|estimate|how much|spend/i, needsClient: true, inputs: r => [['Client', r.name], ['ZIP code', r.zip], ['Income', r.income]] },
  { name: 'Explain Coverage', ic: 'explain', re: /explain|cover|copay|dental|benefit/i, inputs: r => [['Client', r.name], ['Document', 'Summary of Benefits on file']] },
  { name: 'Compare Plans', ic: 'compare', re: /compare|plans|cheaper|switch|best plan/i, needsClient: true, inputs: r => [['Client', r.name], ['ZIP code', r.zip], ['Age', String(r.age)], ['Income', r.income]] },
];
function AskPage({ ctx }) {
  const [client, setClient] = useS(ctx.client || '');
  useE(() => { if ((ctx.client || '') !== client) setClient(ctx.client || ''); }, [ctx.client]);
  useE(() => { if (client !== (ctx.client || '')) ctx.setClient(client); }, [client]);
  const [picker, setPicker] = useS(false);
  const [msgs, setMsgs] = useS([]);
  const [q, setQ] = useS('');
  const [busy, setBusy] = useS(false);
  const [prep, setPrep] = useS(null);
  const [voice, setVoice] = useS(null);
  const [level, setLevel] = useS(0);
  const [mic, setMic] = useS('ask'); // ask | granted | denied
  const [micSheet, setMicSheet] = useS(false);
  const [saveDlg, openSaveConv] = useSaveDoc(ctx, 'Ask HealthFlow conversation.pdf', client);
  const saved = ctx.docs.some(d => d.name === 'Ask HealthFlow conversation.pdf' && d.added === 'Today');
  const timers = useR([]);
  const endRef = useR(null);
  const clear = () => { timers.current.forEach(t => clearInterval(t)); timers.current = []; };
  useE(() => clear, []);
  useE(() => { endRef.current && endRef.current.parentElement && (endRef.current.parentElement.scrollTop = 1e6); }, [msgs, busy, prep]);

  const reply = (t) => {
    const tool = ASK_ROUTES.find(r => r.re.test(t));
    if (tool) {
      const row = client && window.CLIENT_ROWS.find(x => x.name === client);
      const inputs = row ? tool.inputs(row) : [];
      setPrep({ kind: 'tool', tool: tool.name, ic: tool.ic, client, inputs });
      if (tool.needsClient && !client) return `${tool.name} can answer this. I don't have a client in this conversation, so I'll open it without client details. Add a client first if you want theirs filled in.`;
      return `${tool.name} is the right Tool for this. I prepared its inputs${client ? ` from ${client}'s record` : ''}. Review them below, and I'll open it only when you confirm.`;
    }
    if (/save|attach|document/i.test(t)) { setPrep({ kind: 'doc', title: 'Ask HealthFlow conversation', client }); return 'I can save this conversation as a document. You choose the related record and confirm before anything is saved.'; }
    if (/follow|remind|task|call/i.test(t)) { setPrep({ kind: 'task', title: client ? `Call ${client.split(' ')[0]} about the plan review` : 'Follow up about the plan review', client }); return 'I prepared a follow-up task for tomorrow morning. Review it below and I will create it only after you confirm.'; }
    if (/meet|appointment|schedule/i.test(t)) { setPrep({ kind: 'appt', title: client ? `Plan review with ${client}` : 'Plan review', client }); return 'I prepared an appointment. Review it below to create it.'; }
    if (/submit|enroll/i.test(t)) return 'I can help prepare an enrollment, but only you can submit it. Open Enrollments to review the checkpoint.';
    if (/summar/i.test(t)) return client ? `${client} has 3 medications on file, 2 providers, and an upcoming renewal window. The last touch was a plan comparison this morning.` : 'Choose a client first. I can only read a client record after you add it to this conversation.';
    return client ? `For ${client}, the next step is the renewal review. Compare Plans or Check Network can help.` : 'You have 2 overdue tasks, 3 tasks due later today, and 2 meetings still ahead. The most urgent is the pharmacy network call for Inés Ortega-Ruiz.';
  };
  const send = (text) => {
    const t = (text ?? q).trim(); if (!t || busy) return;
    setQ(''); setPrep(null); setMsgs(m => [...m, { role: 'you', text: t }]); setBusy(true);
    setTimeout(() => { setMsgs(m => [...m, { role: 'tool', text: reply(t) }]); setBusy(false); }, window.flowTime('ask', t));
  };

  const startVoice = () => {
    clear(); setPrep(null);
    setVoice({ state: 'connecting', muted: false, paused: false, live: '', said: '', secs: 0, min: false });
    timers.current.push(setTimeout(() => setVoice(v => v && v.state === 'connecting' ? { ...v, state: 'listening' } : v), 1100));
    const words = PHRASE.split(' '); let i = 0;
    timers.current.push(setInterval(() => setVoice(v => v && !v.paused ? { ...v, secs: v.secs + 1 } : v), 1000));
    timers.current.push(setInterval(() => {
      setVoice(v => {
        if (!v || v.paused) return v;
        setLevel(v.muted ? 0 : v.state === 'thinking' ? 0.15 : 0.3 + Math.random() * 0.7);
        if (v.state === 'connecting') return v;
        if (v.state === 'listening' && v.interrupted && !v.muted) { i = words.length + 2; }
        if (v.state === 'listening' && !v.muted) {
          i++; const live = words.slice(0, i).join(' ');
          if (i >= words.length + 2) { if (v.interrupted) { setMsgs(m => [...m, { role: 'note', text: 'You interrupted. Ask HealthFlow stopped speaking.' }]); return { ...v, state: 'done', interrupted: false, live: '' }; } setMsgs(m => [...m, { role: 'you', text: PHRASE, voice: true }]); return { ...v, state: 'thinking', live }; }
          return { ...v, live };
        }
        if (v.state === 'thinking') { const r = reply(PHRASE); setMsgs(m => [...m, { role: 'tool', text: r, voice: true }]); return { ...v, state: 'speaking', said: r, spoken: 0 }; }
        if (v.state === 'speaking') { const n = (v.spoken || 0) + 3; const all = v.said.split(' '); if (n >= all.length + 3) return { ...v, state: 'done' }; return { ...v, spoken: n }; }
        return v;
      });
    }, 260));
  };
  const endVoice = () => { clear(); setVoice(null); setLevel(0); ctx.flash('Voice session ended. Audio was not saved.'); };
  const confirmPrep = () => {
    if (prep.kind === 'tool') { if (prep.client) ctx.setClient(prep.client); ctx.flash(`Opened ${prep.tool}${prep.client ? ` with ${prep.client}'s details` : ''}. Nothing has run yet.`); ctx.nav(prep.tool); return; }
    if (prep.kind === 'doc') { openSaveConv(); setPrep(null); return; }
    ctx.openCreate({ kind: prep.kind, prefill: { title: prep.title, client: prep.client, followup: prep.kind === 'task' } }); setPrep(null);
  };
  const requestVoice = () => { if (mic === 'granted') return startVoice(); setMicSheet(true); };
  const interrupt = () => setVoice(v => v ? { ...v, state: 'listening', live: '', said: '', spoken: 0, interrupted: true } : v);

  const ClientPicker = ({ up }) => (
    <div className="ask-ctx">
      <button type="button" className={`ask-ctx-btn ${client ? 'on' : ''}`} onClick={() => setPicker(!picker)} aria-expanded={picker}>
        <IC n="clients" s={14} className="" />{client ? client : 'Add client context'}
      </button>
      {client && <button type="button" className="ask-ctx-x" aria-label="Remove client context" onClick={() => setClient('')}><IC n="x" s={12} className="" /></button>}
      {picker && (
        <div className={`ask-pop ${up ? 'up' : ''}`} role="listbox">
          <div className="ask-pop-head">Only the client you choose is shared with Ask HealthFlow.</div>
          {names().map(n => <button key={n} role="option" aria-selected={client === n} className={client === n ? 'on' : ''} onClick={() => { setClient(n); setPicker(false); }}><span className="avatar">{n.split(' ').map(s => s[0]).slice(0, 2).join('')}</span>{n}</button>)}
        </div>
      )}
    </div>
  );

  const Composer = ({ big }) => (
    <form className={`ask-composer ${big ? 'big' : ''}`} onSubmit={e => { e.preventDefault(); send(); }}>
      <textarea rows={1} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={client ? `Ask about ${client}` : 'Ask HealthFlow anything'} aria-label="Message" />
      <div className="ask-composer-row">
        {ClientPicker({ up: !big })}
        <div className="ask-composer-actions">
          {q.trim() ? (
            <button className="ask-send" aria-label="Send" disabled={busy}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button>
          ) : (
            <button type="button" className="ask-voice-btn" onClick={requestVoice} aria-label="Start voice session"><span className="ask-bars" aria-hidden="true"><i /><i /><i /><i /></span>Voice</button>
          )}
        </div>
      </div>
    </form>
  );

  const empty = msgs.length === 0;
  const orbScale = voice ? 1 + level * (voice.state === 'speaking' ? 0.18 : 0.1) : 1;
  const status = !voice ? '' : voice.paused ? 'Paused' : voice.muted ? 'Microphone muted' : voice.state === 'connecting' ? 'Connecting' : voice.state === 'listening' ? 'Listening' : voice.state === 'thinking' ? 'Thinking' : voice.state === 'speaking' ? 'Speaking' : 'Your turn';
  const spokenText = voice && voice.said ? voice.said.split(' ').slice(0, voice.spoken || 0).join(' ') : '';

  return (
    <div className="ask-wrap">
      {empty ? (
        <div className="ask-empty">
          <h1 className="ask-hello">What can I help with?</h1>
          <p className="ask-sub">Ask by text or voice. I can answer and prepare work, but nothing is saved, linked, or submitted until you confirm.</p>
          {Composer({ big: true })}
          <div className="ask-prompts">
            {ASK_PROMPTS.map(([t, d]) => <button key={t} className="ask-prompt" onClick={() => send(t)}><strong>{t}</strong><small>{d}</small></button>)}
          </div>
        </div>
      ) : (
        <>
          <div className="ask-thread" aria-live="polite">
            <div className="ask-session">
              <span className={`ask-sess-ctx ${client ? 'on' : ''}`}><IC n="clients" s={13} className="" />{client ? <>Client context: <strong>{client}</strong></> : 'No client context'}</span>
              <span className="ask-sess-tmp">{saved ? 'Saved to record' : 'Temporary · not saved'}</span>
              <button className="btn sm" onClick={openSaveConv}>Save conversation</button>
            </div>
            {msgs.map((m, i) => m.role === 'note' ? <div key={i} className="ask-note">{m.text}</div> : m.role === 'you' ? (
              <div key={i} className="ask-you">{m.voice && <IC n="ask" s={12} className="ask-vtag" />}{m.text}</div>
            ) : (
              <div key={i} className="ask-ai"><span className="ask-ai-mark"><window.WSMark s={26} /></span><div className="ask-ai-body"><p>{m.text}</p>{!m.voice && <window.MsgRecord kind="ask" q={msgs[i - 1] && msgs[i - 1].text} />}</div></div>
            ))}
            {busy && <div className="ask-ai"><span className="ask-ai-mark"><window.WSMark s={26} /></span><div className="ask-ai-body"><window.RunSteps variant="calls" steps={window.TOOL_FLOW.ask.steps(msgs.length ? msgs[msgs.length - 1].text : '')} /></div></div>}
            {prep && prep.kind === 'tool' && (
              <div className="ask-prep ask-prep-tool">
                <div className="ask-prep-h"><window.WSTile n={prep.ic} /><div><small>Prepared Tool input · not run</small><strong>{prep.tool}</strong></div></div>
                {prep.inputs.length > 0 ? <dl className="ask-prep-in">{prep.inputs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : <p className="workspace-small">No client details will be filled in.</p>}
                <div className="quick-create-actions"><button className="btn sm ghost" onClick={() => setPrep(null)}>Discard</button><button className="btn sm accent" onClick={confirmPrep}>Review and open {prep.tool}</button></div>
              </div>
            )}
            {prep && prep.kind !== 'tool' && (
              <div className="ask-prep">
                <div><small>Prepared {prep.kind === 'task' ? 'task' : prep.kind === 'appt' ? 'appointment' : 'document save'} · not saved</small><strong>{prep.title}</strong>{prep.client && <small>Linked to {prep.client}</small>}</div>
                <div className="quick-create-actions"><button className="btn sm ghost" onClick={() => setPrep(null)}>Discard</button><button className="btn sm accent" onClick={confirmPrep}>{prep.kind === 'doc' ? 'Choose record and save' : 'Review and create'}</button></div>
              </div>
            )}
            <span ref={endRef} />
          </div>
          <div className="ask-dock">{Composer({})}<p className="ask-disclaim">Ask HealthFlow can make mistakes. Check important details with the plan.</p></div>
        </>
      )}

      {saveDlg}
      {micSheet && (
        <div className="ask-mic-scrim" onClick={() => setMicSheet(false)}>
          <div className="ask-mic-sheet card" role="dialog" aria-label="Allow microphone" onClick={e => e.stopPropagation()}>
            <span className="ask-mic-ic"><i className="ph-duotone ph-microphone" /></span>
            <h2>Use your microphone for this session?</h2>
            <p>Voice starts only when you allow it and stops when you end the session. Audio and the transcript are temporary unless you save the conversation.</p>
            <ul><li><i className="ph-duotone ph-shield-check" />Your provider key stays on the HealthFlow server</li><li><i className="ph-duotone ph-user-focus" />{client ? `Client context: ${client}` : 'No client context. Add a client to discuss one.'}</li></ul>
            <div className="quick-create-actions"><button className="btn" onClick={() => { setMic('denied'); setMicSheet(false); ctx.flash('Microphone not allowed. You can keep typing.'); }}>Not now</button><button className="btn accent" onClick={() => { setMic('granted'); setMicSheet(false); startVoice(); }}>Allow and start</button></div>
          </div>
        </div>
      )}
      {voice && voice.min && (
        <div className="ask-mini" role="status">
          <span className={`ask-rec-dot ${!voice.muted && !voice.paused ? 'on' : ''}`} />
          <span>{voice.muted ? 'Mic off' : 'Mic on'} · {Math.floor(voice.secs / 60)}:{String(voice.secs % 60).padStart(2, '0')}</span>
          <button className="btn sm" onClick={() => setVoice({ ...voice, min: false })}>Open</button>
          <button className="btn sm ask-mini-end" onClick={endVoice}>End session</button>
        </div>
      )}
      {voice && !voice.min && (
        <div className="ask-voice-screen" role="dialog" aria-label="Voice session">
          <div className="ask-voice-top">
            <span className="ask-rec"><span className={`ask-rec-dot ${!voice.muted && !voice.paused ? 'on' : ''}`} /><span>{`${voice.muted ? 'Mic off' : 'Mic on'} · ${Math.floor(voice.secs / 60)}:${String(voice.secs % 60).padStart(2, '0')}`}</span></span>
            {client ? <span className="ask-voice-ctx"><IC n="clients" s={13} className="" />{client}</span> : <span className="ask-voice-ctx muted">No client context</span>}
            <button className="ask-min-btn" onClick={() => setVoice({ ...voice, min: true })} aria-label="Minimize voice session"><i className="ph-bold ph-arrows-in-simple" /></button>
          </div>
          <div className="ask-orb-wrap">
            <div onClick={() => voice.state === 'speaking' && interrupt()} className={`ask-orb ${voice.state} ${voice.muted || voice.paused ? 'idle' : ''}`} style={{ transform: `scale(${orbScale})` }} />
            <div className="ask-status">{status}</div>
            <p className="ask-caption">{voice.state === 'connecting' ? 'Starting a secure voice session through HealthFlow…' : voice.state === 'listening' || voice.state === 'thinking' ? (voice.live || 'Go ahead, I am listening.') : spokenText || 'Tap the orb area to keep talking.'}</p>
            {prep && voice.state === 'done' && <button className="btn accent" onClick={() => { endVoice(); confirmPrep(); }}>Review prepared {prep.kind === 'task' ? 'task' : 'appointment'}</button>}
          </div>
          <div className="ask-voice-bar">
            <button className={`ask-round ${voice.muted ? 'on' : ''}`} onClick={() => setVoice({ ...voice, muted: !voice.muted })} aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />{voice.muted && <path d="M3 3l18 18" />}</svg>
            </button>
            <button className="ask-round" onClick={() => setVoice({ ...voice, paused: !voice.paused })} aria-label={voice.paused ? 'Resume' : 'Pause'}>
              {voice.paused ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>}
            </button>
            {voice.state === 'speaking' && <button className="ask-round ask-int" onClick={interrupt} aria-label="Interrupt">Interrupt</button>}
            <button className="ask-round end" onClick={endVoice} aria-label="End voice session"><IC n="x" s={22} className="" /></button>
          </div>
          <p className="ask-voice-note">Audio and transcript are temporary. Nothing is saved unless you choose to.</p>
          <p className="ask-voice-model"><i className="ph-duotone ph-lock-key" /> gpt-realtime-1.5 · connected through the HealthFlow server with a short-lived session. Your provider key never reaches this browser.</p>
        </div>
      )}
    </div>
  );
}

window.WS_PAGES = Object.assign(window.WS_PAGES || {}, {
  'Overview': OverviewPage, 'Documents': DocumentsPage, 'Activity': ActivityPage, 'Tool history': ToolHistoryPage,
  'Ask HealthFlow': AskPage, 'Compare Plans': ComparePlansPage, 'Explain Coverage': ExplainCoveragePage, 'Draft Appeal': DraftAppealPage,
});
