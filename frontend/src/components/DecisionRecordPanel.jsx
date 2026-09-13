import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import Icon from './ui/Icon';
import Stars from './ui/Stars';
import AgentMarkdown from './ui/AgentMarkdown';

// "Why this recommendation" decision record drawer.
// Reads GET /decisions/{decisionId} (captured at /compare time) and renders it
// with its inputs, source details, and recorded activity.

function currency(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return `$${Math.round(v).toLocaleString()}`;
}

// Same estimate the comparison page shows, so the "ranked against" costs match.
function annualEstimate(plan) {
  const premium = (plan.monthly_premium || 0) * 12;
  const rxTotal = Object.values(plan.estimated_medication_costs || {}).reduce((s, v) => s + v, 0);
  const procTotal = Object.values(plan.estimated_procedure_costs || {}).reduce((s, v) => s + v, 0);
  return premium + rxTotal + procTotal + (plan.annual_deductible || 0) * 0.3;
}

function formatRecordedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function KV({ k, v }) {
  return (
    <div className="why-kv">
      <span className="why-kv-k">{k}</span>
      <span className="why-kv-v">{v}</span>
    </div>
  );
}

const RANKED_LIMIT = 5;

export default function DecisionRecordPanel({ decisionId, open, onClose, recordedBy }) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!decisionId) return;
    setLoading(true);
    setError('');
    api.get(`/decisions/${decisionId}`)
      .then((d) => setRecord(d))
      .catch((e) => setError(e.message || 'Could not load the decision record.'))
      .finally(() => setLoading(false));
  }, [decisionId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const plan = record?.recommended_plan || {};
  const inputs = record?.inputs || {};
  const alternatives = record?.alternatives || [];
  const ranked = alternatives.map((p) => ({
    name: p.plan_name || 'Plan',
    cost: annualEstimate(p),
  }));
  const shown = ranked.slice(0, RANKED_LIMIT);
  const more = Math.max(0, ranked.length - shown.length);
  const shortId = record ? `${String(record.id).slice(0, 7)}…` : '';

  const inputRows = record
    ? [
        { k: 'ZIP code', v: inputs.zip_code || '—' },
        { k: 'Age', v: inputs.age != null ? String(inputs.age) : '—' },
        { k: 'Income', v: cap(inputs.income_level) || '—' },
        { k: 'Medications', v: inputs.medications?.length ? inputs.medications.join(', ') : 'None' },
        { k: 'Procedures', v: inputs.procedures?.length ? inputs.procedures.join(', ') : 'None' },
      ]
    : [];

  const tree = (
    <div className="why-root">
      <div className="why-backdrop" onClick={onClose} />
      <aside className="why-drawer" role="dialog" aria-label="Why this recommendation" aria-modal="true">
        <header className="why-head">
          <div className="why-head-top">
            <div>
              <div className="eyebrow">Recommendation record</div>
              <h2 className="why-title">Why this recommendation</h2>
            </div>
            <button className="why-close" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
          {record && (
            <div className="why-head-meta">
              <span className="why-chip"><span className="why-chip-label">REC</span> {shortId}</span>
              <span className="why-rec-time">Recorded {formatRecordedAt(record.created_at)}</span>
            </div>
          )}
        </header>

        {loading && (
          <div className="why-body">
            <div className="why-state"><span className="why-spinner" />Loading the decision record…</div>
          </div>
        )}

        {!loading && error && (
          <div className="why-body">
            <div className="why-state">
              <Icon name="alert" size={22} />
              <span>{error}</span>
              <button className="btn sm" onClick={load}>Retry</button>
            </div>
          </div>
        )}

        {!loading && !error && record && (
          <>
            <div className="why-body">
              {/* Recommended plan */}
              <div className="why-plan">
                <div className="why-plan-head">
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 6 }}>Recommended plan</div>
                    <div className="why-plan-name">{plan.plan_name || '—'}</div>
                  </div>
                  {plan.star_rating != null && (
                    <div className="why-rating">
                      <Stars value={plan.star_rating} />
                      <span className="why-rating-num mono">{plan.star_rating.toFixed(1)}</span>
                    </div>
                  )}
                </div>
                <div className="why-metrics">
                  <div className="why-metric">
                    <span className="why-metric-v mono">{currency(plan.monthly_premium)}</span>
                    <span className="why-metric-k">Premium / mo</span>
                  </div>
                  <div className="why-metric">
                    <span className="why-metric-v mono">{currency(plan.annual_deductible)}</span>
                    <span className="why-metric-k">Deductible</span>
                  </div>
                  <div className="why-metric">
                    <span className="why-metric-v mono">{currency(plan.out_of_pocket_max)}</span>
                    <span className="why-metric-k">Out-of-pocket max</span>
                  </div>
                </div>
              </div>

              {/* Basis */}
              {record.basis && (
                <div className="why-basis">
                  <Icon name="check" size={15} className="why-basis-ic" />
                  <span>{record.basis}</span>
                </div>
              )}

              {/* Inputs used */}
              <section className="why-section">
                <div className="why-section-head">
                  <span className="eyebrow">Inputs used</span>
                  <span className="why-section-note">client profile at time of run</span>
                </div>
                <div className="why-kv-grid">
                  {inputRows.map((it) => <KV key={it.k} k={it.k} v={it.v} />)}
                </div>
              </section>

              {/* Ranked against */}
              {ranked.length > 0 && (
                <section className="why-section">
                  <div className="why-section-head">
                    <span className="eyebrow">Ranked against</span>
                    <span className="why-section-note">{ranked.length} alternative{ranked.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="why-ranked">
                    {shown.map((p, i) => (
                      <div className="why-rank-row" key={`${p.name}-${i}`}>
                        <span className="why-rank-idx mono">{String(i + 2).padStart(2, '0')}</span>
                        <span className="why-rank-name">{p.name}</span>
                        <span className="why-rank-cost mono">{currency(p.cost)}/yr</span>
                      </div>
                    ))}
                    {more > 0 && <div className="why-rank-more">+{more} more plan{more === 1 ? '' : 's'} compared</div>}
                  </div>
                </section>
              )}

              {/* Reasoning */}
              {record.recommendation_text && (
                <section className="why-section">
                  <div className="why-section-head"><span className="eyebrow">Recommendation</span></div>
                  <AgentMarkdown>{record.recommendation_text}</AgentMarkdown>
                </section>
              )}
            </div>

            {/* Record details */}
            <footer className="why-foot">
              <div className="why-foot-seal">
                <Icon name="appeal" size={15} />
                <span>Saved to the decision record</span>
              </div>
              <div className="why-foot-grid">
                <div className="why-foot-kv"><span className="why-foot-k">Tool</span><span className="why-foot-v mono">{record.agent_type}</span></div>
                <div className="why-foot-kv"><span className="why-foot-k">Model</span><span className="why-foot-v mono">{record.model_used || '—'}</span></div>
                <div className="why-foot-kv"><span className="why-foot-k">Recorded by</span><span className="why-foot-v">{recordedBy || 'You'}</span></div>
              </div>
              <div className="why-foot-id">
                <span className="why-foot-k">Record ID</span>
                <span className="why-foot-id-v mono">{record.id}</span>
              </div>
            </footer>
          </>
        )}
      </aside>
    </div>
  );

  return createPortal(tree, document.body);
}
