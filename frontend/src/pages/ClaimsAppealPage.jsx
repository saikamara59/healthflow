import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client';
import DocumentList from '../components/DocumentList';
import { workspaceApi } from '../api/workspace';
import TopBar from '../components/TopBar';
import Icon from '../components/ui/Icon';
import Chip from '../components/ui/Chip';
import AgentMarkdown from '../components/ui/AgentMarkdown';
import useLayout from '../components/ui/useLayout';

const SAMPLE = `This letter is to inform you that your claim for MRI of the right shoulder
performed on 03/14/2026 has been denied.

Reason for denial: Services not medically necessary.
Policy section: Section 4.2(b), Diagnostic Imaging.
Denial date: 03/28/2026.
You have 60 days to appeal this decision.`;

const MAX_ADDITIONAL_CONTEXT = 1000;
const MAX_APPEAL_TITLE = 300;
const APPEAL_TITLE_PREFIX = 'Appeal draft: ';

/** Analyzes a denial notice and prepares supporting material for an appeal. */
export default function ClaimsAppealPage() {
  const { openMenu, openNotifications } = useLayout();
  const location = useLocation();
  const [denialText, setDenialText] = useState('');
  const [context, setContext] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [savedAppeal, setSavedAppeal] = useState(null);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState([]);
  const [clients, setClients] = useState([]);
  const [issueId, setIssueId] = useState(new URLSearchParams(location.search).get('issue') || '');
  const [newIssue, setNewIssue] = useState({ client_id: '', title: '' });

  useEffect(() => {
    let alive = true;
    Promise.all([workspaceApi.listAllIssues(), workspaceApi.listLinkableClients()]).then(([issueData, clientData]) => {
      if (alive) { setIssues(issueData); setClients(clientData); }
    }).catch(() => { if (alive) setError('Issue context could not be loaded.'); });
    return () => { alive = false; };
  }, []);

  async function createIssue(event) {
    event.preventDefault();
    if (!window.confirm('Create this Issue and use it for the Appeal draft?')) return;
    try {
      const created = await workspaceApi.createIssue(newIssue);
      setIssues((current) => [created, ...current]);
      setIssueId(created.id);
      setNewIssue({ client_id: '', title: '' });
      setError('');
    } catch (err) {
      setError(err.message || 'Issue could not be created.');
    }
  }

  async function run() {
    if (!denialText.trim()) return;
    const issue = issues.find((item) => item.id === issueId);
    if (!issueId || !issue) {
      setError('Choose an existing Issue or confirm creation of a new one before drafting an Appeal.');
      return;
    }
    setError('');
    setRunning(true);
    setSavedAppeal(null);
    try {
      const issueContext = `Issue context: ${issue.title}`;
      const additionalContext = [context, issueContext].filter(Boolean).join('\n\n');
      if (additionalContext.length > MAX_ADDITIONAL_CONTEXT) {
        setError('Additional context is too long for the selected Issue. Shorten it and try again.');
        return;
      }
      const res = await api.post('/appeal', {
        denial_text: denialText,
        additional_context: additionalContext,
      });
      setResult(res);
      try {
        const saved = await workspaceApi.createAppeal({
          issue_id: issueId,
          title: `${APPEAL_TITLE_PREFIX}${issue.title.slice(0, MAX_APPEAL_TITLE - APPEAL_TITLE_PREFIX.length)}`,
          draft_text: res.appeal_letter,
        });
        setSavedAppeal({ ...saved, client_id: issue.client_id });
      } catch {
        setError('The Appeal was generated, but the draft could not be saved. Copy the letter before leaving this page and try again.');
      }
    } catch (err) {
      setError(err.message || 'Appeal generation failed');
    } finally {
      setRunning(false);
    }
  }

  const selectedIssue = issues.find((item) => item.id === issueId);
  const issueContextLength = selectedIssue ? `Issue context: ${selectedIssue.title}`.length : 0;
  const contextLimit = Math.max(0, MAX_ADDITIONAL_CONTEXT - issueContextLength - (selectedIssue ? 2 : 0));

  function copyLetter() {
    if (!result?.appeal_letter) return;
    navigator.clipboard?.writeText(result.appeal_letter);
  }

  return (
    <>
      <TopBar crumbs={['Tools', 'Claim appeals']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
      <div className="page wide">
        <div className="page-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Denial analysis and letter drafting</div>
            <h1 className="page-title">Turn a denial into<br /><em>an appeal.</em></h1>
            <p className="page-sub">
              Paste the denial letter. HealthFlow extracts the reason code, policy citation, and deadline, surfaces
              relevant CMS guidance, and drafts a formal appeal letter you can edit.
            </p>
          </div>
        </div>

        <section className="card workspace-section" style={{ marginBottom: 24 }}>
          <h2>Issue context</h2>
          <p>Every Appeal stays inside an Issue so its deadline, Follow-ups, and Appointments remain together.</p>
          <div className="workspace-form-grid">
            <label className="field"><span className="field-label">Existing Issue</span><select className="select" value={issueId} onChange={(event) => { setIssueId(event.target.value); setError('') }}><option value="">Choose an Issue</option>{issues.map((issue) => <option key={issue.id} value={issue.id}>{issue.client_name} · {issue.title}</option>)}</select></label>
            <form className="workspace-inline-form" onSubmit={createIssue} style={{ marginBottom: 0 }}><div className="workspace-form-grid"><label>Client<select required value={newIssue.client_id} onChange={(event) => setNewIssue({ ...newIssue, client_id: event.target.value })}><option value="">Choose a Client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label><label>New Issue title<input required value={newIssue.title} onChange={(event) => setNewIssue({ ...newIssue, title: event.target.value })} /></label></div><button className="btn sm" type="submit">Create and use Issue</button></form>
          </div>
        </section>

        {savedAppeal && <DocumentList clientId={savedAppeal.client_id} targetType="appeal" targetId={savedAppeal.id} />}
        <div className="grid-12" style={{ gap: 24 }}>
          <div style={{ gridColumn: 'span 5' }}>
            <div className="section-head" style={{ marginTop: 0 }}>
              <h2>Denial letter</h2>
              <div className="after"><button className="btn sm" onClick={() => setDenialText(SAMPLE)}>Use sample</button></div>
            </div>
            <div className="card">
              <textarea
                className="textarea"
                style={{ height: 340, border: 0, background: 'transparent', fontFamily: 'var(--mono)', fontSize: 12.5 }}
                value={denialText}
                onChange={(e) => setDenialText(e.target.value)}
                placeholder="Paste the denial letter text…"
              />
            </div>

            <div className="section-head"><h2>Additional context</h2><div className="after">optional</div></div>
            <div className="card">
              <textarea
                className="textarea"
                style={{ height: 140, border: 0, background: 'transparent', fontSize: 13 }}
                value={context}
                maxLength={contextLimit}
                onChange={(e) => setContext(e.target.value.slice(0, contextLimit))}
                placeholder="Add referring physician notes, symptom history, or prior failed treatments."
              />
            </div>

            {error && <div role="alert" className="notice" style={{ marginTop: 16, color: 'var(--neg)', borderColor: 'var(--neg)' }}>{error}</div>}

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn accent" onClick={run} disabled={running || !denialText.trim()}>
                {running ? <><span className="loader" /> Drafting…</> : <><Icon name="appeal" size={14} /> Analyze &amp; draft</>}
              </button>
            </div>
          </div>

          <div style={{ gridColumn: 'span 7' }}>
            {!result && !running && (
              <div className="card card-pad" style={{ padding: 40, textAlign: 'center' }}>
                <div className="placeholder-img" style={{ height: 240, marginBottom: 20 }}>Appeal output</div>
                <div className="muted" style={{ maxWidth: 440, margin: '0 auto' }}>
                  The denial analysis, CMS grounds, and drafted letter will appear here once you run analysis.
                </div>
              </div>
            )}

            {running && <div className="card card-pad" style={{ textAlign: 'center', padding: 60 }}><div className="loader" /></div>}

            {result && (
              <>
                <div className="section-head" style={{ marginTop: 0 }}>
                  <h2>Denial analysis</h2>
                </div>
                <div className="card card-pad">
                  <div className="kv-grid">
                    <div className="kv"><span className="k">Reason code</span><span className="v">{result.denial_analysis.denial_reason_code || 'Unknown'}</span></div>
                    <div className="kv"><span className="k">Treatment denied</span><span className="v">{result.denial_analysis.treatment_denied}</span></div>
                    <div className="kv"><span className="k">Appeal deadline</span><span className="v">{result.denial_analysis.appeal_deadline || '—'}</span></div>
                    <div className="kv"><span className="k">Policy cited</span><span className="v">{result.denial_analysis.policy_section_cited || '—'}</span></div>
                    <div className="kv"><span className="k">Denial date</span><span className="v">{result.denial_analysis.denial_date || '—'}</span></div>
                  </div>
                  <div className="divider dashed" style={{ margin: '20px 0' }} />
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Stated reason</div>
                  <div style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{result.denial_analysis.denial_reason}</div>
                </div>

                <div className="section-head"><h2>Coverage grounds</h2></div>
                <div className="card card-pad">
                  <div className="eyebrow" style={{ marginBottom: 8 }}>CMS rule</div>
                  <div style={{ fontSize: 14, fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-2)' }}>
                    {result.coverage_argument.cms_rule}
                  </div>
                  {result.coverage_argument.common_appeal_grounds?.length > 0 && (
                    <>
                      <div className="divider dashed" style={{ margin: '20px 0' }} />
                      <div className="eyebrow" style={{ marginBottom: 10 }}>Appeal grounds</div>
                      <div className="col" style={{ gap: 8 }}>
                        {result.coverage_argument.common_appeal_grounds.map((g, i) => (
                          <div key={i} className="row" style={{ gap: 10, fontSize: 13 }}>
                            <Icon name="check" size={14} style={{ color: 'var(--pos)' }} />
                            <span>{g}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {result.coverage_argument.success_precedents?.length > 0 && (
                    <>
                      <div className="divider dashed" style={{ margin: '20px 0' }} />
                      <div className="eyebrow" style={{ marginBottom: 10 }}>Success precedents</div>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {result.coverage_argument.success_precedents.map((p, i) => (
                          <Chip key={i} tone="accent">{p}</Chip>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="section-head">
                  <h2>Drafted appeal letter</h2>
                  <div className="after">
                    <button className="btn sm" onClick={copyLetter}>
                      <Icon name="download" size={12} /> Copy
                    </button>
                  </div>
                </div>
                <div className="card" style={{ padding: 24 }}>
                  <AgentMarkdown style={{ fontSize: 14.5 }}>
                    {result.appeal_letter}
                  </AgentMarkdown>
                </div>

                {result.disclaimer && <div className="notice" style={{ marginTop: 20 }}>{result.disclaimer}</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
