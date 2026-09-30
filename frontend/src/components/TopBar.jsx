import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, CaretDown, MagnifyingGlass, UserFocus } from '@phosphor-icons/react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Icon from './ui/Icon';
import HfTile from './ui/HfTile';
import { ThemeToggle } from './ui/Tweaks';
import useLayout from './ui/useLayout';

const QUICK_ACTIONS = [
  { path: '/compare', label: 'Compare Plans', icon: 'compare' },
  { path: '/ask', label: 'Ask HealthFlow', icon: 'ask' },
  { path: '/translator', label: 'Explain Coverage', icon: 'explain' },
];

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');

// Workspace identity block. Display only until teams and agencies exist.
function TeamBlock() {
  const { user } = useAuth();
  const [name, setName] = useState('');
  useEffect(() => {
    let alive = true;
    api.get('/auth/profile').then((profile) => { if (alive) setName(profile?.full_name || ''); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const display = name || user?.email?.split('@')[0] || 'Broker';
  return (
    <div className="tm-trigger" aria-label="Workspace">
      <span className="tm-org" aria-hidden="true">{initials(display)}</span>
      <span className="tm-copy"><strong>My workspace</strong><small>{user?.role === 'admin' ? 'Owner' : 'Broker'}</small></span>
      <CaretDown size={14} weight="bold" aria-hidden="true" />
    </div>
  );
}

// "Working with" client picker. Display only: choosing a client does not change anything yet.
function WorkingWith() {
  const [clients, setClients] = useState([]);
  const [value, setValue] = useState('');
  useEffect(() => {
    let alive = true;
    api.get('/clients').then((rows) => { if (alive && Array.isArray(rows)) setClients(rows); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return (
    <div className={`ww${value ? ' on' : ''}`}>
      <UserFocus weight="duotone" size={16} aria-hidden="true" />
      <label className="ww-label" htmlFor="ww-sel">Working with</label>
      <select id="ww-sel" value={value} onChange={(event) => setValue(event.target.value)}>
        <option value="">No client selected</option>
        {clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}
      </select>
    </div>
  );
}

export default function TopBar({ crumbs = ['Overview'], action, onMenuClick, onNotificationsClick }) {
  const { openSearch } = useLayout();
  const { pathname } = useLocation();
  return (
    <>
      <header className="topbar">
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <button className="menu-btn" onClick={onMenuClick} aria-label="Open menu">
            <Icon name="menu" size={18} />
          </button>
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {i > 0 && <span className="sep">/</span>}
                <span className={i === crumbs.length - 1 ? 'here' : ''}>{c}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="topbar-actions">
          <button className="search workspace-search-trigger" type="button" data-workspace-search-trigger aria-label="Search workspace" onClick={openSearch}>
            <MagnifyingGlass weight="duotone" size={14} />
            <span>Search workspace</span>
            <span className="kbd">⌘K</span>
          </button>
          {action}
          <button className="btn icon ghost" onClick={onNotificationsClick} title="Notifications" aria-label="Notifications">
            <Bell weight="duotone" size={18} />
          </button>
          <ThemeToggle />
          <span className="tm-divider" aria-hidden="true" />
          <TeamBlock />
        </div>
      </header>

      <div className="qa-strip">
        <div className="qa-actions" role="toolbar" aria-label="Quick actions">
          {QUICK_ACTIONS.filter((item) => item.path !== pathname).map((item) => (
            <Link key={item.path} className="qa-btn" to={item.path}><HfTile icon={item.icon} />{item.label}</Link>
          ))}
        </div>
        <WorkingWith />
      </div>
    </>
  );
}
