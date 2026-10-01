import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ArrowCounterClockwise, PaperPlaneRight } from '@phosphor-icons/react';
import api from '../api/client';
import TopBar from '../components/TopBar';
import AgentMarkdown from '../components/ui/AgentMarkdown';
import PageHead from '../components/ui/PageHead';
import useLayout from '../components/ui/useLayout';
import { RunStepsCompact, SourceRow } from '../components/tools/ToolRun';
import { TOOL_FLOWS } from '../components/tools/toolFlows';

const SAMPLE_DOC = `SUMMARY OF BENEFITS: PRIME HMO
Member Responsibility:
  $0 Individual Deductible (In-Network)
  $5,900 Annual Out-of-Pocket Maximum

Professional Services:
  Primary Care Visit: $0 copay
  Specialist Visit: $35 copay (referral required)
  Urgent Care: $45 copay
  Emergency Room: $120 (waived if admitted)

Prescription Drugs:
  Tier 1 Preferred Generic: $0
  Tier 2 Generic: $8
  Tier 3 Preferred Brand: $40
  Tier 4 Non-Preferred Brand: $95
  Tier 5 Specialty: 33% coinsurance`;

const SUGGESTED = [
  'What is the ER copay if admitted?',
  'Does specialist care need a referral?',
  'When does the OOP maximum reset?',
  'How are Tier 5 specialty drugs covered?',
];

/** Converts plan-document content into plain-language coverage explanations. */
export default function CoverageTranslatorPage() {
  const { openMenu, openNotifications } = useLayout();
  const [doc, setDoc] = useState(SAMPLE_DOC);
  const [q, setQ] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const threadEnd = useRef(null);
  const flow = TOOL_FLOWS.explain;

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length, busy]);

  async function ask(text) {
    if (!text.trim() || !doc.trim() || busy) return;
    const question = text.trim();
    setQ('');
    setMessages((prev) => [...prev, { role: 'user', body: question }]);
    setBusy(true);
    try {
      const res = await api.post('/translate', { document_text: doc, question });
      setMessages((prev) => [...prev, { role: 'agent', body: res.answer, cites: res.relevant_sections || [] }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'agent', body: `The answer could not be generated: ${err.message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const answered = messages.filter((m) => m.role === 'agent' && !m.error).length;

  return (
    <MotionConfig reducedMotion="user">
      <TopBar crumbs={['AI Tools', 'Explain Coverage']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
      <div className="page wide ws-page-in">
        <PageHead
          icon="explain"
          eyebrow="Plain-language answers with citations"
          title="Explain coverage"
          sub="Paste a Summary of Benefits and ask a question. Each answer points back to the section it came from."
        />

        <div className="phase2-grid ec-grid">
          <section className="card workspace-section workspace-inline-form">
            <div className="between"><h2>Document</h2><button type="button" className="btn sm ghost" onClick={() => setDoc(SAMPLE_DOC)}><ArrowCounterClockwise size={14} weight="duotone" /> Reset to sample</button></div>
            <label>Summary of Benefits text
              <textarea className="ec-doc" rows={18} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Paste a Summary of Benefits here…" />
            </label>
          </section>

          <section className="card workspace-section ec-chat">
            <div className="between"><h2>Questions</h2>{answered > 0 && <span className="workspace-small">{answered} answer{answered === 1 ? '' : 's'}</span>}</div>
            {messages.length === 0 && !busy && <p className="workspace-empty">Ask about copays, drug tiers, referrals, or the out-of-pocket maximum.</p>}
            <div className="ec-thread">
              <AnimatePresence initial={false}>
                {messages.map((m, i) => (
                  <motion.div key={i} className={`ec-msg ${m.role === 'user' ? 'you' : 'tool'}${m.error ? ' error' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                    <small>{m.role === 'user' ? 'You asked' : 'Explain Coverage'}</small>
                    {m.role === 'agent' ? <AgentMarkdown>{m.body}</AgentMarkdown> : <p>{m.body}</p>}
                    {m.cites?.length > 0 && <SourceRow lead="Cited" items={m.cites.map((section) => ['Summary of Benefits', section])} />}
                  </motion.div>
                ))}
              </AnimatePresence>
              {busy && <div className="ec-msg tool"><small>Explain Coverage</small><RunStepsCompact steps={flow.steps()} /></div>}
              <div ref={threadEnd} />
            </div>
            <form className="ec-ask" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this plan" aria-label="Question" disabled={busy} />
              <button className="btn accent" disabled={!q.trim() || busy} aria-label="Ask"><PaperPlaneRight size={15} weight="duotone" /> Ask</button>
            </form>
            <div className="ws-chips ec-suggest">
              {SUGGESTED.map((s) => <button key={s} type="button" className="btn sm" onClick={() => ask(s)} disabled={busy}>{s}</button>)}
            </div>
            {answered > 0 && <SourceRow items={flow.sources} />}
          </section>
        </div>
      </div>
    </MotionConfig>
  );
}
