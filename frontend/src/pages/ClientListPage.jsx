import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import TopBar from '../components/TopBar';
import {
  ArrowDown, ArrowUp, CaretRight, ClockCounterClockwise, DownloadSimple, MagnifyingGlass, Plus,
} from '@phosphor-icons/react';
import Chip from '../components/ui/Chip';
import Avatar from '../components/ui/Avatar';
import PageHead from '../components/ui/PageHead';
import useLayout from '../components/ui/useLayout';

function sinceLabel(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.max(0, Math.floor(diff / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function riskLevel(client) {
  const rx = client.prescriptions?.length || 0;
  const dr = client.doctors?.length || 0;
  const score = rx + dr * 0.5 + (client.age > 70 ? 2 : 0);
  if (score >= 6) return 'high';
  if (score >= 3) return 'med';
  return 'low';
}

// Translate the client's profile into a concrete next-step recommendation so
// brokers can act from the list without opening every profile.
function nextAction(c) {
  const rx = c.prescriptions?.length || 0;
  const age = c.age || 0;
  if (age >= 70 && rx >= 3) {
    return { label: 'Review formulary', tone: 'warn' };
  }
  if (age >= 65) {
    return { label: 'Renewal window', tone: '' };
  }
  if (age >= 60 && age < 65) {
    return { label: 'Aging into Medicare', tone: 'accent' };
  }
  if (rx === 0 && (c.doctors?.length || 0) === 0) {
    return { label: 'Complete profile', tone: 'warn' };
  }
  return { label: 'No action', tone: 'ghost' };
}

function toCsv(rows) {
  const headers = ['id', 'name', 'zip', 'age', 'income', 'rx_count', 'provider_count', 'last_touch'];
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const c of rows) {
    lines.push([
      c.id,
      c.full_name,
      c.zip_code,
      c.age,
      c.income_level,
      c.prescriptions?.length || 0,
      c.doctors?.length || 0,
      c.updated_at || c.created_at || '',
    ].map(escape).join(','));
  }
  return lines.join('\n');
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const touchTime = (c) => new Date(c.updated_at || c.created_at || 0).getTime();
const RISK_LABEL = { high: 'High', med: 'Med', low: 'Low' };

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'action', label: 'Needs action', test: (c) => nextAction(c).tone !== 'ghost' },
  { key: 'senior', label: 'Age 65+', test: (c) => (c.age || 0) >= 65 },
  { key: 'complex', label: 'Complex Rx', test: (c) => (c.prescriptions?.length || 0) >= 3 },
  { key: 'high', label: 'High income', test: (c) => c.income_level === 'high' },
  { key: 'medium', label: 'Medium', test: (c) => c.income_level === 'medium' },
  { key: 'low', label: 'Low income', test: (c) => c.income_level === 'low' },
];

/** Displays searchable client records and the actions available for each client. */
export default function ClientListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const archived = new URLSearchParams(location.search).get('archived') === 'true';
  const { openMenu, openNotifications } = useLayout();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [dir, setDir] = useState('desc');
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    let current = true;
    setLoading(true);
    setSelected(new Set());
    setFilter('all');
    api.get(archived ? '/clients?archived=true' : '/clients')
      .then((d) => { if (current) setClients(Array.isArray(d) ? d : []); })
      .catch(() => { if (current) setClients([]); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [archived]);


  const filtered = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)?.test || (() => true);
    const q = query.trim().toLowerCase();
    return clients
      .filter(test)
      .filter((c) => !q || c.full_name?.toLowerCase().includes(q) || c.zip_code?.includes(q) || c.id?.toLowerCase().includes(q))
      .sort((a, b) => (touchTime(a) - touchTime(b)) * (dir === 'asc' ? 1 : -1));
  }, [clients, query, filter, dir]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allOn = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const someOn = !allOn && filtered.some((c) => selected.has(c.id));
  const selectAll = () => setSelected(allOn ? new Set() : new Set(filtered.map((c) => c.id)));
  const clearSelection = () => setSelected(new Set());

  const selectedClients = filtered.filter((c) => selected.has(c.id));
  const exportSelected = () => {
    const rows = selectedClients.length ? selectedClients : filtered;
    downloadCsv(`healthflow-clients-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  };
  const compareSelected = () => {
    if (selectedClients.length === 1) {
      navigate(`/clients/${selectedClients[0].id}`);
    } else {
      navigate('/compare');
    }
  };

  return (
    <>
      <TopBar
        crumbs={['Workspace', 'Clients']}
        onMenuClick={openMenu}
        onNotificationsClick={openNotifications}
        action={
          !archived && <button className="btn accent" onClick={() => navigate('/clients/new')}>
            <Plus size={15} weight="bold" /> Add client
          </button>
        }
      />
      <div className="page wide ws-page-in">
        <PageHead
          icon="clients"
          eyebrow={`${clients.length} ${archived ? 'archived' : 'active'} clients`}
          title="Clients"
          sub="Sorted by most recent touch. Click a row to open the profile, or select rows to act in bulk."
          actions={<button className="btn" onClick={exportSelected}><DownloadSimple size={15} weight="duotone" /> Export CSV</button>}
        />

        <nav className="ws-tabs" aria-label="Client status">
          <Link to="/clients" aria-current={!archived ? 'page' : undefined}>Active clients</Link>
          <Link to="/clients?archived=true" aria-current={archived ? 'page' : undefined}>Archived clients</Link>
        </nav>

        <div className="ws-toolbar">
          <div className="ws-pills" role="tablist" aria-label="Filter clients">
            {!archived && FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                className={`ws-pill ${filter === f.key ? 'on' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}<span>{clients.filter(f.test).length}</span>
              </button>
            ))}
          </div>
          <label className="search ws-search">
            <MagnifyingGlass size={14} weight="duotone" />
            <input placeholder="Search name, ZIP, or ID" aria-label="Search clients" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>

        {selected.size > 0 && (
          <div className="ws-bulk">
            <strong>{selected.size} selected</strong>
            <div className="quick-create-actions">
              <button className="btn sm" onClick={compareSelected}>{selected.size === 1 ? 'Open profile' : 'Compare plans'}</button>
              <button className="btn sm" onClick={exportSelected}>Export {selected.size}</button>
              <button className="btn sm ghost" onClick={clearSelection}>Clear</button>
            </div>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="cl-bar">
            <label className="cl-all">
              <input
                type="checkbox"
                aria-label="Select all clients"
                checked={allOn}
                ref={(el) => { if (el) el.indeterminate = someOn; }}
                onChange={selectAll}
              />
              Select all
            </label>
            <button className="ws-sort" onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))} aria-label={`Sort by last touch, ${dir === 'desc' ? 'newest' : 'oldest'} first`}>
              Last touch {dir === 'desc' ? <ArrowDown size={12} weight="bold" /> : <ArrowUp size={12} weight="bold" />}
            </button>
          </div>
        )}

        {loading && <div className="card cl-empty"><div className="loader" /></div>}

        {!loading && filtered.length === 0 && (
          <div className="card cl-empty">
            <div className="empty-title">
              {clients.length === 0 ? (archived ? 'No archived clients' : 'No clients yet') : 'No clients match this view.'}
            </div>
            <div>
              {clients.length === 0
                ? (archived ? 'Clients you archive will appear here for history and restoration.' : 'Add your first client to start tracking renewals and running comparisons.')
                : 'Try clearing the filter or searching a different name.'}
            </div>
            {clients.length === 0 && !archived && (
              <div style={{ marginTop: 18 }}>
                <button className="btn accent" onClick={() => navigate('/clients/new')}>
                  <Plus size={15} weight="bold" /> Add client
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <ul className="cl-list">
            {filtered.map((c) => {
              const risk = riskLevel(c);
              const na = nextAction(c);
              const isSel = selected.has(c.id);
              const rx = c.prescriptions?.length || 0;
              const dr = c.doctors?.length || 0;
              return (
                <li
                  key={c.id}
                  data-testid="client-row"
                  className={`card cl-card ${isSel ? 'on' : ''}`}
                  onClick={() => navigate(`/clients/${c.id}`)}
                >
                  <input
                    type="checkbox"
                    className="cl-cb"
                    aria-label={`Select ${c.full_name}`}
                    checked={isSel}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelect(c.id)}
                  />
                  <div className="cl-who">
                    <Avatar name={c.full_name} size="md" />
                    <div><strong>{c.full_name}</strong><small className="mono">#{c.id.slice(0, 8)}</small></div>
                  </div>
                  <div className="cl-fields">
                    <div className="cl-f"><small>ZIP and age</small><span><span className="mono">{c.zip_code || '—'}</span> · Age {c.age ?? '—'}</span></div>
                    <div className="cl-f"><small>Income</small>{c.income_level ? <Chip tone={c.income_level === 'low' ? 'warn' : 'pos'}>{c.income_level}</Chip> : <span className="muted">—</span>}</div>
                    <div className="cl-f"><small>Risk</small><span className={`cl-risk ${risk}`}>{RISK_LABEL[risk]}</span></div>
                    <div className="cl-f"><small>Rx / Providers</small><span>{rx} Rx, {dr} doctor{dr === 1 ? '' : 's'}</span></div>
                    <div className="cl-f"><small>Next action</small>{na.tone === 'ghost' ? <span className="muted">None</span> : <Chip tone={na.tone}>{na.label}</Chip>}</div>
                    <div className="cl-f"><small>Last touch</small><span>{sinceLabel(c.updated_at || c.created_at)}</span></div>
                  </div>
                  <div className="cl-act" onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost icon sm" onClick={() => navigate('/plan')} title="Plan timeline" aria-label={`Plan timeline for ${c.full_name}`}>
                      <ClockCounterClockwise size={16} weight="duotone" />
                    </button>
                    <button className="btn ghost icon sm" onClick={() => navigate(`/clients/${c.id}`)} title="Open profile" aria-label={`Open ${c.full_name}`}>
                      <CaretRight size={16} weight="bold" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && clients.length > 0 && <div className="cl-count">Showing {filtered.length} of {clients.length}</div>}
      </div>
    </>
  );
}
