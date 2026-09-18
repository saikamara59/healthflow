import Icon from './ui/Icon';
import { ThemeToggle } from './ui/Tweaks';
import useLayout from './ui/useLayout';

export default function TopBar({ crumbs = ['Overview'], action, onMenuClick, onNotificationsClick }) {
  const { openSearch } = useLayout();
  return (
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
          <Icon name="search" size={14} />
          <span>Search workspace</span>
          <span className="kbd">⌘K</span>
        </button>
        <button className="btn icon ghost" onClick={onNotificationsClick} title="Notifications" aria-label="Notifications">
          <Icon name="bell" size={16} />
        </button>
        {action}
        <ThemeToggle />
      </div>
    </header>
  );
}
