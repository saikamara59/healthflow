import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { SignOut } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import BrandLogo from './ui/BrandLogo';
import HfTile from './ui/HfTile';

const NAV = [
  {
    group: 'Daily',
    items: [
      { path: '/today', label: 'Today', icon: 'today', end: true },
      { path: '/approvals', label: 'Approvals', icon: 'approve' },
      { path: '/overview', label: 'Overview', icon: 'overview' },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { path: '/clients', label: 'Clients', icon: 'clients', countKey: 'clients' },
      { path: '/organizations', label: 'Organizations', icon: 'orgs' },
      { path: '/enrollments', label: 'Enrollments', icon: 'enroll' },
      { path: '/issues', label: 'Issues & Appeals', icon: 'issues' },
      { path: '/documents', label: 'Documents', icon: 'docs' },
      { path: '/follow-ups', label: 'Follow-ups', icon: 'follow' },
      { path: '/scheduling', label: 'Scheduling', icon: 'cal' },
    ],
  },
  {
    group: 'AI Tools',
    items: [
      { path: '/ask', label: 'Ask HealthFlow', icon: 'ask' },
      { path: '/compare', label: 'Compare Plans', icon: 'compare' },
      { path: '/calculator', label: 'Estimate Costs', icon: 'cost' },
      { path: '/network', label: 'Check Network', icon: 'network' },
      { path: '/translator', label: 'Explain Coverage', icon: 'explain' },
      { path: '/appeals', label: 'Draft Appeal', icon: 'appeal' },
    ],
  },
  {
    group: 'Account',
    items: [
      { path: '/activity', label: 'Activity', icon: 'history' },
      { path: '/history', label: 'Tool history', icon: 'today' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { path: '/admin', label: 'Team', icon: 'team' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { path: '/connectors', label: 'Connectors', icon: 'connect' },
    ],
  },
];

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');

/** Renders the primary workspace navigation and its responsive drawer state. */
export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const [profileName, setProfileName] = useState('');
  const [counts, setCounts] = useState({});
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/clients').catch(() => []),
      api.get('/auth/profile').catch(() => null),
    ]).then(([clients, profile]) => {
      if (!alive) return;
      setCounts({ clients: Array.isArray(clients) ? clients.length : 0 });
      setProfileName(profile?.full_name || '');
    });
    return () => { alive = false; };
  }, []);

  const emailName = user?.email?.split('@')[0] || 'Broker';
  const display = profileName || emailName.charAt(0).toUpperCase() + emailName.slice(1);

  return (
    <>
      <div className={`side-backdrop ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand">
          <BrandLogo size={28} />
          <span className="side-wordmark">Health<span>Flow</span></span>
        </div>

        {/* Scrollable nav region so the bottom user-chip (with Sign out) stays
            in the viewport even when nav groups exceed 100vh. */}
        <nav aria-label="Primary" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {NAV.map((group) => (
            <div key={group.group} className="nav-group">
              <div className="nav-group-label">{group.group}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  onClick={onClose}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <HfTile icon={item.icon} />
                  <span>{item.label}</span>
                  {item.countKey && counts[item.countKey] != null && (
                    <span className="nav-count">{counts[item.countKey]}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="bottom">
          <div className="user-chip">
            <span className="avatar hf-avatar" aria-hidden="true">{initials(display)}</span>
            <div className="hf-user">
              <strong>{display}</strong>
              <small>{user?.role === 'admin' ? 'Admin' : 'Broker'}</small>
            </div>
            <button className="btn icon ghost sm hf-logout" onClick={logout} title="Sign out" aria-label="Sign out">
              <SignOut weight="duotone" size={18} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
