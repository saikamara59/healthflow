/* global React */
const { useState: useStateB } = React;
const IB = (p) => { const C = window.Ico; return <C {...p} />; };
const W = () => window.WS;

function FollowUpsPage({ ctx }) {
  const { NOW, TODAY0, DAY_MS, sameDay, fmtTime, fmtDay, Links } = W();
  const fu = ctx.tasks.filter(t => t.followup && !ctx.done.includes(t.id));
  const endToday = new Date(TODAY0.getTime() + DAY_MS);
  const groups = [
    ['Overdue', fu.filter(t => t.due && t.due < NOW)],
    ['Today', fu.filter(t => t.due && t.due >= NOW && t.due < endToday)],
    ['Upcoming', fu.filter(t => t.due && t.due >= endToday)],
    ['Unscheduled', fu.filter(t => !t.due)],
  ];
  return (
    <>
      <window.PageHead title="Follow-ups" sub="Promises and next steps to keep moving." action={<button className="btn accent" onClick={() => ctx.openCreate({ kind: 'task', prefill: { followup: true } })}><IB n="plus" s={15} className="" /> New follow-up</button>} />
      <div className="workspace-stack">
        {groups.map(([label, items]) => (
          <section key={label} className="card workspace-section">
            <div className="between"><h2 className={label === 'Overdue' && items.length ? 'td-neg' : ''}>{label}</h2><span className="workspace-count">{items.length}</span></div>
            {items.length === 0 ? <p className="workspace-empty">Nothing here right now.</p> : (
              <ul className="workspace-list">{items.sort((a, b) => (a.due || 0) - (b.due || 0)).map(t => (
                <li key={t.id} className="workspace-list-row">
                  <input type="checkbox" aria-label={`Complete ${t.title}`} onChange={() => ctx.completeTask(t)} />
                  <div className="workspace-row-copy"><strong>{t.title}</strong><Links r={t} /></div>
                  {t.due && <span className={`td-when ${t.due < NOW ? 'neg' : ''}`}>{sameDay(t.due, NOW) ? fmtTime(t.due) : `${fmtDay(t.due)} · ${fmtTime(t.due)}`}</span>}
                </li>
              ))}</ul>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

function SchedulingPage({ ctx }) {
  const { NOW, TODAY0, DAY_MS, sameDay, fmtTime, TZ } = W();
  const [week, setWeek] = useStateB(0);
  const days = Array.from({ length: 7 }, (_, i) => new Date(TODAY0.getTime() + (week * 7 + i) * DAY_MS));
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return (
    <>
      <window.PageHead title="Scheduling" sub={`A clear view of seven days. Times in ${TZ}.`} action={<button className="btn accent" onClick={() => ctx.openCreate({ kind: 'appt' })}><IB n="plus" s={15} className="" /> New appointment</button>} />
      <div className="workspace-agenda-controls">
        <button className="btn" onClick={() => setWeek(w => w - 1)}><IB n="chevL" s={14} className="" /> Previous week</button>
        <button className="btn" disabled={week === 0} onClick={() => setWeek(0)}>Today</button>
        <button className="btn" onClick={() => setWeek(w => w + 1)}>Next week <IB n="chev" s={14} className="" /></button>
      </div>
      <div className="workspace-agenda">
        {days.map(d => {
          const items = ctx.appts.filter(a => sameDay(a.start, d) && a.status !== 'Canceled').sort((a, b) => a.start - b.start);
          const isToday = sameDay(d, NOW);
          return (
            <section key={d.toISOString()} className={`card workspace-section ws-day ${isToday ? 'today' : ''}`} aria-label={d.toDateString()}>
              <div className="between"><h2>{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</h2>
                <button className="btn ghost icon sm" aria-label={`New appointment on ${d.toDateString()}`} onClick={() => ctx.openCreate({ kind: 'appt', prefill: { date: iso(d) } })}><IB n="plus" s={14} className="" /></button></div>
              {items.length === 0 ? <p className="workspace-empty">No meetings</p> : (
                <ul className="workspace-list">{items.map(a => {
                  const past = a.end <= NOW && a.status !== 'Completed';
                  return (
                    <li key={a.id} className="workspace-list-row ws-slot">
                      <small className="mono">{fmtTime(a.start)} to {fmtTime(a.end)}</small>
                      <strong>{a.title}</strong>
                      {(a.client || a.org) && <small>{a.client || a.org}</small>}
                      {a.status === 'Completed' && <span className="chip pos">Completed</span>}
                      {past && <div className="workspace-row-actions"><span className="chip warn">Needs follow-up</span></div>}
                      {past && <button className="btn sm" onClick={() => ctx.completeAppt(a)}>Mark completed</button>}
                    </li>
                  );
                })}</ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

const PLANS = [
  { name: 'Aetna Prime HMO', premium: 0, ded: 0, copay: 5, rx: 8, proc: 120, oop: 4150 },
  { name: 'Humana Gold Plus HMO', premium: 29, ded: 0, copay: 15, rx: 12, proc: 180, oop: 6700 },
  { name: 'UHC Complete II PPO', premium: 42, ded: 250, copay: 25, rx: 15, proc: 240, oop: 7550 },
];
const SAMPLE_RX = { 'Marjorie Calloway': ['Metformin', 'Lisinopril', 'Atorvastatin'], 'Otis Brewer': ['Warfarin', 'Carvedilol'], 'Priya Ramanathan': ['Humira', 'Methotrexate', 'Folic acid'], 'Inés Ortega-Ruiz': ['Levothyroxine', 'Metformin'] };
const SAMPLE_DR = { 'Marjorie Calloway': [{ name: 'Dr. Patel', npi: '1356789012' }, { name: 'Dr. Singh', npi: '' }], 'Otis Brewer': [{ name: 'Dr. Anika Patel', npi: '1443210987' }] };
const money = (n) => '$' + Math.round(n).toLocaleString();

const ListInput = ({ label, items, setItems, fields, addLabel = 'Add' }) => {
  const [v, setV] = useStateB(Object.fromEntries(fields.map(f => [f.k, f.def || ''])));
  const add = () => { if (!String(v[fields[0].k]).trim()) return; setItems([...items, { ...v, [fields[0].k]: v[fields[0].k].trim() }]); setV(Object.fromEntries(fields.map(f => [f.k, f.def || '']))); };
  return (
    <div className="ws-listin">
      <div className="ws-listin-label">{label}</div>
      <div className="ws-listin-row">
        {fields.map(f => <input key={f.k} className={f.narrow ? 'narrow' : ''} type={f.type || 'text'} placeholder={f.ph} value={v[f.k]} aria-label={f.ph} onChange={e => setV({ ...v, [f.k]: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />)}
        <button type="button" className="btn" disabled={!String(v[fields[0].k]).trim()} onClick={add}>{addLabel}</button>
      </div>
      {items.length > 0 && <div className="ws-chips">{items.map((it, i) => (
        <span key={i} className="chip">{Object.values(it).filter(Boolean).join(' · ')}<button type="button" aria-label={`Remove ${it[fields[0].k]}`} onClick={() => setItems(items.filter((_, j) => j !== i))}><IB n="x" s={11} className="" /></button></span>
      ))}</div>}
    </div>
  );
};

function ClientPrefill({ onPick }) {
  return (
    <label>Prefill from client<select defaultValue="" onChange={e => onPick(window.CLIENT_ROWS.find(c => c.name === e.target.value))}>
      <option value="">None</option>{window.CLIENT_ROWS.map(c => <option key={c.id}>{c.name}</option>)}
    </select></label>
  );
}

function EstimateCostsPage({ ctx }) {
  const [f, setF] = useStateB(() => ({ zip: '10001', income: 'Medium', visits: '12', ...(n => { const c = window.CLIENT_ROWS.find(x => x.name === n); return c ? { zip: c.zip, income: c.income[0].toUpperCase() + c.income.slice(1) } : {}; })(ctx.client) }));
  React.useEffect(() => { setF(v => ({ ...v, ...(n => { const c = window.CLIENT_ROWS.find(x => x.name === n); return c ? { zip: c.zip, income: c.income[0].toUpperCase() + c.income.slice(1) } : {}; })(ctx.client) })); }, [ctx.client]);
  const [rx, setRx] = useStateB([]);
  const [procs, setProcs] = useStateB([]);
  const [state, setState] = useStateB({ status: 'idle' });
  const zipOk = /^\d{5}$/.test(f.zip);
  const pick = (c) => { if (!c) return; setF({ ...f, zip: c.zip, income: c.income[0].toUpperCase() + c.income.slice(1) }); setRx((SAMPLE_RX[c.name] || []).map(m => ({ name: m, qty: '12' }))); ctx.flash(`Prefilled from ${c.name}.`); };
  const run = (e) => {
    e.preventDefault(); if (!zipOk) return;
    setState({ status: 'loading' });
    setTimeout(() => {
      const fills = rx.reduce((s, r) => s + (Number(r.qty) || 0), 0), pc = procs.reduce((s, p) => s + (Number(p.qty) || 0), 0), visits = Number(f.visits) || 0;
      const rows = PLANS.map(p => {
        const med = Math.min(p.ded + visits * p.copay + fills * p.rx + pc * p.proc, p.oop);
        return { ...p, premiums: p.premium * 12, visitsCost: visits * p.copay, rxCost: fills * p.rx, procCost: pc * p.proc, capped: med === p.oop, total: p.premium * 12 + med };
      }).sort((a, b) => a.total - b.total);
      setState({ status: 'ok', rows });
    }, window.flowTime('cost'));
  };
  const max = state.rows ? Math.max(...state.rows.map(r => r.total)) : 1;
  return (
    <>
      <window.PageHead eyebrow="Project annual spend" title="Calculate full-year cost." sub="Project a client's total out-of-pocket spend across premiums, deductibles, prescription tiers, and expected procedures for plans in their ZIP." />
      <form className="card workspace-section workspace-inline-form" onSubmit={run} noValidate>
        <ClientPrefill onPick={pick} />
        <div className="ws-grid3">
          <label>ZIP code<input value={f.zip} inputMode="numeric" maxLength={5} onChange={e => setF({ ...f, zip: e.target.value })} aria-invalid={!zipOk} />{!zipOk && <span className="td-err">Enter a 5-digit ZIP.</span>}</label>
          <label>Income level<select value={f.income} onChange={e => setF({ ...f, income: e.target.value })}><option>Low</option><option>Medium</option><option>High</option></select></label>
          <label>Doctor visits per year<input type="number" min="0" value={f.visits} onChange={e => setF({ ...f, visits: e.target.value })} /></label>
        </div>
        <div className="ws-divider" />
        <div className="ws-grid2">
          <ListInput label="Annual prescription fills" items={rx} setItems={setRx} fields={[{ k: 'name', ph: 'Medication' }, { k: 'qty', ph: 'Fills', type: 'number', def: '12', narrow: true }]} />
          <ListInput label="Annual procedure count" items={procs} setItems={setProcs} fields={[{ k: 'name', ph: 'Procedure' }, { k: 'qty', ph: 'Count', type: 'number', def: '1', narrow: true }]} />
        </div>
        <div className="ws-submit"><button className="btn accent lg" disabled={!zipOk || state.status === 'loading'}><IB n="cost" s={16} className="" /> {state.status === 'loading' ? 'Estimating…' : 'Estimate cost'}</button></div>
      </form>
      {state.status === 'loading' && <section className="card workspace-section"><window.RunSteps steps={window.TOOL_FLOW.cost.steps()} title="Estimating costs" /></section>}
      {state.status === 'ok' && (
        <section className="card workspace-section ws-results">
          <div className="between"><h2>Estimated annual cost</h2><span className="workspace-small">ZIP {f.zip} · {rx.length} medications · {f.visits || 0} visits</span></div>
          <div className="ws-scroll"><table className="tbl">
            <thead><tr><th>Plan</th><th>Premiums</th><th>Visits</th><th>Prescriptions</th><th>Procedures</th><th>Estimated total</th></tr></thead>
            <tbody>{state.rows.map((r, i) => (
              <tr key={r.name}>
                <td><strong>{r.name}</strong>{i === 0 && <span className="chip pos ws-best">Lowest estimate</span>}</td>
                <td className="mono">{money(r.premiums)}</td><td className="mono">{money(r.visitsCost)}</td><td className="mono">{money(r.rxCost)}</td><td className="mono">{money(r.procCost)}</td>
                <td><div className="ws-bar"><span style={{ width: `${(r.total / max) * 100}%` }} /></div><strong className="mono">{money(r.total)}</strong>{r.capped && <small className="muted"> Out-of-pocket max reached</small>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <window.RunRecord kind="cost" note="Estimates use 2026 plan filings and the inputs above. Confirm costs with the plan before enrollment." />
        </section>
      )}
    </>
  );
}

const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

function CheckNetworkPage({ ctx }) {
  const [f, setF] = useStateB(() => ({ zip: '10001', income: 'Medium', ...(n => { const c = window.CLIENT_ROWS.find(x => x.name === n); return c ? { zip: c.zip, income: c.income[0].toUpperCase() + c.income.slice(1) } : {}; })(ctx.client) }));
  React.useEffect(() => { setF(v => ({ ...v, ...(n => { const c = window.CLIENT_ROWS.find(x => x.name === n); return c ? { zip: c.zip, income: c.income[0].toUpperCase() + c.income.slice(1) } : {}; })(ctx.client) })); }, [ctx.client]);
  const [drs, setDrs] = useStateB([]);
  const [meds, setMeds] = useStateB([]);
  const [state, setState] = useStateB({ status: 'idle' });
  const ready = /^\d{5}$/.test(f.zip) && (drs.length || meds.length);
  const pick = (c) => { if (!c) return; setF({ zip: c.zip, income: c.income[0].toUpperCase() + c.income.slice(1) }); setDrs(SAMPLE_DR[c.name] || []); setMeds((SAMPLE_RX[c.name] || []).map(m => ({ name: m }))); ctx.flash(`Prefilled from ${c.name}.`); };
  const run = (e) => { e.preventDefault(); if (!ready) return; setState({ status: 'loading' }); setTimeout(() => setState({ status: 'ok' }), window.flowTime('network')); };
  return (
    <>
      <window.PageHead eyebrow="Provider and formulary check" title="Check coverage before enrollment." sub="Check available provider and formulary data for a client's plans. Confirm network and drug coverage directly with the plan before enrollment." />
      <form className="card workspace-section workspace-inline-form" onSubmit={run} noValidate>
        <ClientPrefill onPick={pick} />
        <div className="ws-grid2 ws-grid2-narrow">
          <label>ZIP code<input value={f.zip} maxLength={5} inputMode="numeric" onChange={e => setF({ ...f, zip: e.target.value })} /></label>
          <label>Income<select value={f.income} onChange={e => setF({ ...f, income: e.target.value })}><option>Low</option><option>Medium</option><option>High</option></select></label>
        </div>
        <div className="ws-divider" />
        <div className="ws-grid2">
          <ListInput label="Providers" items={drs} setItems={setDrs} fields={[{ k: 'name', ph: 'Doctor name' }, { k: 'npi', ph: 'NPI (optional)', narrow: true }]} />
          <ListInput label="Prescriptions" items={meds} setItems={setMeds} fields={[{ k: 'name', ph: 'Medication name' }]} />
        </div>
        <div className="ws-submit">
          {!ready && <span className="workspace-small">Add at least one provider or prescription.</span>}
          <button className="btn accent lg" disabled={!ready || state.status === 'loading'}><IB n="network" s={16} className="" /> {state.status === 'loading' ? 'Checking…' : 'Check coverage'}</button>
        </div>
      </form>
      {state.status === 'loading' && <section className="card workspace-section"><window.RunSteps steps={window.TOOL_FLOW.network.steps()} title="Checking coverage" /></section>}
      {state.status === 'ok' && (
        <section className="card workspace-section ws-results">
          <div className="between"><h2>Coverage by plan</h2><span className="workspace-small">ZIP {f.zip}</span></div>
          <div className="ws-scroll"><table className="tbl">
            <thead><tr><th>Item</th>{PLANS.map(p => <th key={p.name}>{p.name}</th>)}</tr></thead>
            <tbody>
              {drs.map(d => (
                <tr key={'d' + d.name}><td><strong>{d.name}</strong><small className="muted"> Provider{d.npi ? ` · NPI ${d.npi}` : ''}</small></td>
                  {PLANS.map(p => { const ok = hash(d.name + p.name) % 5 !== 0; return <td key={p.name}><span className={`chip ${ok ? 'pos' : 'neg'}`}>{ok ? 'Listed in network' : 'Not listed'}</span></td>; })}</tr>
              ))}
              {meds.map(m => (
                <tr key={'m' + m.name}><td><strong>{m.name}</strong><small className="muted"> Prescription</small></td>
                  {PLANS.map(p => { const t = (hash(m.name + p.name) % 5) + 1; const cov = hash(p.name + m.name) % 9 !== 0; return <td key={p.name}>{cov ? <span className={`chip ${t >= 4 ? 'warn' : 'pos'}`}>Tier {t}</span> : <span className="chip neg">Not on formulary</span>}</td>; })}</tr>
              ))}
            </tbody>
          </table></div>
          <window.RunRecord kind="network" note="Networks can change, so confirm with the plan before enrollment." />
        </section>
      )}
    </>
  );
}

window.WS_PAGES = Object.assign(window.WS_PAGES || {}, { 'Follow-ups': FollowUpsPage, 'Scheduling': SchedulingPage, 'Estimate Costs': EstimateCostsPage, 'Check Network': CheckNetworkPage });
