import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { workspaceApi } from '../api/workspace';
import TopBar from '../components/TopBar';
import Icon from '../components/ui/Icon';
import Chip from '../components/ui/Chip';
import useLayout from '../components/ui/useLayout';

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

function groupByDay(items) {
  const groups = {};
  items.forEach((a) => {
    const date = new Date(a.created_at);
    const key = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    (groups[key] = groups[key] || []).push(a);
  });
  return groups;
}

/** Lists completed workspace activity grouped by the day it was recorded. */
export default function ActivityPage() {
  const navigate = useNavigate();
  const { openMenu, openNotifications } = useLayout();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([api.get('/history?limit=200'), workspaceApi.listActivity()])
      .then(([tools, workspace]) => {
        const toolEntries = tools.status === 'fulfilled' && Array.isArray(tools.value) ? tools.value : [];
        const workspaceEntries = workspace.status === 'fulfilled' && Array.isArray(workspace.value) ? workspace.value : [];
        setHistory([
          ...toolEntries.map((entry) => ({ ...entry, kind: 'Tool' })),
          ...workspaceEntries.map((entry) => ({ ...entry, kind: 'Workspace', action_type: entry.action })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      })
      .finally(() => setLoading(false));
  }, []);

  const grouped = groupByDay(history);
  const dayKeys = Object.keys(grouped);

  return (
    <>
      <TopBar crumbs={['Workspace', 'Activity']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>{history.length} recorded activities</div>
            <h1 className="page-title"><em>Activity</em></h1>
            <p className="page-sub">
              Completed workspace work and tool activity, grouped by day.
            </p>
          </div>
        </div>

        {loading && <div className="empty"><div className="loader" /></div>}
        {!loading && history.length === 0 && (
          <div className="card card-pad">
            <div className="empty">
              <div className="empty-title">Nothing logged yet</div>
              <div>Complete a task, update an appointment, or run a tool to start a timeline.</div>
            </div>
          </div>
        )}

        {dayKeys.map((day) => (
          <div key={day} style={{ marginBottom: 28 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>{day}</div>
            <div className="card card-pad">
              <div className="activity">
                {grouped[day].map((a, i, arr) => (
                  <div
                    key={a.id || i}
                    className="act-row"
                    style={{ borderBottom: i < arr.length - 1 ? '1px dashed var(--line)' : 0, cursor: a.client_id ? 'pointer' : 'default' }}
                    onClick={() => a.client_id && navigate(`/clients/${a.client_id}`)}
                  >
                    <span className="act-time mono">{sinceLabel(a.created_at)}</span>
                    <Chip tone={a.action_type === 'appeal' ? 'accent' : a.action_type === 'verify' ? 'warn' : 'pos'}>
                      {a.kind === 'Workspace' ? a.action : a.action_type}
                    </Chip>
                    <div className="act-body">
                      <span className="who">{a.kind === 'Workspace' ? a.summary : a.client_name || 'Session'}</span>
                      {a.kind === 'Tool' && <span className="muted"> · {a.action_type.replace(/_/g, ' ')} completed</span>}
                    </div>
                    {a.client_id && <Icon name="chev_r" size={14} className="ink-4" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
