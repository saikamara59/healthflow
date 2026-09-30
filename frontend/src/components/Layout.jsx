import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import NotificationPanel from './NotificationPanel';
import WorkspaceSearch from './workspace/WorkspaceSearch';

export const LayoutContext = { sidebarOpen: false };

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback((restoreFocus = true) => {
    setSearchOpen(false);
    if (restoreFocus) requestAnimationFrame(() => document.querySelector('[data-workspace-search-trigger]')?.focus());
  }, []);
  useEffect(() => {
    const shortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  return (
    <div className="app">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main">
        <Outlet context={{
          openMenu: () => setSidebarOpen(true),
          openNotifications: () => setNotificationsOpen(true),
          openSearch: () => setSearchOpen(true),
        }} />
      </div>
      {notificationsOpen && <NotificationPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />}
      {searchOpen && <WorkspaceSearch onClose={closeSearch} />}
    </div>
  );
}
