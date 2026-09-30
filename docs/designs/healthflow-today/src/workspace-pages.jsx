/* global React */
const { useState: useStateA, useMemo: useMemoA } = React;

const I = (p) => { const C = window.Ico; return <C {...p} />; };
const hexId = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); };

const CLIENT_ROWS = [
  ['Linda Yamamoto', '85001', 66, 'low', 'Med', 3, 2, 'Renewal window', 118],
  ['Miguel Torres', '75201', 52, 'medium', 'Med', 3, 2, null, 121],
  ["Patricia O'Brien", '02101', 61, 'high', 'Med', 3, 2, 'Aging into Medicare', 122],
  ['Robert Johnson', '30301', 74, 'low', 'High', 4, 2, 'Review formulary', 124],
  ['Emily Nakamura', '98101', 38, 'high', 'Med', 2, 2, null, 125],
  ['James Washington', '77001', 69, 'medium', 'Med', 4, 2, 'Renewal window', 126],
  ['Marjorie Calloway', '10025', 67, 'medium', 'Low', 3, 2, 'Plan review today', 0],
  ['Howard Tenenbaum', '11215', 71, 'high', 'Low', 1, 1, 'Comparing plans', 2],
  ['Inés Ortega-Ruiz', '94110', 64, 'medium', 'Med', 2, 1, 'Pharmacy flag', 1],
  ['Otis Brewer', '30309', 72, 'medium', 'High', 2, 1, 'Appeal open', 4],
  ['Priya Ramanathan', '60614', 59, 'high', 'High', 3, 2, 'Review formulary', 7],
  ['Darnell Washington', '77004', 69, 'low', 'Med', 3, 1, 'Comparing plans', 0],
  ['Sabine Lefèvre', '98107', 66, 'medium', 'Low', 0, 1, null, 14],
  ['Eamonn Walsh', '02139', 68, 'low', 'Low', 1, 1, 'Renewal window', 3],
  ['Grace Adeyemi', '20009', 65, 'medium', 'Med', 2, 2, 'Aging into Medicare', 21],
  ['Tomás Herrera', '33130', 70, 'low', 'High', 5, 3, 'Review formulary', 9],
  ['Helen Park', '97205', 63, 'high', 'Low', 1, 1, null, 45],
  ['Walter Brennan', '48201', 73, 'medium', 'Med', 3, 2, 'Renewal window', 60],
].map(([name, zip, age, income, risk, rx, dr, next, touch]) => ({ id: hexId(name), name, zip, age, income, risk, rx, dr, next, touch }));

const NEXT_TONE = { 'Renewal window': '', 'Aging into Medicare': 'pos', 'Review formulary': 'warn', 'Pharmacy flag': 'warn', 'Appeal open': 'neg', 'Comparing plans': 'accent', 'Plan review today': 'accent' };
const RISK_COLOR = { High: 'var(--neg)', Med: 'var(--warn)', Low: 'var(--pos)' };
const touchLabel = (d) => d === 0 ? 'Today' : d < 30 ? `${d}d ago` : `${Math.round(d / 30)}mo ago`;
const initials = (n) => n.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();

const PageHead = ({ eyebrow, title, sub, action }) => {
  const T = window.WSTile, ic = window.WS_ROUTE_IC;
  return (
  <div className="page-head ws-head">
    <div>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <div className="ws-title-row">{T && ic && <T n={ic} lg />}<h1 className="page-title">{title}</h1></div>
      {sub && <p className="page-sub">{sub}</p>}
    </div>
    {action && <div className="quick-create-actions">{action}</div>}
  </div>
  );
};

function ClientsPage({ ctx }) {
  const [filter, setFilter] = useStateA('All');
  const [q, setQ] = useStateA('');
  const [dir, setDir] = useStateA('asc');
  const [sel, setSel] = useStateA(new Set());
  const F = {
    'All': () => true, 'Needs action': c => !!c.next, 'Age 65+': c => c.age >= 65, 'Complex Rx': c => c.rx >= 3,
    'High income': c => c.income === 'high', 'Medium': c => c.income === 'medium', 'Low income': c => c.income === 'low',
  };
  const rows = useMemoA(() => CLIENT_ROWS.filter(F[filter]).filter(c => !q.trim() || `${c.name} ${c.zip} ${c.id}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (a.touch - b.touch) * (dir === 'asc' ? 1 : -1)), [filter, q, dir]);
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = rows.length > 0 && rows.every(r => sel.has(r.id));
  return (
    <>
      <PageHead eyebrow={`${CLIENT_ROWS.length} active clients`} title="Clients" sub="Sorted by most recent touch. Click a row to open the profile, or select rows to act in bulk." action={<button className="btn" onClick={() => ctx.flash('CSV export started.')}><I n="download" s={15} className="" /> Export CSV</button>} />
      <div className="ws-toolbar">
        <div className="ws-pills" role="tablist" aria-label="Filter clients">
          {Object.keys(F).map(k => (
            <button key={k} role="tab" aria-selected={filter === k} className={`ws-pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{k}<span>{CLIENT_ROWS.filter(F[k]).length}</span></button>
          ))}
        </div>
        <label className="search ws-search"><I n="search" s={14} className="" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, ZIP, or ID" aria-label="Search clients" /></label>
      </div>
      {sel.size > 0 && (
        <div className="ws-bulk"><strong>{sel.size} selected</strong><div className="quick-create-actions">
          <button className="btn sm" onClick={() => { ctx.flash(`Follow-up tasks created for ${sel.size} clients.`); setSel(new Set()); }}>Create follow-ups</button>
          <button className="btn sm" onClick={() => ctx.flash('Export started.')}>Export</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Clear</button></div></div>
      )}
      <div className="cl-bar">
        <label className="cl-all"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map(r => r.id)))} /> Select all</label>
        <button className="ws-sort" onClick={() => setDir(d => d === 'asc' ? 'desc' : 'asc')}>Last touch <I n={dir === 'asc' ? 'arrowDown' : 'arrowUp'} s={12} className="" /></button>
      </div>
      {rows.length === 0 && <div className="card cl-empty">No clients match this view.</div>}
      <ul className="cl-list">
        {rows.map(c => (
          <li key={c.id} className={`card cl-card ${sel.has(c.id) ? 'on' : ''}`} onClick={() => ctx.flash(`Opens ${c.name}'s profile in the full app.`)}>
            <input type="checkbox" className="cl-cb" aria-label={`Select ${c.name}`} checked={sel.has(c.id)} onClick={e => e.stopPropagation()} onChange={() => toggle(c.id)} />
            <div className="cl-who"><span className="avatar md">{initials(c.name)}</span><div><strong>{c.name}</strong><small className="mono">#{c.id}</small></div></div>
            <div className="cl-fields">
            <div className="cl-f"><small>ZIP and age</small><span><span className="mono">{c.zip}</span> · Age {c.age}</span></div>
            <div className="cl-f"><small>Income</small><span className={`chip ${c.income === 'low' ? 'warn' : 'pos'}`}>{c.income}</span></div>
            <div className="cl-f"><small>Risk</small><span style={{ color: RISK_COLOR[c.risk], fontWeight: 600 }}>{c.risk}</span></div>
            <div className="cl-f"><small>Rx / Providers</small><span>{c.rx} Rx, {c.dr} doctor{c.dr === 1 ? '' : 's'}</span></div>
            <div className="cl-f"><small>Next action</small>{c.next ? <span className={`chip ${NEXT_TONE[c.next] || ''}`}>{c.next}</span> : <span className="muted">None</span>}</div>
            <div className="cl-f"><small>Last touch</small><span>{touchLabel(c.touch)}</span></div>
            </div>
            <div className="cl-act" onClick={e => e.stopPropagation()}>
              <button className="btn ghost icon sm" aria-label={`Activity for ${c.name}`} onClick={() => ctx.flash(`Opens Activity for ${c.name}.`)}><I n="history" s={16} className="" /></button>
              <button className="btn ghost icon sm" aria-label={`Open ${c.name}`} onClick={() => ctx.flash(`Opens ${c.name}'s profile in the full app.`)}><I n="chev" s={16} className="" /></button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

const ORG_KINDS = ['Carrier', 'Provider office', 'Employer', 'Agency', 'Other'];
const SEED_ORGS = [
  { id: 'o1', name: 'Aetna', kind: 'Carrier', contacts: [{ name: 'Dana Whitfield', role: 'Broker services', email: 'dana.whitfield@aetna.example', phone: '(212) 555-0142' }] },
  { id: 'o2', name: 'Humana', kind: 'Carrier', contacts: [{ name: 'Luis Ferreira', role: 'Appeals coordinator', email: 'lferreira@humana.example', phone: '' }] },
  { id: 'o3', name: 'Cigna', kind: 'Carrier', contacts: [] },
  { id: 'o4', name: 'Upper West Cardiology', kind: 'Provider office', contacts: [{ name: 'Dr. Anika Patel', role: 'Cardiologist', email: '', phone: '(212) 555-0199' }] },
  { id: 'o5', name: 'Kamara Benefits Group', kind: 'Agency', contacts: [] },
  { id: 'o6', name: 'Riverside Unified Schools', kind: 'Employer', contacts: [], archived: true },
];

function OrganizationsPage({ ctx }) {
  const [orgs, setOrgs] = useStateA(SEED_ORGS);
  const [q, setQ] = useStateA('');
  const [showArch, setShowArch] = useStateA(false);
  const [open, setOpen] = useStateA('o1');
  const [creating, setCreating] = useStateA(false);
  const [nf, setNf] = useStateA({ name: '', kind: 'Carrier', err: '' });
  const [cf, setCf] = useStateA({ name: '', role: '', email: '', phone: '' });
  const list = orgs.filter(o => !!o.archived === showArch).filter(o => !q.trim() || `${o.name} ${o.kind}`.toLowerCase().includes(q.toLowerCase()));
  const update = (id, fn) => setOrgs(os => os.map(o => o.id === id ? fn(o) : o));
  const createOrg = (e) => {
    e.preventDefault();
    if (!nf.name.trim()) return setNf({ ...nf, err: 'Add a name.' });
    const id = 'o' + Date.now();
    setOrgs([{ id, name: nf.name.trim(), kind: nf.kind, contacts: [] }, ...orgs]);
    setNf({ name: '', kind: 'Carrier', err: '' }); setCreating(false); setOpen(id); ctx.flash('Organization created.');
  };
  const addContact = (id) => (e) => {
    e.preventDefault(); if (!cf.name.trim()) return;
    update(id, o => ({ ...o, contacts: [...o.contacts, { ...cf, name: cf.name.trim() }] }));
    setCf({ name: '', role: '', email: '', phone: '' }); ctx.flash('Contact added.');
  };
  return (
    <>
      <PageHead title="Organizations" sub="Carriers, provider offices, employers, and partners." action={<button className="btn accent" onClick={() => setCreating(true)}><I n="plus" s={15} className="" /> New organization</button>} />
      {creating && (
        <form className="card workspace-section workspace-inline-form ws-new" onSubmit={createOrg} noValidate>
          <div className="between"><h2>New organization</h2><button type="button" className="btn ghost icon sm" onClick={() => setCreating(false)} aria-label="Close"><I n="x" className="" /></button></div>
          <div className="workspace-form-grid">
            <label>Name<input autoFocus value={nf.name} onChange={e => setNf({ ...nf, name: e.target.value, err: '' })} aria-invalid={!!nf.err} />{nf.err && <span className="td-err">{nf.err}</span>}</label>
            <label>Kind<select value={nf.kind} onChange={e => setNf({ ...nf, kind: e.target.value })}>{ORG_KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
          </div>
          <div className="quick-create-actions"><button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn accent">Create organization</button></div>
        </form>
      )}
      <section className="card workspace-section">
        <div className="ws-filter-row">
          <label className="workspace-filter">Filter organizations<input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or kind" /></label>
          <div className="ws-seg" role="tablist"><button className={!showArch ? 'on' : ''} onClick={() => setShowArch(false)}>Active</button><button className={showArch ? 'on' : ''} onClick={() => setShowArch(true)}>Archived</button></div>
        </div>
        {list.length === 0 && <p className="workspace-empty">{showArch ? 'No archived organizations.' : 'No organizations match.'}</p>}
        <ul className="workspace-list">
          {list.map(o => (
            <li key={o.id} className="ws-org">
              <div className="ws-org-head">
                <button className="phase2-row-button" aria-expanded={open === o.id} onClick={() => setOpen(open === o.id ? null : o.id)}>
                  <window.OrgLogo name={o.name} email={o.contacts[0] && o.contacts[0].email} size={38} /><span><strong>{o.name}</strong><small>{o.contacts.length} contact{o.contacts.length === 1 ? '' : 's'}</small></span>
                </button>
                <span className="workspace-tag">{o.kind}</span>
                <button className="btn sm" onClick={() => { update(o.id, x => ({ ...x, archived: !x.archived })); ctx.flash(o.archived ? `${o.name} restored.` : `${o.name} archived. You can restore it from Archived.`); }}><I n="archive" s={14} className="" /> {o.archived ? 'Restore' : 'Archive'}</button>
              </div>
              {open === o.id && !o.archived && (
                <div className="ws-org-body">
                  {o.contacts.length ? (
                    <div className="ws-contacts">{o.contacts.map(c => (
                      <div key={c.name} className="ws-contact"><strong>{c.name}</strong><small>{c.role || 'No role'}</small><small>{c.email || 'No email'}</small><small>{c.phone || 'No phone'}</small></div>
                    ))}</div>
                  ) : <p className="workspace-empty">No contacts yet.</p>}
                  <form className="workspace-inline-form ws-contact-form" onSubmit={addContact(o.id)}>
                    <input placeholder="Contact name" value={cf.name} onChange={e => setCf({ ...cf, name: e.target.value })} aria-label="Contact name" />
                    <input placeholder="Role" value={cf.role} onChange={e => setCf({ ...cf, role: e.target.value })} aria-label="Role" />
                    <input placeholder="Email" value={cf.email} onChange={e => setCf({ ...cf, email: e.target.value })} aria-label="Email" />
                    <input placeholder="Phone" value={cf.phone} onChange={e => setCf({ ...cf, phone: e.target.value })} aria-label="Phone" />
                    <button className="btn" disabled={!cf.name.trim()}>Add contact</button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const ENR_STATUSES = ['Preparing', 'Ready to submit', 'Submitted', 'Confirmed', 'Canceled'];
const ENR_TONE = { 'Preparing': '', 'Ready to submit': 'warn', 'Submitted': 'accent', 'Confirmed': 'pos', 'Canceled': 'neg' };
const SEED_ENR = [
  { id: 'e1', client: 'Marjorie Calloway', plan: 'Aetna Prime HMO', eff: '2027-01-01', status: 'Ready to submit', notes: 'Client approved on the Sept 27 plan review.' },
  { id: 'e2', client: 'Howard Tenenbaum', plan: 'Humana Gold Plus HMO', eff: '2027-01-01', status: 'Preparing', notes: '' },
  { id: 'e3', client: 'Linda Yamamoto', plan: 'UHC Complete II PPO', eff: '2026-11-01', status: 'Submitted', notes: '' },
  { id: 'e4', client: 'Eamonn Walsh', plan: 'BlueCross Advantage', eff: '2026-10-01', status: 'Confirmed', notes: '' },
];
const fmtISO = (s) => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set';

function EnrollmentsPage({ ctx }) {
  const [list, setList] = useStateA(SEED_ENR);
  const [status, setStatus] = useStateA('All');
  const [f, setF] = useStateA({ client: '', plan: '', eff: '', notes: '' });
  const [err, setErr] = useStateA({});
  const [confirmIds, setConfirmIds] = useStateA({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const move = (id, s) => { setList(l => l.map(x => x.id === id ? { ...x, status: s } : x)); ctx.flash(`Enrollment moved to ${s}.`); };
  const create = (e) => {
    e.preventDefault();
    const er = {}; if (!f.client) er.client = 'Choose a client.'; if (!f.plan.trim()) er.plan = 'Add a plan name.';
    setErr(er); if (Object.keys(er).length) return;
    setList([{ id: 'e' + Date.now(), ...f, plan: f.plan.trim(), status: 'Preparing' }, ...list]);
    setF({ client: '', plan: '', eff: '', notes: '' }); ctx.flash('Enrollment created in Preparing.');
  };
  const shown = list.filter(x => status === 'All' || x.status === status);
  return (
    <>
      <PageHead title="Enrollments" sub="Prepare and track client enrollments with a broker review checkpoint." />
      <div className="phase2-grid">
        <form className="card workspace-section workspace-inline-form" onSubmit={create} noValidate>
          <h2>New enrollment</h2>
          <label>Client<select value={f.client} onChange={set('client')} aria-invalid={!!err.client}><option value="">Choose a client</option>{CLIENT_ROWS.map(c => <option key={c.id}>{c.name}</option>)}</select>{err.client && <span className="td-err">{err.client}</span>}</label>
          <label>Plan name<input value={f.plan} onChange={set('plan')} aria-invalid={!!err.plan} />{err.plan && <span className="td-err">{err.plan}</span>}</label>
          <label>Effective date<input type="date" value={f.eff} onChange={set('eff')} /></label>
          <label>Notes<textarea rows={3} value={f.notes} onChange={set('notes')} /></label>
          <div><button className="btn accent">Create enrollment</button></div>
          <p className="ws-note">Ready to submit means the enrollment has passed your review. HealthFlow does not send applications. You mark it Submitted only after an external submission succeeds.</p>
        </form>
        <section className="card workspace-section">
          <div className="between ws-sec-head"><h2>Enrollment work</h2>
            <label className="workspace-filter ws-inline-filter">Status<select value={status} onChange={e => setStatus(e.target.value)}><option>All</option>{ENR_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
          </div>
          {shown.length === 0 && <p className="workspace-empty">No enrollments match this view.</p>}
          <ul className="workspace-list">
            {shown.map(x => (
              <li key={x.id} className="workspace-list-row ws-enr">
                <div className="workspace-row-copy">
                  <div className="between"><strong>{x.client}</strong><span className={`chip ${ENR_TONE[x.status]}`}>{x.status}</span></div>
                  <small>{x.plan} · Effective {fmtISO(x.eff)}</small>
                  {x.notes && <small>{x.notes}</small>}
                  <div className="ws-steps" aria-label="Progress">{ENR_STATUSES.slice(0, 4).map((s, i) => <span key={s} className={ENR_STATUSES.indexOf(x.status) >= i && x.status !== 'Canceled' ? 'on' : ''}>{s}</span>)}</div>
                  {x.status === 'Ready to submit' && (
                    <div className="workspace-link-suggestion ws-review">
                      <div><strong>Broker review checkpoint</strong><small>Submit the application in the carrier portal, then record it here.</small>
                        <label className="ws-confirm"><input type="checkbox" checked={!!confirmIds[x.id]} onChange={e => setConfirmIds({ ...confirmIds, [x.id]: e.target.checked })} /> I confirm the external submission succeeded</label></div>
                      <button className="btn sm accent" disabled={!confirmIds[x.id]} onClick={() => move(x.id, 'Submitted')}>Record as submitted</button>
                    </div>
                  )}
                  <div className="quick-create-actions">
                    {x.status === 'Preparing' && <button className="btn sm" onClick={() => move(x.id, 'Ready to submit')}>Mark ready to submit</button>}
                    {x.status === 'Ready to submit' && <button className="btn sm ghost" onClick={() => move(x.id, 'Preparing')}>Back to preparing</button>}
                    {x.status === 'Submitted' && <button className="btn sm" onClick={() => move(x.id, 'Confirmed')}>Mark confirmed</button>}
                    {!['Confirmed', 'Canceled'].includes(x.status) && <button className="btn sm danger" onClick={() => move(x.id, 'Canceled')}>Cancel</button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

const ISS_STATUSES = ['Open', 'In progress', 'Waiting on outside party', 'Resolved'];
const SEED_ISS = [
  { id: 'i1', client: 'Otis Brewer', title: 'Cardiac catheterization denied by Cigna', deadline: '2026-11-17', status: 'In progress', desc: 'Prior authorization denied on Sept 18. Standard appeal window is 60 days.', followups: ['Upload denial letter to the appeal Issue'], appts: ['Appeal prep with cardiology office · Sun, Sep 27, 2:00 PM'], appeals: [{ title: 'Level 1 reconsideration', status: 'Drafting' }] },
  { id: 'i2', client: 'Inés Ortega-Ruiz', title: 'Preferred pharmacy left the plan network', deadline: '2026-10-15', status: 'Waiting on outside party', desc: 'Waiting on Humana to confirm transition fill coverage.', followups: ['Call about pharmacy network change'], appts: [], appeals: [] },
  { id: 'i3', client: 'Priya Ramanathan', title: 'Humira moved to a higher tier', deadline: '', status: 'Open', desc: '', followups: ['Confirm Tier 5 formulary coverage for Humira'], appts: [], appeals: [] },
];
const ISS_TONE = { 'Open': '', 'In progress': 'accent', 'Waiting on outside party': 'warn', 'Resolved': 'pos' };

function IssuesPage({ ctx }) {
  const [list, setList] = useStateA(SEED_ISS);
  const [selId, setSelId] = useStateA('i1');
  const [f, setF] = useStateA({ client: '', title: '', deadline: '', desc: '' });
  const [err, setErr] = useStateA({});
  const sel = list.find(x => x.id === selId);
  const upd = (fn) => setList(l => l.map(x => x.id === selId ? fn(x) : x));
  const create = (e) => {
    e.preventDefault();
    const er = {}; if (!f.client) er.client = 'Choose a client.'; if (!f.title.trim()) er.title = 'Add an issue title.';
    setErr(er); if (Object.keys(er).length) return;
    const id = 'i' + Date.now();
    setList([{ id, ...f, title: f.title.trim(), status: 'Open', followups: [], appts: [], appeals: [] }, ...list]);
    setSelId(id); setF({ client: '', title: '', deadline: '', desc: '' }); ctx.flash('Issue created.');
  };
  const Linked = ({ title, items, empty }) => (
    <div className="ws-linked"><div className="workspace-subheading">{title} · {items.length}</div>
      {items.length ? <ul className="workspace-list">{items.map((t, i) => <li key={i} className="workspace-list-row"><div className="workspace-row-copy">{typeof t === 'string' ? <strong>{t}</strong> : <><div className="between"><strong>{t.title}</strong><span className="chip accent">{t.status}</span></div></>}</div></li>)}</ul> : <p className="workspace-empty">{empty}</p>}
    </div>
  );
  return (
    <>
      <PageHead title="Issues & Appeals" sub="Keep the whole case together. An issue can resolve without an appeal." />
      <div className="phase2-grid">
        <div className="workspace-stack">
          <form className="card workspace-section workspace-inline-form" onSubmit={create} noValidate>
            <h2>New issue</h2>
            <label>Client<select value={f.client} onChange={e => setF({ ...f, client: e.target.value })} aria-invalid={!!err.client}><option value="">Choose a client</option>{CLIENT_ROWS.map(c => <option key={c.id}>{c.name}</option>)}</select>{err.client && <span className="td-err">{err.client}</span>}</label>
            <label>Issue title<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} aria-invalid={!!err.title} />{err.title && <span className="td-err">{err.title}</span>}</label>
            <label>Deadline<input type="date" value={f.deadline} onChange={e => setF({ ...f, deadline: e.target.value })} /></label>
            <label>Description<textarea rows={3} value={f.desc} onChange={e => setF({ ...f, desc: e.target.value })} /></label>
            <button className="btn accent">Create issue</button>
          </form>
          <section className="card workspace-section">
            <h2>Issue work</h2>
            {list.length === 0 ? <p className="workspace-empty">No issues yet.</p> : (
              <ul className="workspace-list">{list.map(x => (
                <li key={x.id} className={`workspace-list-row ${x.id === selId ? 'phase2-selected' : ''}`}>
                  <button className="phase2-row-button" onClick={() => setSelId(x.id)} aria-current={x.id === selId}>
                    <span><strong>{x.title}</strong><small>{x.client} · {x.deadline ? `Due ${fmtISO(x.deadline)}` : 'No deadline'}</small></span>
                  </button>
                  <span className={`chip ${ISS_TONE[x.status]}`}>{x.status}</span>
                </li>
              ))}</ul>
            )}
          </section>
        </div>
        <section className="card workspace-section phase2-detail">
          {!sel ? <><h2>Issue details</h2><p className="workspace-empty">Choose an issue to see its deadline, follow-ups, appointments, and appeals.</p></> : (
            <>
              <div className="eyebrow">{sel.client}</div>
              <h2 className="ws-detail-title">{sel.title}</h2>
              <div className="workspace-form-grid ws-detail-meta">
                <label className="workspace-filter">Status<select value={sel.status} onChange={e => { const v = e.target.value; upd(x => ({ ...x, status: v })); ctx.flash(`Issue moved to ${v}.`); }}>{ISS_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
                <div className="ws-kv"><small>Deadline</small><strong>{fmtISO(sel.deadline)}</strong></div>
              </div>
              {sel.desc && <p className="ws-desc">{sel.desc}</p>}
              <Linked title="Follow-ups" items={sel.followups} empty="No follow-ups linked." />
              <Linked title="Appointments" items={sel.appts} empty="No appointments linked." />
              <Linked title="Appeals" items={sel.appeals} empty="No appeal. This issue can resolve without one." />
              <div className="quick-create-actions ws-detail-actions">
                <button className="btn accent" onClick={() => { upd(x => ({ ...x, appeals: [...x.appeals, { title: `Appeal ${x.appeals.length + 1}`, status: 'Drafting' }] })); ctx.flash('Appeal started on this issue. Open Draft Appeal to write it.'); }}><I n="appeal" s={15} className="" /> Start appeal</button>
                <button className="btn" onClick={() => ctx.openCreate({ kind: 'task', prefill: { title: `Follow up: ${sel.title}`, followup: true, client: sel.client } })}>Add follow-up</button>
                {sel.status !== 'Resolved' && <button className="btn ghost" onClick={() => { upd(x => ({ ...x, status: 'Resolved' })); ctx.flash('Issue resolved.'); }}>Mark resolved</button>}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

window.WS_PAGES = Object.assign(window.WS_PAGES || {}, { 'Clients': ClientsPage, 'Organizations': OrganizationsPage, 'Enrollments': EnrollmentsPage, 'Issues & Appeals': IssuesPage });
Object.assign(window, { CLIENT_ROWS, PageHead, WsIcon: I, fmtISO });
