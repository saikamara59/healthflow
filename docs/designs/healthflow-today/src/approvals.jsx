/* global React, ReactDOM */
// Approvals: every action that needs the broker's sign-off before it happens.
const { useState: useSAp, useEffect: useEAp, useRef: useRAp } = React;
const TileA = (p) => { const T = window.WSTile; return T ? <T {...p} /> : null; };
const IcA = (p) => { const C = window.Ico; return <C {...p} />; };

const AP_TYPES = {
  enrollment: { label: 'Enrollment submission', short: 'Enrollments', ic: 'enroll' },
  link: { label: 'Client email link', short: 'Client links', ic: 'mail', c: 'explain' },
  prepared: { label: 'Prepared by Ask HealthFlow', short: 'Prepared by Ask', ic: 'ask' },
  document: { label: 'Save as document', short: 'Documents', ic: 'docs' },
  appeal: { label: 'Appeal filing', short: 'Appeals', ic: 'appeal' },
};

window.SEED_APPROVALS = [
  {
    id: 'ap1', type: 'enrollment', status: 'pending', risk: 'High', due: 'Today, 5:00 PM',
    title: 'Record Aetna Prime HMO enrollment as submitted', client: 'Marjorie Calloway',
    by: { name: 'You', ic: 'enroll', note: 'moved to Ready to submit' }, age: '25m ago',
    summary: 'After you file the application in the Aetna broker portal, this enrollment is recorded as Submitted. HealthFlow does not send the application.',
    changes: [['Status', 'Ready to submit', 'Submitted'], ['Plan', 'Humana Gold Plus HMO', 'Aetna Prime HMO'], ['Effective date', 'None', 'Jan 1, 2027'], ['Monthly premium', '$29', '$0']],
    evidence: [['doc', 'Scope of Appointment', 'Signed Sep 22, 2026 · PDF'], ['source', 'Plan comparison', 'REC-8E68 · ranked 1st of 8'], ['doc', 'Medicare card (front)', 'JPG · uploaded Sep 10']],
    checks: ['Scope of Appointment is signed and dated', 'Client confirmed the plan and effective date', 'Medicare ID matches the card on file', 'Application was submitted in the Aetna portal'],
    input: { label: 'Carrier confirmation number', placeholder: 'e.g. AET-2027-448120' },
    attest: 'I submitted this application to Aetna and reviewed it with the client.',
  },
  {
    id: 'ap2', type: 'appeal', status: 'pending', risk: 'High', due: 'Oct 17, appeal deadline',
    title: 'File appeal for cardiac catheterization denial', client: 'Otis Brewer',
    by: { name: 'Draft Appeal', ic: 'appeal' }, age: '1h ago',
    summary: 'The draft becomes the official appeal letter on this issue and the issue moves to Waiting on outside party. You file it with Cigna yourself.',
    changes: [['Appeal', 'Draft', 'Filed'], ['Issue status', 'In progress', 'Waiting on outside party'], ['Follow-up', 'None', 'Check decision on Oct 31']],
    evidence: [['doc', 'Denial letter', 'Cigna · Sep 18, 2026 · PDF'], ['doc', 'Letter of medical necessity', 'Dr. Nakamura · PDF'], ['source', 'CMS coverage guidance', 'LCD L33559'], ['doc', 'Appeal draft', 'DOCX · temporary']],
    checks: ['Letter of medical necessity is attached', 'Denial date and claim number are correct', 'Filing is within the 60-day window'],
    attest: 'I reviewed the appeal letter and will file it with Cigna.',
  },
  {
    id: 'ap3', type: 'link', status: 'pending', risk: 'Standard',
    title: 'Link marjorie.c@example.com to Marjorie Calloway', client: 'Marjorie Calloway',
    by: { name: 'Inbox matching', ic: 'mail', c: 'explain' }, age: '1h ago',
    summary: 'This message and future messages from this address will appear on Marjorie Calloway’s record.',
    changes: [['Sender', 'Not linked', 'Marjorie Calloway'], ['Match basis', '', 'Name in signature, same ZIP in message']],
    evidence: [['source', 'Message', '“Question about my dental coverage” · 8:47 AM'], ['source', 'Client record', 'No email address on file']],
    checks: ['The sender is the client, not a family member or caregiver'],
  },
  {
    id: 'ap4', type: 'prepared', status: 'pending', risk: 'Standard',
    title: 'Create task: Call Inés about the pharmacy change', client: 'Inés Ortega-Ruiz',
    by: { name: 'Ask HealthFlow', ic: 'ask' }, age: '2h ago',
    summary: 'A follow-up task is created for tomorrow at 9:00 AM and linked to Inés Ortega-Ruiz.',
    changes: [['Title', '', 'Call Inés about the pharmacy change'], ['Due', '', 'Tomorrow, 9:00 AM'], ['Priority', '', 'High'], ['Follow-up', '', 'Yes']],
    evidence: [['source', 'Conversation', '“Remind me to call Inés tomorrow morning”'], ['source', 'Tools used', 'Follow-ups, Check Network']],
    checks: [],
  },
  {
    id: 'ap5', type: 'document', status: 'pending', risk: 'Standard',
    title: 'Save plan comparison as a document', client: 'Marjorie Calloway',
    by: { name: 'Compare Plans', ic: 'compare' }, age: '3h ago',
    summary: 'A PDF is saved to Marjorie Calloway’s documents and linked to her Aetna Prime HMO enrollment.',
    changes: [['Name', '', 'Plan comparison, Sep 27.pdf'], ['Linked to', '', 'Enrollment: Aetna Prime HMO']],
    evidence: [['source', 'Result', 'REC-8E68 · Compare Plans · claude-haiku-4-5']],
    checks: ['I reviewed the result and it is accurate'],
  },
  {
    id: 'ap6', type: 'link', status: 'approved', risk: 'Standard',
    title: 'Link dana.whitfield@aetna.example to Dana Whitfield', client: 'Aetna',
    by: { name: 'Inbox matching', ic: 'mail', c: 'explain' }, age: 'Yesterday',
    summary: 'Messages from this address appear on the Aetna organization and Dana Whitfield’s contact.',
    changes: [['Sender', 'Not linked', 'Dana Whitfield · Aetna']], evidence: [], checks: [],
    decided: { by: 'Sai Kamara', at: 'Sep 26, 4:12 PM', rec: 'A1F3', note: '' },
  },
];

const OUTCOME = { approved: ['pos', 'Approved'], rejected: ['neg', 'Rejected'], changes: ['warn', 'Changes requested'] };
const nowLabel = () => new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Requested({ by, age }) {
  return <span className="ap-by"><TileA n={by.ic} c={by.c} />{by.name}{by.note ? ` ${by.note}` : ''}<span className="ap-dot">·</span>{age}</span>;
}

function ApprovalDrawer({ item, onClose, onDecide }) {
  const [checked, setChecked] = useSAp({});
  const [attest, setAttest] = useSAp(false);
  const [val, setVal] = useSAp('');
  const [mode, setMode] = useSAp(null); // 'changes' | 'reject'
  const [note, setNote] = useSAp('');
  const panelRef = useRAp(null);
  useEAp(() => { setChecked({}); setAttest(false); setVal(''); setMode(null); setNote(''); }, [item && item.id]);
  useEAp(() => {
    if (!item) return;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    const t = setTimeout(() => panelRef.current && panelRef.current.focus(), 0);
    return () => { removeEventListener('keydown', k); clearTimeout(t); };
  }, [item]);
  if (!item) return null;
  const T = AP_TYPES[item.type];
  const readOnly = item.status !== 'pending';
  const need = item.checks.length + (item.attest ? 1 : 0) + (item.input ? 1 : 0);
  const have = item.checks.filter((_, i) => checked[i]).length + (item.attest && attest ? 1 : 0) + (item.input && val.trim() ? 1 : 0);
  const ready = have === need;
  const left = need - have;

  return ReactDOM.createPortal(
    <div className="ap-root">
      <div className="ap-backdrop" onClick={onClose} />
      <aside className="ap-drawer" role="dialog" aria-modal="true" aria-labelledby="ap-title" ref={panelRef} tabIndex={-1}>
        <header className="ap-dh">
          <div className="between">
            <span className="ap-type"><TileA n={T.ic} c={T.c} />{T.label}</span>
            <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><IcA n="x" className="" /></button>
          </div>
          <h2 id="ap-title">{item.title}</h2>
          <div className="ap-dh-meta">
            <span>{item.client}</span>
            {item.risk === 'High' && <span className="chip warn">High impact</span>}
            {item.due && <span className="ap-due"><IcA n="today" s={14} className="" /> {item.due}</span>}
          </div>
          <Requested by={item.by} age={item.age} />
        </header>

        <div className="ap-db">
          {readOnly && item.decided && (
            <section className={`ap-outcome ${item.status}`}>
              <div className="between"><strong>{OUTCOME[item.status][1]}</strong><span className="mono">REC-{item.decided.rec}</span></div>
              <small>{item.decided.by} · {item.decided.at}</small>
              {item.decided.note && <p>“{item.decided.note}”</p>}
            </section>
          )}

          <section className="ap-sec">
            <h3>What will happen</h3>
            <p className="ap-summary">{item.summary}</p>
          </section>

          {item.changes.length > 0 && (
            <section className="ap-sec">
              <h3>Changes</h3>
              <div className="ap-changes" role="table">
                <div className="ap-ch-row head" role="row"><span role="columnheader">Field</span><span role="columnheader">Now</span><span role="columnheader">After approval</span></div>
                {item.changes.map(([f, a, b]) => (
                  <div key={f} className="ap-ch-row" role="row">
                    <span role="cell">{f}</span>
                    <span role="cell" className={a ? 'ap-old' : 'ap-none'}>{a || 'New'}</span>
                    <span role="cell" className="ap-new">{b}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {item.evidence.length > 0 && (
            <section className="ap-sec">
              <h3>Evidence</h3>
              <ul className="ap-ev">
                {item.evidence.map(([k, n, m]) => (
                  <li key={n}>
                    <TileA n={k === 'doc' ? 'docs' : 'history'} />
                    <span><strong>{n}</strong><small>{m}</small></span>
                    <button className="td-link" onClick={() => window.__wsFlash && window.__wsFlash(`${n} opens in a preview in the full app.`)}>Open</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!readOnly && (need > 0) && (
            <section className="ap-sec">
              <div className="between"><h3>Before you approve</h3><span className="workspace-small">{have} of {need} done</span></div>
              <div className="ap-progress" aria-hidden="true"><span style={{ width: `${need ? (have / need) * 100 : 100}%` }} /></div>
              <div className="ap-checks">
                {item.checks.map((c, i) => (
                  <label key={c} className={`ap-check ${checked[i] ? 'on' : ''}`}>
                    <input type="checkbox" checked={!!checked[i]} onChange={e => setChecked({ ...checked, [i]: e.target.checked })} />
                    <span>{c}</span>
                  </label>
                ))}
                {item.input && (
                  <label className="ap-field">{item.input.label}<input value={val} onChange={e => setVal(e.target.value)} placeholder={item.input.placeholder} /></label>
                )}
                {item.attest && (
                  <label className={`ap-check ap-attest ${attest ? 'on' : ''}`}>
                    <input type="checkbox" checked={attest} onChange={e => setAttest(e.target.checked)} />
                    <span>{item.attest}</span>
                  </label>
                )}
              </div>
            </section>
          )}

          {readOnly && item.decided && item.status === 'approved' && need > 0 && (
            <section className="ap-sec">
              <h3>Confirmed at approval</h3>
              <ul className="ap-confirmed">{item.checks.map(c => <li key={c}><span className="fl-ic done"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>{c}</li>)}</ul>
            </section>
          )}

          {mode && (
            <section className="ap-sec ap-note">
              <h3>{mode === 'changes' ? 'What needs to change?' : 'Why are you rejecting this?'}</h3>
              <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} autoFocus placeholder={mode === 'changes' ? 'e.g. Effective date should be Feb 1' : 'e.g. Client decided to stay on their current plan'} />
            </section>
          )}
        </div>

        {!readOnly ? (
          <footer className="ap-df">
            {mode ? (
              <>
                <button className="btn" onClick={() => { setMode(null); setNote(''); }}>Back</button>
                <button className={`btn ${mode === 'reject' ? 'ap-danger' : 'accent'}`} disabled={!note.trim()} onClick={() => onDecide(item, mode === 'changes' ? 'changes' : 'rejected', note.trim())}>
                  {mode === 'changes' ? 'Send back for changes' : 'Reject'}
                </button>
              </>
            ) : (
              <>
                <button className="btn ghost" onClick={() => setMode('reject')}>Reject</button>
                <button className="btn" onClick={() => setMode('changes')}>Request changes</button>
                <div className="ap-approve">
                  <button className="btn accent" disabled={!ready} onClick={() => onDecide(item, 'approved', val.trim())}>Approve</button>
                  {!ready && <small>{left} item{left === 1 ? '' : 's'} left</small>}
                </div>
              </>
            )}
          </footer>
        ) : (
          <footer className="ap-df">
            {item.status === 'changes' && <button className="btn" onClick={() => onDecide(item, 'pending', '')}>Mark as resubmitted</button>}
            <button className="btn accent" onClick={onClose}>Done</button>
          </footer>
        )}
      </aside>
    </div>,
    document.body
  );
}

function ApprovalsPage({ ctx }) {
  const list = ctx.approvals, setList = ctx.setApprovals;
  const [tab, setTab] = useSAp('pending');
  const [type, setType] = useSAp('all');
  const [openId, setOpenId] = useSAp(() => { const id = window.__openApproval; window.__openApproval = null; return id || null; });
  window.__wsFlash = ctx.flash;
  const counts = { pending: list.filter(x => x.status === 'pending').length, changes: list.filter(x => x.status === 'changes').length, decided: list.filter(x => x.status === 'approved' || x.status === 'rejected').length };
  const inTab = (x) => tab === 'pending' ? x.status === 'pending' : tab === 'changes' ? x.status === 'changes' : (x.status === 'approved' || x.status === 'rejected');
  const shown = list.filter(x => inTab(x) && (type === 'all' || x.type === type));
  const order = { High: 0, Standard: 1 };
  if (tab === 'pending') shown.sort((a, b) => order[a.risk] - order[b.risk]);
  const open = list.find(x => x.id === openId) || null;

  const decide = (item, status, note) => {
    const prev = list;
    const rec = Math.random().toString(16).slice(2, 6).toUpperCase();
    setList(l => l.map(x => x.id === item.id ? { ...x, status, decided: status === 'pending' ? null : { by: 'Sai Kamara', at: nowLabel(), rec, note } } : x));
    setOpenId(null);
    const msg = status === 'approved' ? `Approved “${item.title}”. Recorded as REC-${rec}.` : status === 'rejected' ? `Rejected “${item.title}”.` : status === 'changes' ? `Sent back to ${item.by.name === 'You' ? 'you' : item.by.name} for changes.` : 'Moved back to Needs review.';
    ctx.flash(msg, status === 'pending' ? null : () => setList(prev));
  };

  const TABS = [['pending', 'Needs review'], ['changes', 'Changes requested'], ['decided', 'Decided']];
  return (
    <>
      <window.PageHead title="Approvals" sub="Nothing is submitted, linked, created, or saved until you approve it here." />
      <div className="ap-bar">
        <div className="ap-tabs" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`ap-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}<span className="ap-n">{counts[k]}</span></button>
          ))}
        </div>
        <label className="workspace-filter ws-inline-filter">Type<select value={type} onChange={e => setType(e.target.value)}><option value="all">All types</option>{Object.entries(AP_TYPES).map(([k, v]) => <option key={k} value={k}>{v.short}</option>)}</select></label>
      </div>

      {shown.length === 0 ? (
        <section className="card workspace-section ap-empty">
          <TileA n="approve" lg />
          <h2>{tab === 'pending' ? 'You are all caught up' : tab === 'changes' ? 'Nothing sent back' : 'No decisions yet'}</h2>
          <p className="workspace-empty">{tab === 'pending' ? 'New items appear here when a Tool, the inbox, or you prepare something that needs your sign-off.' : 'Items you send back or decide will appear here.'}</p>
        </section>
      ) : (
        <div className="ap-list">
          {shown.map(x => {
            const T = AP_TYPES[x.type];
            const nChecks = x.checks.length + (x.attest ? 1 : 0) + (x.input ? 1 : 0);
            return (
              <button key={x.id} className={`card ap-item ${x.risk === 'High' && x.status === 'pending' ? 'high' : ''}`} onClick={() => setOpenId(x.id)} data-c={T.c || T.ic}>
                <TileA n={T.ic} c={T.c} lg />
                <div className="ap-item-main">
                  <small className="ap-item-type">{T.label}</small>
                  <strong>{x.title}</strong>
                  <span className="ap-item-sub">{x.client}</span>
                  <Requested by={x.by} age={x.age} />
                </div>
                <div className="ap-item-side">
                  {x.status === 'pending' ? (
                    <>
                      {x.risk === 'High' && <span className="chip warn">High impact</span>}
                      {x.due && <small className="ap-due"><IcA n="today" s={13} className="" /> {x.due}</small>}
                      <small className="workspace-small">{nChecks ? `${nChecks} check${nChecks === 1 ? '' : 's'} to confirm` : 'Quick review'}</small>
                    </>
                  ) : (
                    <>
                      <span className={`chip ${OUTCOME[x.status][0]}`}>{OUTCOME[x.status][1]}</span>
                      {x.decided && <small className="workspace-small">{x.decided.at} · <span className="mono">REC-{x.decided.rec}</span></small>}
                      {x.decided && x.decided.note && <small className="ap-item-note">“{x.decided.note}”</small>}
                    </>
                  )}
                  <span className="ap-open">{x.status === 'pending' ? 'Review' : 'View'} <IcA n="chev" s={13} className="" /></span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <ApprovalDrawer item={open} onClose={() => setOpenId(null)} onDecide={decide} />
    </>
  );
}

function ApprovalsCard({ ctx }) {
  const pending = ctx.approvals.filter(x => x.status === 'pending');
  const go = (id) => { window.__openApproval = id || null; ctx.nav('Approvals'); };
  return (
    <section className="card workspace-section ap-today" aria-labelledby="h-ap">
      <div className="between"><h2 id="h-ap" className="ws-h2"><TileA n="approve" />Waiting for you</h2><button className="td-link" onClick={() => go()}>{pending.length ? `All ${pending.length}` : 'Open'}</button></div>
      {pending.length === 0 ? <p className="workspace-empty">Nothing needs your approval.</p> : (
        <ul className="workspace-list">
          {pending.slice(0, 3).map(x => { const T = AP_TYPES[x.type]; return (
            <li key={x.id} className="workspace-list-row ap-today-row">
              <TileA n={T.ic} c={T.c} />
              <div className="workspace-row-copy"><strong>{x.title}</strong><small>{x.client}{x.due ? ` · ${x.due}` : ''}</small></div>
              <button className="btn sm" onClick={() => go(x.id)}>Review</button>
            </li>
          ); })}
        </ul>
      )}
    </section>
  );
}

window.WS_PAGES = Object.assign(window.WS_PAGES || {}, { 'Approvals': ApprovalsPage });
Object.assign(window, { ApprovalsCard });
