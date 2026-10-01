import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { ArrowsLeftRight, CaretDown, Check, Info, PencilSimple, Plus, SealCheck, X } from '@phosphor-icons/react';
import api from '../api/client';
import TopBar from '../components/TopBar';
import Stars from '../components/ui/Stars';
import AgentMarkdown from '../components/ui/AgentMarkdown';
import OrgLogo, { carrierForPlan } from '../components/ui/OrgLogo';
import PageHead from '../components/ui/PageHead';
import useLayout from '../components/ui/useLayout';
import DecisionRecordPanel from '../components/DecisionRecordPanel';
import { RunSteps, SourceRow, ToolResults } from '../components/tools/ToolRun';
import { TOOL_FLOWS } from '../components/tools/toolFlows';
import { useAuth } from '../contexts/AuthContext';

// Carrier logo for a plan, falling back to the plan's initials.
function PlanLogo({ planName, size = 40 }) {
  const carrier = carrierForPlan(planName);
  return <OrgLogo name={carrier?.name || planName} website={carrier?.website} size={size} />;
}

// Medication or procedure entry: type, press Enter or Add, remove with the x.
function ChipInput({ label, placeholder, items, setItems }) {
  const [value, setValue] = useState('');
  const add = () => { if (value.trim()) { setItems([...items, value.trim()]); setValue(''); } };
  return (
    <div className="ws-listin">
      <label className="ws-listin-label" htmlFor={`chip-${label}`}>{label}</label>
      <div className="ws-listin-row">
        <input id={`chip-${label}`} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn" disabled={!value.trim()} onClick={add}><Plus size={14} weight="bold" /> Add</button>
      </div>
      {items.length > 0 && (
        <div className="ws-chips">
          {items.map((item, i) => (
            <span key={`${item}-${i}`} className="chip">{item}<button type="button" aria-label={`Remove ${item}`} onClick={() => setItems(items.filter((_, j) => j !== i))}><X size={11} weight="bold" /></button></span>
          ))}
        </div>
      )}
    </div>
  );
}

function currency(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return `$${Math.round(v).toLocaleString()}`;
}

function annualEstimate(plan) {
  const premium = (plan.monthly_premium || 0) * 12;
  const rxTotal = Object.values(plan.estimated_medication_costs || {}).reduce((s, v) => s + v, 0);
  const procTotal = Object.values(plan.estimated_procedure_costs || {}).reduce((s, v) => s + v, 0);
  return premium + rxTotal + procTotal + (plan.annual_deductible || 0) * 0.3;
}

/** Compares Medicare Advantage plans for a ZIP code and optional client profile. */
export default function PlanComparisonPage() {
  const location = useLocation();
  const { openMenu, openNotifications } = useLayout();
  const { user } = useAuth();

  const preset = location.state?.client;
  const [step, setStep] = useState('input');
  const [clientId, setClientId] = useState(preset?.id || '');
  const [clientOptions, setClientOptions] = useState([]);
  const [zip, setZip] = useState(preset?.zip_code || '10001');
  const [age, setAge] = useState(preset?.age || 67);
  const [income, setIncome] = useState(preset?.income_level || 'medium');
  const [rx, setRx] = useState(preset?.prescriptions || []);
  const [procs, setProcs] = useState(preset?.procedures || []);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [expandedPlanId, setExpandedPlanId] = useState(null);
  const [selectToast, setSelectToast] = useState('');
  const [whyOpen, setWhyOpen] = useState(false);

  useEffect(() => {
    api.get('/clients').then((d) => setClientOptions(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  function applyClient(c) {
    if (!c) return;
    setClientId(c.id);
    setZip(c.zip_code);
    setAge(c.age);
    setIncome(c.income_level);
    setRx(c.prescriptions || []);
    setProcs(c.procedures || []);
  }

  function selectPlan(plan, idx) {
    setSelectedPlanId(plan.plan_id);
    setSelectToast(`${plan.plan_name} selected`);
    if (clientId) {
      api.post('/history', {
        client_id: clientId,
        action_type: 'plan_selected',
        request_data: {
          plan_id: plan.plan_id,
          plan_name: plan.plan_name,
          session_id: result?.session_id,
        },
        response_summary: {
          monthly_premium: plan.monthly_premium,
          annual_estimate: Math.round(annuals[idx] || 0),
        },
      }).catch(() => {});
    }
    window.setTimeout(() => setSelectToast(''), 2400);
  }

  async function run() {
    setError('');
    setRunning(true);
    try {
      const data = await api.post('/compare', {
        zip_code: zip,
        age: parseInt(age, 10),
        income_level: income,
        medications: rx,
        procedures: procs,
      });
      setResult(data);
      setStep('results');
      setSelectedPlanId(null);
      setExpandedPlanId(null);
      setSelectToast('');
      setWhyOpen(false);
      if (clientId) {
        api.post('/history', {
          client_id: clientId,
          action_type: 'compare',
          request_data: { zip_code: zip, age, income_level: income },
          response_summary: { plans: data.plans?.length || 0, session_id: data.session_id },
        }).catch(() => {});
      }
    } catch (err) {
      setError(err.message || 'Comparison failed');
    } finally {
      setRunning(false);
    }
  }

  const plans = result?.plans || [];
  const annuals = plans.map(annualEstimate);
  const cheapestIdx = annuals.length ? annuals.indexOf(Math.min(...annuals)) : -1;
  const selectedClient = clientOptions.find((c) => c.id === clientId);

  const rows = plans.length > 0
    ? [
        { k: 'Est. annual cost', vals: annuals, fmt: currency },
        { k: 'Monthly premium', vals: plans.map((p) => p.monthly_premium), fmt: (v) => `$${v}` },
        { k: 'Deductible', vals: plans.map((p) => p.annual_deductible), fmt: currency },
        { k: 'Out-of-pocket max', vals: plans.map((p) => p.out_of_pocket_max), fmt: currency },
      ]
    : [];

  const flow = TOOL_FLOWS.compare;
  const flowInput = { zip, income, meds: rx.length, procs: procs.length };

  return (
    <MotionConfig reducedMotion="user">
      <TopBar
        crumbs={['AI Tools', 'Compare Plans']}
        onMenuClick={openMenu}
        onNotificationsClick={openNotifications}
        action={
          step === 'results' && (
            <button className="btn" onClick={() => setStep('input')}>
              <PencilSimple size={14} weight="duotone" /> Edit inputs
            </button>
          )
        }
      />
      <div className="page wide ws-page-in">
        <PageHead
          icon="compare"
          eyebrow={`Medicare Advantage · ${selectedClient ? `${selectedClient.full_name}, ZIP ${zip}` : `ZIP ${zip}`}`}
          title={step === 'results' && cheapestIdx >= 0 ? 'Comparison results' : 'Compare plans'}
          sub="Rank the plans in a client's ZIP by estimated yearly cost, weighted to their medications and expected procedures."
        />

        {step === 'input' && (
          <form className="card workspace-section workspace-inline-form cp-form" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <div className="ws-grid4">
              <label>Prefill from client
                <select
                  value={clientId}
                  onChange={(e) => {
                    const c = clientOptions.find((x) => x.id === e.target.value);
                    if (c) applyClient(c);
                    else setClientId('');
                  }}
                >
                  <option value="">None</option>
                  {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.full_name}, ZIP {c.zip_code}</option>)}
                </select>
              </label>
              <label>ZIP code<input value={zip} onChange={(e) => setZip(e.target.value)} pattern="\d{5}" maxLength={5} inputMode="numeric" required /></label>
              <label>Age<input type="number" value={age} onChange={(e) => setAge(e.target.value)} required /></label>
              <label>Income level
                <select value={income} onChange={(e) => setIncome(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
            <div className="ws-grid2">
              <ChipInput label="Medications" placeholder="e.g. Metformin 500mg" items={rx} setItems={setRx} />
              <ChipInput label="Expected procedures" placeholder="e.g. Annual physical" items={procs} setItems={setProcs} />
            </div>
            {error && <p role="alert" className="workspace-error">{error}</p>}
            <div className="ws-submit">
              <button type="submit" className="btn accent lg" disabled={running}>
                <ArrowsLeftRight size={16} weight="duotone" /> {running ? 'Comparing…' : 'Compare plans'}
              </button>
            </div>
          </form>
        )}

        {running && <RunSteps steps={flow.steps(flowInput)} running={running} title="Comparing plans" />}

        <ToolResults show={step === 'results' && Boolean(result)}>
          {result && <>
            {result.recommendation && (
              <section className="card workspace-section cp-rec-card">
                <div className="between cp-rec-head">
                  <h2><SealCheck size={20} weight="duotone" aria-hidden="true" /> Recommendation</h2>
                  {result.decision_id && (
                    <button className="btn sm" onClick={() => setWhyOpen(true)}>
                      <Info size={14} weight="duotone" /> How this result was made
                    </button>
                  )}
                </div>
                <div className="cp-rec-grid">
                  <AgentMarkdown className="cp-rec">{result.recommendation}</AgentMarkdown>
                  {cheapestIdx >= 0 && (
                    <div className="cp-rec-aside">
                      <PlanLogo planName={plans[cheapestIdx].plan_name} size={36} />
                      <small>Lowest estimated yearly cost</small>
                      <strong>{currency(annuals[cheapestIdx])}</strong>
                      <span>{plans[cheapestIdx].plan_name}</span>
                    </div>
                  )}
                </div>
                <SourceRow items={flow.sources} />
              </section>
            )}

            {selectToast && (
              <div className="notice cp-toast" role="status">
                <Check size={14} weight="bold" /> {selectToast}{clientId ? '. Saved to client history.' : ''}
              </div>
            )}

            <div className="cp-grid">
              {plans.map((p, i) => {
                const isBest = i === cheapestIdx;
                const isSelected = selectedPlanId && p.plan_id === selectedPlanId;
                const isExpanded = expandedPlanId && p.plan_id === expandedPlanId;
                const rxCosts = Object.entries(p.estimated_medication_costs || {});
                const procCosts = Object.entries(p.estimated_procedure_costs || {});
                return (
                  <div key={p.plan_id || i} data-testid="plan-row" className={`cp-plan${isBest ? ' best' : ''}${isSelected ? ' selected' : ''}`}>
                    <div className="cp-plan-top">
                      <PlanLogo planName={p.plan_name} />
                      <div className="cp-plan-tags">
                        <span className="workspace-tag">{p.plan_type}</span>
                        {isBest && <span className="chip pos">Lowest yearly cost</span>}
                      </div>
                    </div>
                    <h3>{p.plan_name}</h3>
                    {carrierForPlan(p.plan_name) && <small className="cp-carrier">{carrierForPlan(p.plan_name).name}</small>}
                    <div className="cp-stars"><Stars value={p.star_rating} /><small>{p.star_rating?.toFixed(1)} · {p.drug_coverage ? 'Rx included' : 'No Rx'}</small></div>
                    <dl>
                      <div><dt>Premium</dt><dd>${p.monthly_premium}/mo</dd></div>
                      <div><dt>Deductible</dt><dd>{currency(p.annual_deductible)}</dd></div>
                      <div><dt>Out-of-pocket max</dt><dd>{currency(p.out_of_pocket_max)}</dd></div>
                      <div><dt>Estimated per year</dt><dd className="cp-est">{currency(annuals[i])}</dd></div>
                    </dl>
                    {isExpanded && (
                      <div className="cp-detail">
                        <div><small>Plan ID</small><span className="mono">{p.plan_id || '—'}</span></div>
                        {rxCosts.length > 0 && <div><small>Estimated drug costs (yearly)</small>{rxCosts.map(([name, cost]) => <div key={name} className="between"><span>{name}</span><span className="mono">{currency(cost)}</span></div>)}</div>}
                        {procCosts.length > 0 && <div><small>Estimated procedures (yearly)</small>{procCosts.map(([name, cost]) => <div key={name} className="between"><span>{name}</span><span className="mono">{currency(cost)}</span></div>)}</div>}
                        {rxCosts.length === 0 && procCosts.length === 0 && <small>No medication or procedure estimates for this plan.</small>}
                      </div>
                    )}
                    <div className="cp-actions">
                      <button type="button" className={`btn ${isSelected ? 'primary' : isBest ? 'accent' : ''}`} onClick={() => selectPlan(p, i)} aria-pressed={Boolean(isSelected)}>
                        {isSelected ? <><Check size={14} weight="bold" /> Selected</> : isBest ? 'Recommend' : 'Select'}
                      </button>
                      <button type="button" className="btn ghost icon" aria-label={isExpanded ? 'Hide details' : 'Show details'} aria-expanded={Boolean(isExpanded)} onClick={() => setExpandedPlanId(isExpanded ? null : p.plan_id)}>
                        <CaretDown size={14} weight="bold" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 140ms' }} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {rows.length > 0 && (
              <section className="card workspace-section">
                <div className="between"><h2>Side by side</h2><span className="workspace-small">Shorter bars are better</span></div>
                {rows.map((row, ri) => {
                  const max = Math.max(...row.vals.map((v) => v || 0));
                  return (
                    <div key={ri} className="cp-bars">
                      <div className="between cp-bars-head"><span>{row.k}</span><small>{plans.length} plans</small></div>
                      {row.vals.map((v, i) => (
                        <div key={i} className="cbar-row">
                          <span className="cp-bar-name"><PlanLogo planName={plans[i].plan_name} size={20} />{plans[i].plan_name}</span>
                          <div className="cbar-track"><div className={`cbar-fill ${i === cheapestIdx ? '' : 'muted'}`} style={{ width: max === 0 ? '2%' : `${Math.max(2, ((v || 0) / max) * 100)}%` }} /></div>
                          <div className="num mono">{row.fmt(v)}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </section>
            )}

            {result.disclaimer && <p className="ws-note">{result.disclaimer}</p>}

            <DecisionRecordPanel
              decisionId={result.decision_id}
              open={whyOpen}
              onClose={() => setWhyOpen(false)}
              recordedBy={user?.email ? `You, ${user.email}` : 'You'}
            />
          </>}
        </ToolResults>
      </div>
    </MotionConfig>
  );
}
