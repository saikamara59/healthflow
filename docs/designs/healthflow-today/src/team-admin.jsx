/* global React */
// Team administration: members, roles, licenses, seats, invites, and the audit trail.
const { useState: useSTA, useMemo: useMTA } = React;
const TA = (p) => { const T = window.WSTile; return T ? <T {...p} /> : null; };
const IA = (p) => { const C = window.Ico; return <C className="" {...p} />; };

const TA_TODAY = new Date(2026, 8, 29);
const daysTo = (s) => s ? Math.round((new Date(s + 'T12:00:00') - TA_TODAY) / 86400000) : null;
const fmtD = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const ROLES = {
  Owner: { d: 'Everything, including billing, team, and ownership.', perms: ['Own clients', 'Approve submissions', 'Manage team', 'Billing', 'Audit log'] },
  Admin: { d: 'Manages the team and settings. No billing.', perms: ['Own clients', 'Approve submissions', 'Manage team', 'Audit log'] },
  Broker: { d: 'Works their own book. Cannot see other brokers’ clients.', perms: ['Own clients', 'Approve submissions'] },
  Operations: { d: 'Compliance and paperwork. No client records.', perms: ['Audit log', 'Licensing'] },
};
const ALL_PERMS = ['Own clients', 'Approve submissions', 'Manage team', 'Billing', 'Audit log', 'Licensing'];

const SEED_MEMBERS = [
  { id: 1, n: 'Sai Kamara', e: 'sai@kamarabenefits.example', role: 'Owner', status: 'Active', you: true, clients: 128, states: ['NY', 'NJ', 'CT', 'PA'], ahip: '2027-09-30', eo: '2027-03-01', seen: 'Online' },
  { id: 2, n: 'Renata Aguirre', e: 'renata@kamarabenefits.example', role: 'Admin', status: 'Active', clients: 87, states: ['NY', 'NJ'], ahip: '2026-10-18', eo: '2027-01-15', seen: 'Online' },
  { id: 3, n: 'Mehmet Aydın', e: 'mehmet@kamarabenefits.example', role: 'Broker', status: 'Active', clients: 54, states: ['NY'], ahip: '2027-08-04', eo: '2026-11-02', seen: '12m ago' },
  { id: 4, n: 'Joelle Beaumont', e: 'joelle@kamarabenefits.example', role: 'Broker', status: 'Active', clients: 41, states: ['MA', 'NH', 'ME'], ahip: '2026-09-20', eo: '2027-02-10', seen: '2h ago' },
  { id: 5, n: 'Cyrus Manuelian', e: 'cyrus@kamarabenefits.example', role: 'Operations', status: 'Active', clients: 0, states: [], ahip: null, eo: null, seen: 'Yesterday' },
  { id: 6, n: 'Tessa Howe', e: 'tessa@kamarabenefits.example', role: 'Broker', status: 'Invited', clients: 0, states: ['CA'], ahip: null, eo: null, seen: 'Sent 2d ago' },
  { id: 7, n: 'Dario Lentz', e: 'dario@kamarabenefits.example', role: 'Broker', status: 'Suspended', clients: 22, states: ['NY'], ahip: '2026-06-30', eo: '2026-08-01', seen: 'Aug 30' },
];
const AUDIT = [
  ['10:42 AM', 'Sai Kamara', 'changed Mehmet Aydın’s role', 'Admin → Broker'],
  ['9:15 AM', 'System', 'flagged an expiring certification', 'Renata Aguirre · AHIP in 19 days'],
  ['Sep 27', 'Sai Kamara', 'invited Tessa Howe', 'Broker · CA'],
  ['Sep 12', 'Renata Aguirre', 'reassigned 22 clients', 'Dario Lentz → Mehmet Aydın'],
  ['Aug 30', 'Sai Kamara', 'suspended Dario Lentz', 'E&O insurance lapsed'],
];
const SEATS = 8;

const HUES = [200, 258, 28, 152, 302, 68];
const hue = (n) => HUES[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const Av = ({ n, s = 34 }) => <span className="tm-av" style={{ width: s, height: s, fontSize: s * 0.38, '--h': hue(n) }}>{n.split(/\s+/).map(x => x[0]).slice(0, 2).join('')}</span>;

function CertCell({ date, label }) {
  if (!date) return <span className="ta-na">Not on file</span>;
  const d = daysTo(date);
  const tone = d < 0 ? 'neg' : d <= 30 ? 'warn' : 'ok';
  return (
    <span className={`ta-cert ${tone}`}>
      <strong>{label}</strong>
      <small>{d < 0 ? `Expired ${fmtD(date)}` : d <= 30 ? `${d} days left` : `Until ${fmtD(date)}`}</small>
    </span>
  );
}

function MemberPanel({ m, onClose, onSave, members }) {
  React.useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const [role, setRole] = useSTA(m.role);
  const [reassign, setReassign] = useSTA('');
  const others = members.filter(x => x.id !== m.id && x.status === 'Active' && (x.role === 'Broker' || x.role === 'Admin' || x.role === 'Owner'));
  const changed = role !== m.role;
  return (
    <aside className="card ta-panel" aria-label={`${m.n} details`}>
      <div className="between"><span className="workspace-small">Member</span><button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><IA n="x" /></button></div>
      <div className="ta-p-head"><Av n={m.n} s={52} /><div><h2>{m.n}{m.you && <em> (you)</em>}</h2><small>{m.e}</small></div></div>
      <div className="ta-p-stats">
        <div><small>Clients</small><strong>{m.clients}</strong></div>
        <div><small>Licensed in</small><strong>{m.states.length ? m.states.join(', ') : 'None'}</strong></div>
        <div><small>Last active</small><strong>{m.seen}</strong></div>
      </div>

      <h3>Role</h3>
      <div className="ta-roles">
        {Object.entries(ROLES).map(([k, v]) => (
          <label key={k} className={`ta-role ${role === k ? 'on' : ''} ${m.you ? 'dis' : ''}`}>
            <input type="radio" name="role" checked={role === k} disabled={m.you} onChange={() => setRole(k)} />
            <span><strong>{k}</strong><small>{v.d}</small></span>
          </label>
        ))}
      </div>
      {m.you && <p className="ws-note">You can’t change your own role. Transfer ownership first.</p>}

      <h3>Compliance</h3>
      <div className="ta-p-certs"><CertCell date={m.ahip} label="AHIP" /><CertCell date={m.eo} label="E&O insurance" /></div>

      {m.status === 'Suspended' && m.clients > 0 && (
        <>
          <h3>Reassign {m.clients} clients</h3>
          <label className="workspace-filter">Move to<select value={reassign} onChange={e => setReassign(e.target.value)}><option value="">Choose a broker</option>{others.map(o => <option key={o.id} value={o.n}>{o.n}</option>)}</select></label>
        </>
      )}

      <div className="ta-p-actions">
        {!m.you && m.status === 'Active' && <button className="btn ghost ta-danger-t" onClick={() => onSave(m, { status: 'Suspended' }, `Suspended ${m.n}. They can’t sign in until you restore access.`)}>Suspend</button>}
        {m.status === 'Suspended' && <button className="btn" onClick={() => onSave(m, { status: 'Active' }, `Restored access for ${m.n}.`)}>Restore access</button>}
        {m.status === 'Invited' && <button className="btn" onClick={() => onSave(m, {}, `Invite resent to ${m.e}.`)}>Resend invite</button>}
        {reassign && <button className="btn" onClick={() => onSave(m, { clients: 0 }, `Moved ${m.clients} clients from ${m.n} to ${reassign}.`)}>Move clients</button>}
        <button className="btn accent" disabled={!changed} onClick={() => onSave(m, { role }, `${m.n} is now ${role === 'Admin' || role === 'Owner' ? 'an' : 'a'} ${role}.`)}>Save role</button>
      </div>
    </aside>
  );
}

function InviteDialog({ open, onClose, onInvite, seatsLeft }) {
  const ref = React.useRef(null);
  const [f, setF] = useSTA({ e: '', role: 'Broker', states: '' });
  const [err, setErr] = useSTA('');
  React.useEffect(() => { const el = ref.current; if (!el) return; if (open && !el.open) { setF({ e: '', role: 'Broker', states: '' }); setErr(''); el.showModal(); } if (!open && el.open) el.close(); }, [open]);
  const submit = (ev) => {
    ev.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(f.e)) return setErr('Enter a valid work email.');
    if (seatsLeft <= 0) return setErr('No seats left. Add a seat in billing first.');
    onInvite(f);
  };
  return (
    <dialog ref={ref} className="workspace-dialog" onClose={onClose} aria-labelledby="inv-t">
      {open && <form onSubmit={submit} noValidate>
        <div className="between"><h2 id="inv-t">Invite a teammate</h2><button type="button" className="btn ghost icon sm" onClick={onClose} aria-label="Close"><IA n="x" /></button></div>
        <label>Work email<input type="email" value={f.e} onChange={e => setF({ ...f, e: e.target.value })} aria-invalid={!!err} autoFocus placeholder="name@kamarabenefits.example" />{err && <span className="td-err">{err}</span>}</label>
        <label>Role<select value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>{Object.keys(ROLES).filter(r => r !== 'Owner').map(r => <option key={r}>{r}</option>)}</select></label>
        <small className="workspace-small">{ROLES[f.role].d}</small>
        <label>Licensed states<input value={f.states} onChange={e => setF({ ...f, states: e.target.value })} placeholder="e.g. NY, NJ" /></label>
        <small className="workspace-small">{seatsLeft} of {SEATS} seats left after this invite: {Math.max(seatsLeft - 1, 0)}.</small>
        <div className="quick-create-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn accent">Send invite</button></div>
      </form>}
    </dialog>
  );
}

function TeamAdminPage({ ctx }) {
  const [members, setMembers] = useSTA(SEED_MEMBERS);
  const [tab, setTab] = useSTA('members');
  const [q, setQ] = useSTA('');
  const [role, setRole] = useSTA('all');
  const [sel, setSel] = useSTA(null);
  const [inv, setInv] = useSTA(false);
  const [audit, setAudit] = useSTA(AUDIT);

  const used = members.filter(m => m.status !== 'Suspended').length;
  const expiring = members.filter(m => m.status === 'Active' && [m.ahip, m.eo].some(d => d && daysTo(d) <= 30)).length;
  const shown = members.filter(m => (role === 'all' || m.role === role) && (m.n + m.e).toLowerCase().includes(q.toLowerCase()));
  const current = members.find(m => m.id === sel);
  const log = (what, detail) => setAudit(a => [['Just now', 'Sai Kamara', what, detail], ...a]);

  const save = (m, patch, msg) => {
    setMembers(l => l.map(x => x.id === m.id ? { ...x, ...patch } : x));
    if (patch.role) log(`changed ${m.n}’s role`, `${m.role} → ${patch.role}`);
    if (patch.status === 'Suspended') log(`suspended ${m.n}`, '');
    if (patch.status === 'Active') log(`restored ${m.n}`, '');
    if ('clients' in patch) log(`reassigned ${m.clients} clients`, `${m.n}`);
    ctx.flash(msg);
  };
  const invite = (f) => {
    const n = f.e.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    setMembers(l => [...l, { id: Date.now(), n, e: f.e, role: f.role, status: 'Invited', clients: 0, states: f.states.split(/[,\s]+/).filter(Boolean).map(s => s.toUpperCase()), ahip: null, eo: null, seen: 'Sent just now' }]);
    log(`invited ${n}`, f.role);
    setInv(false); ctx.flash(`Invite sent to ${f.e}.`);
  };

  const TABS = [['members', 'Members', members.length], ['roles', 'Roles & permissions', Object.keys(ROLES).length], ['compliance', 'Licensing', expiring], ['audit', 'Audit log', null]];

  return (
    <>
      <window.PageHead eyebrow="Kamara Benefits Group" title="Team" sub="Invite people, set what they can do, and keep licenses current." action={<button className="btn accent" onClick={() => setInv(true)}><IA n="plus" s={15} /> Invite teammate</button>} />

      <div className="ta-stats">
        <div className="card ta-stat"><TA n="clients" /><div><small>Seats used</small><strong>{used} <span>of {SEATS}</span></strong><div className="ta-bar"><i style={{ width: `${(used / SEATS) * 100}%` }} /></div></div></div>
        <div className="card ta-stat"><TA n="enroll" /><div><small>Active members</small><strong>{members.filter(m => m.status === 'Active').length}</strong><span className="workspace-small">{members.filter(m => m.status === 'Invited').length} invite pending</span></div></div>
        <div className={`card ta-stat ${expiring ? 'warn' : ''}`}><TA n="issues" /><div><small>Expiring in 30 days</small><strong>{expiring}</strong><button className="td-link" onClick={() => setTab('compliance')}>Review licensing</button></div></div>
        <div className="card ta-stat"><TA n="history" /><div><small>Client privacy</small><strong className="ta-s">Each broker only</strong><span className="workspace-small">Teammates can’t see each other’s clients</span></div></div>
      </div>

      <div className="ap-bar">
        <div className="ap-tabs" role="tablist">{TABS.map(([k, l, n]) => <button key={k} role="tab" aria-selected={tab === k} className={`ap-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}{n != null && <span className="ap-n">{n}</span>}</button>)}</div>
        {tab === 'members' && <div className="ta-filters"><div className="search"><IA n="search" s={14} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search members" aria-label="Search members" /></div><label className="workspace-filter ws-inline-filter">Role<select value={role} onChange={e => setRole(e.target.value)}><option value="all">All roles</option>{Object.keys(ROLES).map(r => <option key={r}>{r}</option>)}</select></label></div>}
      </div>

      {tab === 'members' && (
        <div className={`ta-layout ${current ? 'split' : ''}`}>
          <section className="card ta-table" aria-label="Members">
            <div className="ta-row head"><span>Member</span><span>Role</span><span>Clients</span><span>Licensed in</span><span>Compliance</span><span>Last active</span></div>
            {shown.length === 0 && <p className="workspace-empty ta-empty">No members match.</p>}
            {shown.map(m => {
              const flags = [m.ahip, m.eo].filter(d => d && daysTo(d) <= 30).length + (m.status === 'Active' && m.role !== 'Operations' && (!m.ahip || !m.eo) ? 1 : 0);
              return (
                <button key={m.id} className={`ta-row ${sel === m.id ? 'on' : ''} ${m.status !== 'Active' ? 'muted-row' : ''}`} onClick={() => setSel(sel === m.id ? null : m.id)}>
                  <span className="ta-who"><Av n={m.n} /><span><strong>{m.n}{m.you && <em> (you)</em>}</strong><small>{m.e}</small></span></span>
                  <span><span className={`chip ${m.role === 'Owner' ? 'accent' : ''}`}>{m.role}</span>{m.status !== 'Active' && <span className={`chip ${m.status === 'Invited' ? 'warn' : 'neg'}`}>{m.status}</span>}</span>
                  <span className="num">{m.clients || '0'}</span>
                  <span className="ta-states">{m.states.length ? m.states.map(s => <i key={s}>{s}</i>) : <span className="ta-na">None</span>}</span>
                  <span>{m.role === 'Operations' ? <span className="ta-na">Not required</span> : flags ? <span className="ta-flag"><IA n="issues" s={13} /> {flags} to fix</span> : m.status === 'Invited' ? <span className="ta-na">After sign-up</span> : <span className="ta-ok">Current</span>}</span>
                  <span className="workspace-small">{m.seen}</span>
                </button>
              );
            })}
          </section>
          {current && <div className="ta-scrim" onClick={() => setSel(null)} />}
          {current && <MemberPanel key={current.id + current.role + current.status} m={current} members={members} onClose={() => setSel(null)} onSave={save} />}
        </div>
      )}

      {tab === 'roles' && (
        <section className="card workspace-section ta-perm" aria-label="Permissions">
          <div className="ta-pgrid" style={{ gridTemplateColumns: `minmax(160px,1.4fr) repeat(${Object.keys(ROLES).length}, minmax(90px,1fr))` }}>
            <span className="ta-ph">Permission</span>
            {Object.keys(ROLES).map(r => <span key={r} className="ta-ph c">{r}<small>{members.filter(m => m.role === r).length} people</small></span>)}
            {ALL_PERMS.map(p => (
              <React.Fragment key={p}>
                <span className="ta-pl">{p}</span>
                {Object.entries(ROLES).map(([r, v]) => <span key={r} className="ta-pc c">{v.perms.includes(p) ? <span className="fl-ic done"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span> : <span className="ta-dash">–</span>}</span>)}
              </React.Fragment>
            ))}
          </div>
          <p className="ws-note">Roles never share client records. Owners and Admins manage people, not other brokers’ books.</p>
        </section>
      )}

      {tab === 'compliance' && (
        <section className="card workspace-section" aria-label="Licensing">
          <div className="between"><h2 className="ws-h2">Certifications and insurance</h2><button className="btn sm" onClick={() => ctx.flash('Reminder emails sent to 3 members.')}>Send reminders</button></div>
          <ul className="workspace-list">
            {members.filter(m => m.role !== 'Operations').sort((a, b) => Math.min(daysTo(a.ahip) ?? 999, daysTo(a.eo) ?? 999) - Math.min(daysTo(b.ahip) ?? 999, daysTo(b.eo) ?? 999)).map(m => (
              <li key={m.id} className="workspace-list-row ta-comp">
                <span className="ta-who"><Av n={m.n} s={30} /><span><strong>{m.n}</strong><small>{m.states.join(', ') || 'No states'}</small></span></span>
                <CertCell date={m.ahip} label="AHIP" />
                <CertCell date={m.eo} label="E&O insurance" />
                <button className="btn sm" onClick={() => ctx.flash(`Upload opens for ${m.n}’s documents in the full app.`)}>Update</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'audit' && (
        <section className="card workspace-section" aria-label="Audit log">
          <div className="between"><h2 className="ws-h2">Team changes</h2><button className="btn sm" onClick={() => ctx.flash('Audit log exported as CSV.')}><IA n="download" s={13} /> Export</button></div>
          <ul className="workspace-list">{audit.map(([t, who, what, d], i) => (
            <li key={i} className="workspace-list-row ta-audit"><span className="ta-t">{t}</span><span className="workspace-row-copy"><span><strong>{who}</strong> {what}</span>{d && <small>{d}</small>}</span></li>
          ))}</ul>
        </section>
      )}

      <InviteDialog open={inv} onClose={() => setInv(false)} onInvite={invite} seatsLeft={SEATS - used} />
    </>
  );
}

window.WS_PAGES = Object.assign(window.WS_PAGES || {}, { 'Team': TeamAdminPage });
