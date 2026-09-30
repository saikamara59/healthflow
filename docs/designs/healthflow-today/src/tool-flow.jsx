/* global React */
// Shared "flow" pieces: step-by-step progress while a Tool runs, and the
// record behind each result (steps, sources, and who/what recorded it).
const { useState: useSF, useEffect: useEF, useRef: useRF } = React;

const FLOW_MS = 420;
const runTime = (steps) => steps.length * FLOW_MS + 220;

const TOOL_FLOW = {
  compare: {
    tool: 'Compare Plans', agent: 'compare', model: 'claude-haiku-4-5',
    steps: (f = {}) => [
      ['Reading client profile', `ZIP ${f.zip || '10025'}, age ${f.age || '67'}, ${(f.meds || '').split(',').filter(s => s.trim()).length || 2} medications`],
      ['Loading plans in this ZIP', '8 plans from the CMS 2026 snapshot'],
      ['Checking formulary', 'Each medication matched to a drug tier'],
      ['Ranking by yearly cost', 'Premium, deductible, and drug costs added up'],
      ['Recording the result', 'Saved to the activity record'],
    ],
    sources: [['CMS plan data', '2026 snapshot · Sep 12, 2026'], ['Plan formularies', '2026 plan year'], ['Client profile', 'Entered by you']],
  },
  cost: {
    tool: 'Estimate Costs', agent: 'calculator', model: 'claude-haiku-4-5',
    steps: () => [
      ['Reading client inputs', 'Medications, visits, and procedures'],
      ['Loading plan cost sharing', 'Premiums, deductibles, and copays'],
      ['Pricing each medication', 'Drug tier cost per fill'],
      ['Adding up the year', 'Capped at each plan’s out-of-pocket max'],
      ['Recording the result', 'Saved to the activity record'],
    ],
    sources: [['CMS plan data', '2026 snapshot · Sep 12, 2026'], ['Plan formularies', '2026 plan year'], ['Client inputs', 'Entered by you']],
  },
  network: {
    tool: 'Check Network', agent: 'network', model: 'claude-haiku-4-5',
    steps: () => [
      ['Reading providers and medications', 'From the form above'],
      ['Looking up provider records', 'NPI numbers checked in NPPES'],
      ['Checking each plan’s directory', 'Network and formulary status'],
      ['Recording the result', 'Saved to the activity record'],
    ],
    sources: [['NPPES provider registry', 'Checked today'], ['Plan provider directories', 'Updated Sep 20, 2026'], ['Plan formularies', '2026 plan year']],
  },
  explain: {
    tool: 'Explain Coverage', agent: 'translator', model: 'claude-haiku-4-5',
    steps: () => [
      ['Reading the document', 'Summary of Benefits text'],
      ['Finding matching sections', 'Sections that answer the question'],
      ['Writing a plain answer', 'With section citations'],
    ],
    sources: [['Summary of Benefits', 'Pasted by you']],
  },
  appeal: {
    tool: 'Draft Appeal', agent: 'appeal', model: 'claude-sonnet-4',
    steps: () => [
      ['Reading the issue', 'Linked issue and client'],
      ['Reviewing the denial reason', 'From the denial details'],
      ['Finding coverage guidance', 'CMS LCD L33559'],
      ['Writing the draft', 'Temporary until you save it'],
    ],
    sources: [['Denial details', 'Entered by you'], ['CMS coverage guidance', 'LCD L33559'], ['Plan Summary of Benefits', '2026 plan year']],
  },
  ask: {
    tool: 'Ask HealthFlow', agent: 'ask', model: 'claude-haiku-4-5',
    steps: (q = '') => {
      const s = [['Reading your question', '', 'ask']];
      if (/follow|remind|task|call/i.test(q)) s.push(['Checking Follow-ups', 'Your open follow-ups', 'follow'], ['Preparing a task', 'Waits for your review', 'today']);
      else if (/meet|appointment|schedule/i.test(q)) s.push(['Checking Scheduling', 'Open times this week', 'cal'], ['Preparing an appointment', 'Waits for your review', 'cal']);
      else if (/submit|enroll/i.test(q)) s.push(['Checking Enrollments', 'Status and review checkpoint', 'enroll']);
      else if (/summar/i.test(q)) s.push(['Reading the client record', 'Medications, providers, renewal', 'clients'], ['Checking Tool history', 'Recent results', 'history']);
      else if (/compare|plan|premium|cost/i.test(q)) s.push(['Calling Compare Plans', 'Ranking plans in the client’s ZIP', 'compare'], ['Calling Estimate Costs', 'Yearly cost by plan', 'cost']);
      else if (/network|doctor|pharmacy|provider/i.test(q)) s.push(['Calling Check Network', 'Providers and pharmacies', 'network']);
      else if (/coverage|copay|benefit|dental/i.test(q)) s.push(['Calling Explain Coverage', 'Summary of Benefits', 'explain']);
      else if (/appeal|denial|denied/i.test(q)) s.push(['Checking Issues & Appeals', 'Open issues', 'issues'], ['Calling Draft Appeal', 'Drafts for your review', 'appeal']);
      else s.push(['Checking your tasks', 'Overdue and due today', 'today'], ['Checking your calendar', 'Meetings still ahead', 'cal']);
      s.push(['Writing the answer', '', 'ask']);
      return s;
    },
    sources: [['Your workspace records', 'Only your own records are read']],
  },
};

const newRecId = () => Math.random().toString(16).slice(2, 10);
const recordedAt = () => {
  const n = new Date();
  return n.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const StepTile = ({ ic }) => { const T = window.WSTile; return ic && T ? <T n={ic} /> : null; };

function StepIcon({ state }) {
  if (state === 'done') return <span className="fl-ic done" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>;
  if (state === 'now') return <span className="fl-ic now" aria-hidden="true"><i /></span>;
  return <span className="fl-ic" aria-hidden="true" />;
}

// Steps tick off one by one while the Tool works. Self-timed from mount.
function RunSteps({ steps, compact, variant, title = 'Working on it' }) {
  const [i, setI] = useSF(0);
  const t0 = useRF(Date.now());
  const [times, setTimes] = useSF([]);
  useEF(() => {
    if (i >= steps.length) return;
    const id = setTimeout(() => { setTimes(t => [...t, (Date.now() - t0.current) / 1000]); setI(v => v + 1); }, FLOW_MS);
    return () => clearTimeout(id);
  }, [i, steps.length]);
  const cur = steps[Math.min(i, steps.length - 1)];
  if (variant === 'calls') {
    return (
      <ol className="fl-calls" role="status" aria-live="polite">
        {steps.slice(0, Math.min(i + 1, steps.length)).map(([label, detail, ic], k) => {
          const state = k < i ? 'done' : 'now';
          return (
            <li key={label} className={`fl-call ${state}`}>
              <StepTile ic={ic} />
              <span className="fl-call-l">{label}{detail && <small>{detail}</small>}</span>
              <StepIcon state={state} />
            </li>
          );
        })}
      </ol>
    );
  }
  if (compact) {
    return (
      <div className="fl-compact" role="status" aria-live="polite">
        <StepIcon state={i >= steps.length ? 'done' : 'now'} />
        <StepTile ic={cur[2]} />
        <span>{cur[0]}</span>
        <small>{Math.min(i + 1, steps.length)} of {steps.length}</small>
      </div>
    );
  }
  return (
    <div className="fl-run" role="status" aria-live="polite">
      <div className="between"><h2>{title}</h2><span className="workspace-small">{Math.min(i, steps.length)} of {steps.length} steps</span></div>
      <ol className="fl-steps">
        {steps.map(([label, detail], k) => {
          const state = k < i ? 'done' : k === i ? 'now' : 'wait';
          return (
            <li key={label} className={`fl-step ${state}`}>
              <StepIcon state={state} />
              <div><strong>{label}</strong>{detail && <small>{detail}</small>}</div>
              <span className="fl-t">{state === 'done' ? `${times[k].toFixed(1)}s` : ''}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RecordBody({ flow, steps, id, at }) {
  return (
    <div className="fl-rec-body">
      <div>
        <div className="fl-rec-h">Steps</div>
        <ol className="fl-rec-steps">{steps.map(([l, d, ic]) => <li key={l}>{ic ? <StepTile ic={ic} /> : <StepIcon state="done" />}<span>{l}{d && <small>{d}</small>}</span></li>)}</ol>
      </div>
      <div>
        <div className="fl-rec-h">Sources</div>
        <div className="fl-rec-src">{flow.sources.map(([n, d]) => <SourceChip key={n} label={n} detail={d} />)}</div>
      </div>
      <div>
        <div className="fl-rec-h">Record</div>
        <dl className="fl-rec-kv">
          <div><dt>Record ID</dt><dd className="mono">REC-{id}</dd></div>
          <div><dt>Tool</dt><dd>{flow.tool}</dd></div>
          <div><dt>Model</dt><dd className="mono">{flow.model}</dd></div>
          <div><dt>Recorded by</dt><dd>Sai Kamara</dd></div>
          <div><dt>Recorded</dt><dd>{at}</dd></div>
        </dl>
      </div>
    </div>
  );
}

// One consistent label for where a result came from.
function srcIcon(label) {
  const l = label.toLowerCase();
  if (l.includes('nppes') || l.includes('npi')) return 'identification-card';
  if (l.includes('formular')) return 'pill';
  if (l.includes('directory')) return 'address-book';
  if (l.includes('lcd') || l.includes('guidance')) return 'scales';
  if (l.includes('cms') || l.includes('medicare')) return 'bank';
  if (l.includes('summary of benefits') || l.includes('sob') || l.includes('section')) return 'book-open-text';
  if (l.includes('denial')) return 'file-text';
  if (l.includes('workspace')) return 'folders';
  if (l.includes('client') || l.includes('you')) return 'user';
  return 'database';
}
function SourceChip({ label, detail, title }) {
  return (
    <span className="src-chip" title={title || (detail ? `${label} · ${detail}` : label)}>
      <i className={`ph-duotone ph-${srcIcon(label)}`} aria-hidden="true" />
      <b>{label}</b>{detail && <small>{detail}</small>}
    </span>
  );
}
const SourceRow = ({ items, lead = 'Sources' }) => (
  <div className="src-row"><span className="src-lead">{lead}</span>{items.map(([l, d]) => <SourceChip key={l} label={l} detail={d} />)}</div>
);

// "How this result was made" shown under a finished result.
function RunRecord({ kind, input, open = false, note }) {
  const flow = TOOL_FLOW[kind];
  const steps = flow.steps(input);
  const id = useRF(newRecId()).current;
  const at = useRF(recordedAt()).current;
  return (
    <details className="fl-rec" open={open}>
      <summary>
        <span className="fl-rec-seal"><StepIcon state="done" /> How this result was made</span>
        <span className="fl-rec-meta">{steps.length} steps · {flow.sources.length} source{flow.sources.length === 1 ? '' : 's'} · <span className="mono">REC-{id.slice(0, 4)}</span></span>
      </summary>
      <RecordBody flow={flow} steps={steps} id={id} at={at} />
      {note && <p className="ws-note fl-rec-note">{note}</p>}
    </details>
  );
}

// Smaller toggle under a chat answer.
function MsgRecord({ kind, cites, q }) {
  const flow = TOOL_FLOW[kind];
  const steps = flow.steps(q);
  const id = useRF(newRecId()).current;
  const at = useRF(recordedAt()).current;
  const [open, setOpen] = useSF(false);
  return (
    <div className="fl-msg">
      <button type="button" className="fl-msg-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide' : 'Show'} {kind === 'ask' ? `${steps.filter(s => s[2] && s[2] !== 'ask').length} tools used` : 'steps and sources'}
      </button>
      {open && <div className="fl-msg-body"><RecordBody flow={cites && cites.length ? { ...flow, sources: [...flow.sources, ...cites.map(c => [`Section ${c}`, 'Cited in the answer'])] } : flow} steps={steps} id={id} at={at} /></div>}
    </div>
  );
}

Object.assign(window, { SourceChip, SourceRow });
Object.assign(window, { RunSteps, RunRecord, MsgRecord, TOOL_FLOW, flowTime: (kind, input) => runTime(TOOL_FLOW[kind].steps(input)) });
