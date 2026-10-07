import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client';
import { workspaceApi } from '../api/workspace';

// Working With: the one Client a Broker is focused on across the workspace.
// It lasts for the tab, and the tab stores only the Client id: never a name or
// other details, since browser storage must not hold PHI.
export const WORKING_WITH_KEY = 'hf_working_with';
// Pages that edit, archive, or restore a Client announce it so the focus updates at once.
export const CLIENTS_CHANGED_EVENT = 'healthflow:clients-changed';
export const announceClientsChanged = () => window.dispatchEvent(new Event(CLIENTS_CHANGED_EVENT));

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

  // Reload the Broker's active Clients on each page and whenever a page announces a
  // Client change, so edits and archives reach the focus at once.
  // linkable=true never includes archived or other Brokers' Clients.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const reload = useCallback(() => {
    workspaceApi.listLinkableClients().then(async (rows) => {
      if (!alive.current || !Array.isArray(rows)) return;
      setClients(rows);
      const focused = clientIdRef.current;
      if (!focused || rows.some((row) => row.id === focused)) return;
      setClientId('');
      // Explain only an archive; an id that no longer resolves clears quietly.
      const gone = await api.get(`/clients/${encodeURIComponent(focused)}`).catch(() => null);
      if (alive.current && gone?.archived_at) setNotice(`${gone.full_name} was archived, so Working With was cleared.`);
    }).catch(() => {});
  }, [setClientId]);
  useEffect(() => { reload(); }, [pathname, reload]);
  useEffect(() => {
    window.addEventListener(CLIENTS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(CLIENTS_CHANGED_EVENT, reload);
  }, [reload]);

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
  // Keyed by id and last update, so an edited Client's fresh details are applied
  // too, not just a change of Client.
  const focusKey = client ? `${client.id}:${client.updated_at}` : '';
  const latest = useRef({ applyClient, onClear, client });
  latest.current = { applyClient, onClear, client };
  const applied = useRef(null);
  useEffect(() => {
    if (focusKey === applied.current) return;
    const firstRun = applied.current === null;
    applied.current = focusKey;
    if (focusKey) latest.current.applyClient(latest.current.client);
    else if (!firstRun) latest.current.onClear?.();
  }, [focusKey]);
}
