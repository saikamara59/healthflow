import { useState, useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { Pill, SealCheck, Stethoscope, Warning } from '@phosphor-icons/react';
import api from '../api/client';
import TopBar from '../components/TopBar';
import AgentMarkdown from '../components/ui/AgentMarkdown';
import DrugAutocomplete from '../components/ui/DrugAutocomplete';
import { PlanLogo } from '../components/ui/OrgLogo';
import PageHead from '../components/ui/PageHead';
import useLayout from '../components/ui/useLayout';
import { RunSteps, SourceRow, ToolResults } from '../components/tools/ToolRun';
import { ClientPrefill, PairListInput } from '../components/tools/ToolInputs';
import { TOOL_FLOWS } from '../components/tools/toolFlows';
import { useWorkingWithPrefill } from '../contexts/WorkingWithContext';

/** Checks provider-network and formulary data for a client's selected plans. */
export default function NetworkVerificationPage() {
  const { openMenu, openNotifications } = useLayout();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [zip, setZip] = useState('10001');
  const [income, setIncome] = useState('medium');
  const [providers, setProviders] = useState([]);
  const [rx, setRx] = useState([]);
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
    setProviders((c.doctors || []).map((doctor) => ({ name: doctor.name, npi: doctor.npi || '' })));
    setRx(c.prescriptions || []);
  }
  // Working With prefills this Tool; its own Prefill from client overrides it here only.
  useWorkingWithPrefill(applyClient, () => setClientId(''));

  async function run() {
    setError('');
    setRunning(true);
    setResult(null);
    try {
      const res = await api.post('/verify', {
        zip_code: zip,
        income_level: income,
        providers: providers.map((p) => ({ name: p.name, npi: p.npi || null })),
        prescriptions: rx,
      });
      setResult(res);
      if (clientId) {
        api.post('/history', {
          client_id: clientId,
          action_type: 'verify',
          request_data: { zip_code: zip, income_level: income, providers: providers.length, prescriptions: rx.length },
          response_summary: { plans: res.plans?.length || 0 },
        }).catch(() => {});
      }
    } catch (err) {
      setError(err.message || 'Verification failed');
    } finally {
      setRunning(false);
    }
  }

  const flow = TOOL_FLOWS.network;
  const plans = result?.plans || [];
  const ready = /^\d{5}$/.test(zip) && (providers.length > 0 || rx.length > 0);
  const coverage = (plan) => {
    const providersIn = plan.provider_results.filter((r) => r.in_network).length;
    const drugsCovered = plan.formulary_results.filter((r) => r.on_formulary).length;
    return { providersIn, drugsCovered, complete: providersIn === plan.provider_results.length && drugsCovered === plan.formulary_results.length };
  };
  const providerRows = plans[0]?.provider_results.map((item, index) => ({ item, index })) || [];
  const drugRows = plans[0]?.formulary_results.map((item, index) => ({ item, index })) || [];

  return (
    <MotionConfig reducedMotion="user">
      <TopBar crumbs={['AI Tools', 'Check Network']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
      <div className="page wide ws-page-in">
        <PageHead
          icon="network"
          eyebrow="Provider and formulary check"
          title="Check coverage before enrollment"
          sub="See which plans in a client's ZIP list their doctors and cover their prescriptions. Confirm network and drug coverage directly with the plan before enrollment."
        />

        <form className="card workspace-section workspace-inline-form cp-form" onSubmit={(e) => { e.preventDefault(); if (ready) run(); }} noValidate>
          <div className="ws-grid4">
            <ClientPrefill clients={clients} value={clientId} onPick={applyClient} />
            <label>ZIP code<input value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" maxLength={5} /></label>
            <label>Income
              <select value={income} onChange={(e) => setIncome(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <div className="ws-grid2">
            <PairListInput
              label="Providers"
              fields={[{ key: 'name', placeholder: 'Doctor name' }, { key: 'npi', placeholder: 'NPI (optional)', narrow: true }]}
              items={providers}
              setItems={setProviders}
              format={(item) => (item.npi ? `${item.name} · NPI ${item.npi}` : item.name)}
            />
            <div className="ws-listin">
              <div className="ws-listin-label">Prescriptions</div>
              <DrugAutocomplete values={rx} onChange={setRx} placeholder="Medication name" />
            </div>
          </div>
          {error && <p role="alert" className="workspace-error">{error}</p>}
          <div className="ws-submit">
            {!ready && <span className="workspace-small">Add at least one provider or prescription.</span>}
            <button type="submit" className="btn accent lg" disabled={running || !ready}>
              <SealCheck size={16} weight="duotone" /> {running ? 'Checking…' : 'Check coverage'}
            </button>
          </div>
        </form>

        {running && <RunSteps steps={flow.steps({ zip, providers: providers.length, drugs: rx.length })} running={running} title="Checking coverage" />}

        <ToolResults show={Boolean(result) && !running}>
          {result && <>
            {result.recommendation && (
              <section className="card workspace-section cp-rec-card">
                <div className="between cp-rec-head"><h2><SealCheck size={20} weight="duotone" aria-hidden="true" /> Recommendation</h2></div>
                <AgentMarkdown className="cp-rec">{result.recommendation}</AgentMarkdown>
                <SourceRow items={flow.sources} />
              </section>
            )}

            {plans.length > 0 && (
              <section className="card workspace-section">
                <div className="between"><h2>Coverage by plan</h2><span className="workspace-small">ZIP {zip} · {plans.length} plans checked</span></div>
                <div className="cost-table-wrap">
                  <table className="tbl net-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        {plans.map((plan) => {
                          const summary = coverage(plan);
                          return (
                            <th key={plan.plan_id}>
                              <span className="net-plan"><PlanLogo planName={plan.plan_name} size={24} /><span>{plan.plan_name}</span></span>
                              <span className={`chip ${summary.complete ? 'pos' : 'warn'}`}>{summary.complete ? 'Covers everything' : 'Has gaps'}</span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {providerRows.map(({ item, index }) => (
                        <tr key={`provider-${index}`}>
                          <td>
                            <span className="net-item"><Stethoscope size={15} weight="duotone" aria-hidden="true" /><span><strong>{item.name}</strong><small>{[item.specialty, item.npi && `NPI ${item.npi}`].filter(Boolean).join(' · ') || 'Provider'}</small>{item.npi_verified ? <small className="net-ok">Verified in NPPES</small> : <small className="net-warn">Not found in NPPES</small>}</span></span>
                          </td>
                          {plans.map((plan) => {
                            const cell = plan.provider_results[index];
                            return (
                              <td key={plan.plan_id}>
                                <span className={`chip ${cell?.in_network ? 'pos' : 'neg'}`}>{cell?.in_network ? 'Listed in network' : 'Not listed'}</span>
                                {cell?.warning && <small className="net-warn"><Warning size={12} weight="duotone" aria-hidden="true" />{cell.warning}</small>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {drugRows.map(({ item, index }) => (
                        <tr key={`drug-${index}`}>
                          <td><span className="net-item"><Pill size={15} weight="duotone" aria-hidden="true" /><span><strong>{item.drug_name}</strong><small>Prescription</small></span></span></td>
                          {plans.map((plan) => {
                            const cell = plan.formulary_results[index];
                            if (!cell?.on_formulary) return <td key={plan.plan_id}><span className="chip neg">Not on formulary</span></td>;
                            const tierNumber = Number(String(cell.tier || '').match(/\d+/)?.[0] || 0);
                            return (
                              <td key={plan.plan_id}>
                                <span className={`chip ${tierNumber >= 3 ? 'warn' : 'pos'}`}>{cell.tier ? `Tier ${tierNumber || cell.tier}` : 'Covered'}{cell.copay != null ? ` · $${cell.copay}` : ''}</span>
                                {cell.prior_auth_required && <small className="net-warn"><Warning size={12} weight="duotone" aria-hidden="true" />Prior authorization</small>}
                                {cell.warning && <small className="net-warn"><Warning size={12} weight="duotone" aria-hidden="true" />{cell.warning}</small>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <p className="ws-note">{result.disclaimer || 'Networks change during the year.'} Network results come from a sample table, not the plans' own directories, so confirm with the plan before enrollment.</p>
          </>}
        </ToolResults>
      </div>
    </MotionConfig>
  );
}
