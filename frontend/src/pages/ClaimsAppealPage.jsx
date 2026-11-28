import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client';
import { useWorkingWith } from '../contexts/WorkingWithContext';
import DocumentList from '../components/DocumentList';
import { workspaceApi } from '../api/workspace';
import { MotionConfig } from 'framer-motion';
import { CheckCircle, ClipboardText, CopySimple, FileText, PencilSimpleLine, Scales } from '@phosphor-icons/react';
import TopBar from '../components/TopBar';
import Chip from '../components/ui/Chip';
import AgentMarkdown from '../components/ui/AgentMarkdown';
import PageHead from '../components/ui/PageHead';
import useLayout from '../components/ui/useLayout';
import SaveToolOutput from '../components/workspace/SaveToolOutput';
import { RunSteps, SourceRow, ToolResults } from '../components/tools/ToolRun';
import { TOOL_FLOWS } from '../components/tools/toolFlows';

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
  const [linkedIssueId] = useState(() => new URLSearchParams(location.search).get('issue') || '');
  const [issueId, setIssueId] = useState(linkedIssueId);
  const [newIssue, setNewIssue] = useState({ client_id: '', title: '' });
  // Each run takes a ticket. Changing the Issue invalidates it, so a letter that
  // arrives late is never shown, or saved as a Document, under a different Client.
  const generation = useRef(0);
  // Working With narrows the Issues to that Client, unless a link chose an Issue.
  const { client: focus } = useWorkingWith();
  const narrowTo = linkedIssueId ? null : focus;
  // An Issue the Broker just created here stays listed and selected, even for another Client.
  const [createdIssueId, setCreatedIssueId] = useState('');
  const shownIssues = issues.filter((issue) => !issue.client_archived
    && (!narrowTo || issue.client_id === narrowTo.id || issue.id === createdIssueId));

  // Preselect the focused Client's Issue only when exactly one is open; never guess between several.
  useEffect(() => {
    if (!narrowTo) return;
    const open = shownIssues.filter((issue) => issue.status !== 'resolved');
    setIssueId((current) => (shownIssues.some((issue) => issue.id === current) ? current : (open.length === 1 ? open[0].id : '')));
  }, [narrowTo?.id, issues]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    generation.current += 1;
    setResult(null);
    setSavedAppeal(null);
    setRunning(false);
  }, [issueId]);

  useEffect(() => {
    if (focus) setNewIssue((current) => ({ ...current, client_id: focus.id }));
  }, [focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setCreatedIssueId(created.id);
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
    if (issue.client_archived) {
      setError('Restore the Client before drafting a new Appeal. Historical Issues and Appeals remain available in Issues & Appeals.');
      return;
    }
    const ticket = ++generation.current;
    const isCurrent = () => ticket === generation.current;
    setError('');
    setRunning(true);
    // A previous letter never reappears after a run that stops early or fails.
    setResult(null);
    setSavedAppeal(null);
    try {
      // The fresh copy decides which Client the letter belongs to.
      const currentIssue = await workspaceApi.getIssue(issueId);
      if (!isCurrent()) return;
      const refreshIssue = () => setIssues((current) => current.map((item) => item.id === issueId ? currentIssue : item));
      if (currentIssue.client_archived) {
        refreshIssue();
        setError('Restore the Client before drafting a new Appeal.');
        return;
      }
      // If the Issue moved to another Client since this page loaded it, stop
      // before drafting: nothing is generated or saved for a Client the Broker
      // did not see. The refreshed list may also deselect it under Working With.
      if (currentIssue.client_id !== issue.client_id) {
        refreshIssue();
        setError(`This Issue now belongs to ${currentIssue.client_name}. Check the Issue, then draft again.`);
        return;
      }
      const issueContext = `Issue context: ${currentIssue.title}`;
      const additionalContext = [context, issueContext].filter(Boolean).join('\n\n');
      if (additionalContext.length > MAX_ADDITIONAL_CONTEXT) {
        setError('Additional context is too long for the selected Issue. Shorten it and try again.');
        return;
      }
      const res = await api.post('/appeal', {
        denial_text: denialText,
        additional_context: additionalContext,
      });
      // The draft still belongs to the Issue it was generated for, even if the
      // Broker has moved on; only the on-screen state is tied to the current Issue.
      if (isCurrent()) setResult({ ...res, client_id: currentIssue.client_id });
      try {
        const saved = await workspaceApi.createAppeal({
          issue_id: issueId,
          title: `${APPEAL_TITLE_PREFIX}${currentIssue.title.slice(0, MAX_APPEAL_TITLE - APPEAL_TITLE_PREFIX.length)}`,
          draft_text: res.appeal_letter,
        });
        if (isCurrent()) setSavedAppeal({ ...saved, client_id: currentIssue.client_id });
      } catch {
        if (isCurrent()) setError('The Appeal was generated, but the draft could not be saved. Copy the letter before leaving this page and try again.');
      }
    } catch (err) {
      if (isCurrent()) setError(err.message || 'Appeal generation failed');
    } finally {
      if (isCurrent()) setRunning(false);
    }
  }

  const selectedIssue = issues.find((item) => item.id === issueId);
  const issueContextLength = selectedIssue ? `Issue context: ${selectedIssue.title}`.length : 0;
  const contextLimit = Math.max(0, MAX_ADDITIONAL_CONTEXT - issueContextLength - (selectedIssue ? 2 : 0));

  const [copied, setCopied] = useState(false);
  function copyLetter() {
    if (!result?.appeal_letter) return;
    navigator.clipboard?.writeText(result.appeal_letter).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }
  const flow = TOOL_FLOWS.appeal;

  return (
    <MotionConfig reducedMotion="user">
      <TopBar crumbs={['AI Tools', 'Draft Appeal']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
      <div className="page wide ws-page-in">
        <PageHead
          icon="appeal"
          eyebrow="Denial analysis and letter drafting"
          title="Draft an appeal"
          sub="Paste the denial letter. HealthFlow pulls out the reason code, policy citation, and deadline, matches CMS guidance for that code, and drafts a formal appeal letter you can edit."
        />

        <section className="card workspace-section ap-issue">
          <h2>Issue context</h2>
          <p className="workspace-small">Every appeal stays inside an Issue so its deadline, follow-ups, and appointments remain together.</p>
          <div className="workspace-form-grid ap-issue-grid">
            <label className="workspace-filter ap-existing">Existing Issue
              <select value={selectedIssue?.client_archived ? '' : issueId} onChange={(event) => { setIssueId(event.target.value); setError('') }}>
                <option value="">Choose an Issue</option>
                {shownIssues.map((issue) => <option key={issue.id} value={issue.id}>{issue.client_name} · {issue.title}</option>)}
              </select>
            </label>
            {narrowTo && <p className="workspace-small ap-narrowed">Showing {narrowTo.full_name}'s Issues</p>}
            <form className="workspace-inline-form ap-new-issue" onSubmit={createIssue}>
              <div className="workspace-form-grid">
                <label>Client<select required value={newIssue.client_id} onChange={(event) => setNewIssue({ ...newIssue, client_id: event.target.value })}><option value="">Choose a Client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label>
                <label>New Issue title<input required value={newIssue.title} onChange={(event) => setNewIssue({ ...newIssue, title: event.target.value })} /></label>
              </div>
              <div><button className="btn sm" type="submit">Create and use Issue</button></div>
            </form>
          </div>
          {selectedIssue?.client_archived && <p className="notice">Restore the Client before drafting a new Appeal. Historical Issues and Appeals remain available in Issues &amp; Appeals.</p>}
        </section>

        {savedAppeal && <DocumentList clientId={savedAppeal.client_id} targetType="appeal" targetId={savedAppeal.id} />}

        <div className="ap-grid">
          <div className="ap-inputs">
            <section className="card workspace-section workspace-inline-form">
              <div className="between"><h2>Denial letter</h2><button type="button" className="btn sm" onClick={() => setDenialText(SAMPLE)}>Use sample</button></div>
              <textarea className="ec-doc ap-denial" value={denialText} onChange={(e) => setDenialText(e.target.value)} placeholder="Paste the denial letter text…" aria-label="Denial letter" />
              <label>Additional context <span className="workspace-small">optional</span>
                <textarea rows={5} value={context} maxLength={contextLimit} onChange={(e) => setContext(e.target.value.slice(0, contextLimit))} placeholder="Add referring physician notes, symptom history, or prior failed treatments." />
              </label>
              {error && <p role="alert" className="workspace-error">{error}</p>}
              <div className="ws-submit">
                <button className="btn accent lg" onClick={run} disabled={running || !denialText.trim()}>
                  <PencilSimpleLine size={16} weight="duotone" /> {running ? 'Drafting…' : 'Analyze & draft'}
                </button>
              </div>
            </section>
          </div>

          <div className="ap-output">
            {!result && !running && (
              <div className="card ap-empty">
                <FileText size={40} weight="duotone" aria-hidden="true" />
                <strong>The appeal appears here</strong>
                <p>The denial analysis, CMS grounds for the denial code, and a drafted letter appear once you run the analysis. The draft is saved to the Issue.</p>
              </div>
            )}

            {running && <RunSteps steps={flow.steps()} running={running} title="Drafting the appeal" />}

            <ToolResults show={Boolean(result) && !running}>
              {result && <>
                <section className="card workspace-section">
                  <div className="between"><h2><ClipboardText size={19} weight="duotone" aria-hidden="true" className="ap-h-ic" /> Denial analysis</h2>{savedAppeal && <span className="chip pos"><CheckCircle size={12} weight="bold" /> Saved to the Issue</span>}</div>
                  <dl className="ap-kv">
                    <div><dt>Reason code</dt><dd>{result.denial_analysis.denial_reason_code || 'Unknown'}</dd></div>
                    <div><dt>Treatment denied</dt><dd>{result.denial_analysis.treatment_denied}</dd></div>
                    <div className="ap-deadline"><dt>Appeal deadline</dt><dd>{result.denial_analysis.appeal_deadline || '—'}</dd></div>
                    <div><dt>Policy cited</dt><dd>{result.denial_analysis.policy_section_cited || '—'}</dd></div>
                    <div><dt>Denial date</dt><dd>{result.denial_analysis.denial_date || '—'}</dd></div>
                  </dl>
                  <div className="ap-reason"><small>Stated reason</small><p>{result.denial_analysis.denial_reason}</p></div>
                </section>

                <section className="card workspace-section">
                  <h2><Scales size={19} weight="duotone" aria-hidden="true" className="ap-h-ic" /> Coverage grounds</h2>
                  <div className="ap-rule"><small>CMS guidance for this denial code</small><p>{result.coverage_argument.cms_rule}</p></div>
                  {result.coverage_argument.common_appeal_grounds?.length > 0 && (
                    <div className="ap-grounds">
                      <small>Appeal grounds</small>
                      <ul>{result.coverage_argument.common_appeal_grounds.map((g, i) => <li key={i}><CheckCircle size={15} weight="duotone" aria-hidden="true" />{g}</li>)}</ul>
                    </div>
                  )}
                  {result.coverage_argument.success_precedents?.length > 0 && (
                    <div className="ap-grounds"><small>Success precedents</small><div className="ws-chips">{result.coverage_argument.success_precedents.map((p, i) => <Chip key={i} tone="accent">{p}</Chip>)}</div></div>
                  )}
                </section>

                <section className="card workspace-section">
                  <div className="between"><h2><FileText size={19} weight="duotone" aria-hidden="true" className="ap-h-ic" /> Drafted appeal letter</h2><button className="btn sm" onClick={copyLetter}><CopySimple size={14} weight="duotone" /> {copied ? 'Copied' : 'Copy'}</button></div>
                  <div className="ap-letter"><AgentMarkdown>{result.appeal_letter}</AgentMarkdown></div>
                  <SourceRow items={flow.sources} />
                  <SaveToolOutput source="draft_appeal" text={result.appeal_letter} fixedClientId={result.client_id} />
                </section>

                {result.disclaimer && <p className="ws-note">{result.disclaimer}</p>}
              </>}
            </ToolResults>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
