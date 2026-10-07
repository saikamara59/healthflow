import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client';
import { workspaceApi } from '../api/workspace';

// Working With: the one Client a Broker is focused on across the workspace.
// It lasts for the tab, and the tab stores only the Client id: never a name or
// other details, since browser storage must not hold PHI.
export const WORKING_WITH_KEY = 'hf_working_with';

const readStored = () => {
  try { return sessionStorage.getItem(WORKING_WITH_KEY) || ''; } catch { return ''; }
};

const writeStored = (clientId) => {
  try {
    if (clientId) sessionStorage.setItem(WORKING_WITH_KEY, clientId);
    else sessionStorage.removeItem(WORKING_WITH_KEY);
  } catch { /* storage unavailable: the focus still works for this page */ }
};

const WorkingWithContext = createContext({
  clientId: '', client: null, clients: [], notice: '', setClientId: () => {}, dismissNotice: () => {},
});

export function WorkingWithProvider({ children }) {
  const { pathname } = useLocation();
  const [clients, setClients] = useState([]);
  const [clientId, setClientIdState] = useState(readStored);
  const [notice, setNotice] = useState('');
  const clientIdRef = useRef(clientId);

  const setClientId = useCallback((id) => {
    clientIdRef.current = id || '';
    setClientIdState(id || '');
    writeStored(id || '');
    setNotice('');
  }, []);

  // Reload the Broker's active Clients on each page so an archive made elsewhere
  // clears the focus. linkable=true never includes archived or other Brokers' Clients.
  useEffect(() => {
    let alive = true;
    workspaceApi.listLinkableClients().then(async (rows) => {
      if (!alive || !Array.isArray(rows)) return;
      setClients(rows);
      const focused = clientIdRef.current;
      if (!focused || rows.some((row) => row.id === focused)) return;
      setClientId('');
      // Explain only an archive; an id that no longer resolves clears quietly.
      const gone = await api.get(`/clients/${encodeURIComponent(focused)}`).catch(() => null);
      if (alive && gone?.archived_at) setNotice(`${gone.full_name} was archived, so Working With was cleared.`);
    }).catch(() => {});
    return () => { alive = false; };
  }, [pathname, setClientId]);

  const value = {
    clientId,
    client: clients.find((row) => row.id === clientId) || null,
    clients,
    notice,
    setClientId,
    dismissNotice: () => setNotice(''),
  };
  return <WorkingWithContext.Provider value={value}>{children}</WorkingWithContext.Provider>;
}

/** The current Working With Client; Ask HealthFlow reads it for a new conversation's Client Context. */
export function useWorkingWith() {
  return useContext(WorkingWithContext);
}

/**
 * Prefill a Tool from Working With: when the Tool opens with a focus, and again
 * when the focus changes. Clearing calls onClear so the Tool keeps its inputs.
 */
export function useWorkingWithPrefill(applyClient, onClear) {
  const { client } = useWorkingWith();
  const focusId = client?.id || '';
  const latest = useRef({ applyClient, onClear, client });
  latest.current = { applyClient, onClear, client };
  const applied = useRef(null);
  useEffect(() => {
    if (focusId === applied.current) return;
    const firstRun = applied.current === null;
    applied.current = focusId;
    if (focusId) latest.current.applyClient(latest.current.client);
    else if (!firstRun) latest.current.onClear?.();
  }, [focusId]);
}
