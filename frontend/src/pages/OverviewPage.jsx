import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import TopBar from '../components/TopBar';
import Icon from '../components/ui/Icon';
import Chip from '../components/ui/Chip';
import Avatar from '../components/ui/Avatar';
import Sparkline from '../components/ui/Sparkline';
import useLayout from '../components/ui/useLayout';

function formatDate(d = new Date()) {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function sinceLabel(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.max(0, Math.floor(diff / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Presents the broker's workspace overview, active clients, and recent work. */
export default function OverviewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openMenu, openNotifications } = useLayout();

  const [clients, setClients] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/clients').catch(() => []),
      api.get('/history?limit=8').catch(() => []),
    ]).then(([c, h]) => {
      setClients(Array.isArray(c) ? c : []);
      setHistory(Array.isArray(h) ? h : []);
      setLoading(false);
    });
  }, []);

  const firstName = (user?.email?.split('@')[0] || 'Broker').replace(/^./, (c) => c.toUpperCase());
  const total = clients.length;
  const totalRx = clients.reduce((s, c) => s + (c.prescriptions?.length || 0), 0);
  const totalProviders = clients.reduce((s, c) => s + (c.doctors?.length || 0), 0);
  const avgAge = total ? Math.round(clients.reduce((s, c) => s + (c.age || 0), 0) / total) : 0;

  const byIncome = clients.reduce((acc, c) => {
    const k = (c.income_level || 'unknown').toLowerCase();
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const lowIncome = byIncome.low || 0;
  // Recently updated clients
  const priority = [...clients]
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    .slice(0, 4);

  // Sparkline: synthesize from running total of client creation
  const sortedByCreate = [...clients].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const sparkData = [];
  sortedByCreate.forEach((_, i) => sparkData.push(i + 1));
  if (sparkData.length < 2) sparkData.push(sparkData[0] || 0);

  return (
    <>
      <TopBar
        crumbs={['Workspace', 'Overview']}
        onMenuClick={openMenu}
        onNotificationsClick={openNotifications}
        action={
          <button className="btn accent" onClick={() => navigate('/clients/new')}>
            <Icon name="plus" size={14} /> New client
          </button>
        }
      />
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>{formatDate()}</div>
            <h1 className="page-title">
              Good morning, {firstName}.<br />
              {total > 0 ? (
                <>{total} client{total === 1 ? '' : 's'} in your workspace.</>
              ) : (
                <>Your workspace is ready.</>
              )}
            </h1>
            <p className="page-sub">
              {total === 0
                ? 'Add your first client to start comparing plans and recording results.'
                : 'Review recently updated clients and completed activity.'}
            </p>
          </div>
          <div className="row">
            <button className="btn" onClick={() => navigate('/history')}>
              <Icon name="download" size={14} /> Activity log
            </button>
            <button className="btn primary" onClick={() => navigate('/compare')}>
              <Icon name="compare" size={14} /> Run comparison
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="card">
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Active clients</div>
              <div className="between" style={{ alignItems: 'flex-end' }}>
                <div className="value num">{loading ? '—' : total}</div>
                {total > 1 && <Sparkline data={sparkData} w={70} h={26} />}
              </div>
              <div className="delta">{totalProviders} providers, {totalRx} prescriptions</div>
            </div>
            <div className="stat">
              <div className="label">Avg. age</div>
              <div className="value num">{loading ? '—' : avgAge || '—'}</div>
              <div className="delta">across your book</div>
            </div>
            <div className="stat">
              <div className="label">Recorded activities</div>
              <div className="value num">{loading ? '—' : history.length}</div>
              <div className="delta">comparisons, appeals, and checks</div>
            </div>
            <div className="stat">
              <div className="label">Low-income clients</div>
              <div className="value num">{loading ? '—' : lowIncome}</div>
              <div className="delta">eligible for LIS / Extra Help review</div>
            </div>
          </div>
        </div>

        <div className="grid-12" style={{ marginTop: 32 }}>
          {/* Priority */}
          <div style={{ gridColumn: 'span 8' }}>
            <div className="section-head">
              <h2>Recently updated clients</h2>
              <div className="after">
                Sorted by latest update.{' '}
                <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => navigate('/clients')}>
                  View all clients
                </a>
              </div>
            </div>
            <div className="card">
              {loading && <div className="empty"><div className="loader" /></div>}
              {!loading && priority.length === 0 && (
                <div className="empty">
                  <div className="empty-title">No clients yet</div>
                  <div>Add your first client to begin tracking renewals and running comparisons.</div>
                  <div style={{ marginTop: 18 }}>
                    <button className="btn accent" onClick={() => navigate('/clients/new')}>
                      <Icon name="plus" size={14} /> Add client
                    </button>
                  </div>
                </div>
              )}
              {!loading && priority.map((c, i) => {
                const rxCount = c.prescriptions?.length || 0;
                const drCount = c.doctors?.length || 0;
                const chipTone = rxCount > 3 ? 'warn' : drCount > 2 ? 'accent' : 'pos';
                const chipLabel = rxCount > 3 ? 'Complex Rx' : drCount > 2 ? 'Multi-provider' : 'Active';
                return (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/clients/${c.id}`)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '44px 1fr auto auto',
                      gap: 16,
                      alignItems: 'center',
                      padding: '18px 24px',
                      borderBottom: i < priority.length - 1 ? '1px solid var(--line)' : 0,
                      cursor: 'pointer',
                    }}
                  >
                    <Avatar name={c.full_name} size="md" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.full_name}
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        ZIP {c.zip_code}, age {c.age}, {c.income_level} income, {rxCount} prescriptions, {drCount} providers
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="eyebrow">#{c.id.slice(0, 6)}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{sinceLabel(c.updated_at || c.created_at)}</div>
                    </div>
                    <Chip tone={chipTone}>{chipLabel}</Chip>
                  </div>
                );
              })}
            </div>

            <div className="section-head">
              <h2>Activity</h2>
              <div className="after">
                <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => navigate('/activity')}>
                  View activity
                </a>
              </div>
            </div>
            <div className="card card-pad">
              {loading && <div className="loader" />}
              {!loading && history.length === 0 && (
                <div className="muted" style={{ fontSize: 13, padding: 12 }}>
                  No actions yet. Run a plan comparison or verify a network to see activity here.
                </div>
              )}
              {!loading && history.length > 0 && (
                <div className="activity">
                  {history.slice(0, 6).map((a, i) => {
                    const tone = a.action_type === 'appeal' ? 'accent' : a.action_type === 'verify' ? 'warn' : a.action_type === 'compare' ? 'pos' : '';
                    return (
                      <div
                        key={a.id || i}
                        className="act-row"
                        onClick={() => a.client_id && navigate(`/clients/${a.client_id}`)}
                      >
                        <span className="act-time mono">{sinceLabel(a.created_at)}</span>
                        <Chip tone={tone}>{a.action_type}</Chip>
                        <div className="act-body">
                          <span className="who">{a.client_name || 'Unknown client'}</span><span className="muted what">. {a.action_type} completed</span>
                        </div>
                        <Icon name="chev_r" size={14} className="ink-4" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div style={{ gridColumn: 'span 4' }}>
            <div className="section-head">
              <h2>Client overview</h2>
              <div className="after">Income level</div>
            </div>
            <div className="card card-pad">
              {[
                { k: 'High income', v: byIncome.high || 0, tone: 'accent' },
                { k: 'Medium income', v: byIncome.medium || 0, tone: 'pos' },
                { k: 'Low income', v: byIncome.low || 0, tone: 'warn' },
              ].map((r) => (
                <div key={r.k} className="between" style={{ padding: '6px 0' }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span
                      className={`risk-dot ${r.tone === 'pos' ? 'low' : r.tone === 'warn' ? 'med' : ''}`}
                      style={r.tone === 'accent' ? { background: 'var(--accent)' } : {}}
                    />
                    <span>{r.k}</span>
                  </div>
                  <span className="num mono" style={{ fontSize: 13 }}>{r.v}</span>
                </div>
              ))}
            </div>

            <div className="section-head">
              <h2>Jump to a tool</h2>
              <div className="after">Tools</div>
            </div>
            <div className="card card-pad">
              {[
                { icon: 'compare', label: 'Plan comparison', path: '/compare' },
                { icon: 'translate', label: 'Coverage translator', path: '/translator' },
                { icon: 'calendar', label: 'Deadline planner', path: '/plan' },
                { icon: 'network', label: 'Network check', path: '/network' },
                { icon: 'calculator', label: 'Cost calculator', path: '/calculator' },
                { icon: 'appeal', label: 'Claim appeal', path: '/appeals' },
              ].map((t, i, a) => (
                <div
                  key={t.path}
                  onClick={() => navigate(t.path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 0',
                    borderBottom: i < a.length - 1 ? '1px dashed var(--line)' : 0,
                    cursor: 'pointer',
                  }}
                >
                  <Icon name={t.icon} size={16} className="ink-4" />
                  <span style={{ fontSize: 13.5, flex: 1 }}>{t.label}</span>
                  <Icon name="chev_r" size={13} className="ink-4" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
