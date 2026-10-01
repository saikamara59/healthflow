import { useState, useEffect } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import { Calculator } from '@phosphor-icons/react';
import api from '../api/client';
import TopBar from '../components/TopBar';
import AgentMarkdown from '../components/ui/AgentMarkdown';
import { PlanLogo } from '../components/ui/OrgLogo';
import PageHead from '../components/ui/PageHead';
import useLayout from '../components/ui/useLayout';
import { RunSteps, SourceRow, ToolResults } from '../components/tools/ToolRun';
import { ClientPrefill, PairListInput } from '../components/tools/ToolInputs';
import { TOOL_FLOWS } from '../components/tools/toolFlows';

function currency(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return `$${Math.round(v).toLocaleString()}`;
}

/** Estimates a client's annual healthcare costs from plan and usage inputs. */
export default function CostCalculatorPage() {
  const { openMenu, openNotifications } = useLayout();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [zip, setZip] = useState('10001');
  const [income, setIncome] = useState('medium');
  const [visits, setVisits] = useState(12);
  const [rx, setRx] = useState([]);
  const [procs, setProcs] = useState([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/clients').then((d) => setClients(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  function applyClient(c) {
    if (!c) { setClientId(''); return; }
    setClientId(c.id);
    setZip(c.zip_code);
    setIncome(c.income_level);
    setRx((c.prescriptions || []).map((name) => ({ name, fills_per_year: 12 })));
    setProcs((c.procedures || []).map((name) => ({ name, count: 1 })));
  }

  async function run() {
    setError('');
    setRunning(true);
    setResult(null);
    try {
      const res = await api.post('/calculate', {
        zip_code: zip,
        income_level: income,
        usage: {
          doctor_visits_per_year: parseInt(visits, 10) || 0,
          prescriptions: rx.map((item) => ({ name: item.name, fills_per_year: parseInt(item.fills_per_year, 10) || 12 })),
          procedures: procs.map((item) => ({ name: item.name, count: parseInt(item.count, 10) || 1 })),
        },
      });
      setResult(res);
      if (clientId) {
        api.post('/history', {
          client_id: clientId,
          action_type: 'calculate',
          request_data: { zip_code: zip, visits, prescriptions: rx.length },
          response_summary: { plans: res.plans?.length || 0 },
        }).catch(() => {});
      }
    } catch (err) {
      setError(err.message || 'Calculation failed');
    } finally {
      setRunning(false);
    }
  }

  const flow = TOOL_FLOWS.cost;
  const plans = [...(result?.plans || [])].sort((a, b) => a.total_annual_cost - b.total_annual_cost);
  const cheapest = plans[0];
  const maxTotal = Math.max(1, ...plans.map((p) => p.total_annual_cost || 0));
  const zipOk = /^\d{5}$/.test(zip);

  return (
    <MotionConfig reducedMotion="user">
      <TopBar crumbs={['AI Tools', 'Estimate Costs']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
      <div className="page wide ws-page-in">
        <PageHead
          icon="cost"
          eyebrow="Project yearly spend"
          title="Estimate costs"
          sub="Project a client's total yearly spend across premiums, doctor visits, prescriptions, and expected procedures for the plans in their ZIP."
        />

        <form className="card workspace-section workspace-inline-form cp-form" onSubmit={(e) => { e.preventDefault(); if (zipOk) run(); }} noValidate>
          <div className="ws-grid4">
            <ClientPrefill clients={clients} value={clientId} onPick={applyClient} />
            <label>ZIP code
              <input value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" maxLength={5} aria-invalid={!zipOk} />
              {!zipOk && <span className="td-err">Enter a 5-digit ZIP.</span>}
            </label>
            <label>Income level
              <select value={income} onChange={(e) => setIncome(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>Doctor visits per year<input type="number" min="0" max="100" value={visits} onChange={(e) => setVisits(e.target.value)} /></label>
          </div>
          <div className="ws-grid2">
            <PairListInput
              label="Prescriptions (fills per year)"
              fields={[{ key: 'name', placeholder: 'Medication' }, { key: 'fills_per_year', placeholder: 'Fills', type: 'number', initial: '12', narrow: true }]}
              items={rx}
              setItems={setRx}
              format={(item) => `${item.name} · ${item.fills_per_year}×/yr`}
            />
            <PairListInput
              label="Procedures (count per year)"
              fields={[{ key: 'name', placeholder: 'Procedure' }, { key: 'count', placeholder: 'Count', type: 'number', initial: '1', narrow: true }]}
              items={procs}
              setItems={setProcs}
              format={(item) => `${item.name} · ${item.count}×/yr`}
            />
          </div>
          {error && <p role="alert" className="workspace-error">{error}</p>}
          <div className="ws-submit">
            <button type="submit" className="btn accent lg" disabled={running || !zipOk}>
              <Calculator size={16} weight="duotone" /> {running ? 'Estimating…' : 'Estimate cost'}
            </button>
          </div>
        </form>

        {running && <RunSteps steps={flow.steps({ zip, meds: rx.length, procs: procs.length, visits })} running={running} title="Estimating costs" />}

        <ToolResults show={Boolean(result) && !running}>
          {result && <>
            {cheapest && (
              <section className="card workspace-section cp-rec-card">
                <div className="cp-rec-grid">
                  <div>
                    <h2 className="cost-headline">{cheapest.plan_name} is the lowest estimate for this year.</h2>
                    {result.recommendation && <AgentMarkdown className="cp-rec">{result.recommendation}</AgentMarkdown>}
                  </div>
                  <div className="cp-rec-aside">
                    <PlanLogo planName={cheapest.plan_name} size={36} />
                    <small>Estimated yearly total</small>
                    <strong>{currency(cheapest.total_annual_cost)}</strong>
                    <span>{currency(cheapest.annual_premium)} premium · {currency(cheapest.annual_care_cost)} care</span>
                  </div>
                </div>
                <SourceRow items={flow.sources} />
              </section>
            )}

            <section className="card workspace-section">
              <div className="between"><h2>Estimated yearly cost by plan</h2><span className="workspace-small">ZIP {zip} · {rx.length} medication{rx.length === 1 ? '' : 's'} · {visits || 0} visits</span></div>
              <div className="cost-table-wrap">
                <table className="tbl cost-table">
                  <thead><tr><th>Plan</th><th>Premiums</th><th>Visits</th><th>Prescriptions</th><th>Procedures</th><th>Estimated total</th></tr></thead>
                  <tbody>
                    {plans.map((p, index) => (
                      <tr key={p.plan_id} className={p === cheapest ? 'best' : ''}>
                        <td>
                          <span className="cost-plan"><PlanLogo planName={p.plan_name} size={28} /><span><strong>{p.plan_name}</strong>{p === cheapest && <span className="chip pos">Lowest estimate</span>}</span></span>
                        </td>
                        <td className="mono">{currency(p.annual_premium)}</td>
                        <td className="mono">{currency(p.breakdown?.doctor_visit_costs)}</td>
                        <td className="mono">{currency(p.breakdown?.prescription_costs)}</td>
                        <td className="mono">{currency(p.breakdown?.procedure_costs)}</td>
                        <td className="cost-total">
                          <div className="ws-bar"><motion.span initial={{ width: 0 }} animate={{ width: `${((p.total_annual_cost || 0) / maxTotal) * 100}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.05 * index }} /></div>
                          <strong className="mono">{currency(p.total_annual_cost)}</strong>
                          {p.breakdown?.oop_cap_applied && <small>Out-of-pocket max reached</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {result.disclaimer && <p className="ws-note">{result.disclaimer}</p>}
          </>}
        </ToolResults>
      </div>
    </MotionConfig>
  );
}
