/* global React */
// Connectors: data model + reusable components. All accounts, clients, and activity are synthetic.
const { useState: useSC, useEffect: useEC, useRef: useRC } = React;
const fav = (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=128`;
const PHI = (n, cls = '') => <i className={`ph-duotone ph-${n} ${cls}`} aria-hidden="true" />;

const CATEGORIES = [
  { id: 'comm', label: 'Communication', icon: 'envelope-simple' },
  { id: 'cal', label: 'Calendar', icon: 'calendar-blank' },
  { id: 'health', label: 'Healthcare data', icon: 'first-aid-kit' },
  { id: 'payer', label: 'Payer networks', icon: 'buildings' },
  { id: 'docs', label: 'Documents', icon: 'folder-simple' },
  { id: 'biz', label: 'Business systems', icon: 'briefcase' },
];

const payer = (id, name, domain) => ({
  id, name, category: 'payer', badge: 'Payer', logo: fav(domain), status: 'soon',
  desc: `Planned connector. HealthFlow has no partnership or data access with ${name} today.`,
  tagline: 'This connector is on the roadmap and not yet available.',
  capabilities: ['Plan and benefit lookups', 'Eligibility checks', 'Claim and authorization status'],
  permissions: { can: [], confirm: [], cannot: ['Access any payer data until an official agreement exists'] },
  usedBy: [],
});

const CONNECTORS = [
  { id: 'gmail', name: 'Gmail', category: 'comm', badge: 'Email', logo: fav('mail.google.com'), status: 'connected',
    account: 'sai.kamara@example.com', lastSync: '2 minutes ago',
    desc: 'Connect your inbox to view client conversations, summarize threads, create follow-ups, and draft responses.',
    tagline: 'Bring client communication into HealthFlow.',
    capabilities: ['View authorized email conversations', 'Link conversations to clients', 'Summarize long threads', 'Create tasks from messages', 'Draft responses with Ask HealthFlow'],
    permissions: { can: ['Read authorized messages', 'Create draft responses', 'Link messages to clients'], confirm: ['Send a reply', 'Link a message to a client record'], cannot: ['Send messages without your confirmation', 'Delete or archive email'] },
    usedBy: [['Ask HealthFlow', 'ask'], ['Today inbox', 'mail'], ['Task suggestions', 'follow']] },
  { id: 'outlook', name: 'Microsoft Outlook', category: 'comm', badge: 'Email', logo: fav('outlook.live.com'), status: 'disconnected',
    desc: 'Connect Outlook to bring client conversations into your HealthFlow workspace.',
    tagline: 'Bring Outlook conversations into HealthFlow.',
    capabilities: ['View authorized email conversations', 'Link conversations to clients', 'Summarize long threads', 'Create tasks from messages'],
    permissions: { can: ['Read authorized messages', 'Create draft responses'], confirm: ['Send a reply'], cannot: ['Send messages without your confirmation'] },
    usedBy: [['Ask HealthFlow', 'ask'], ['Today inbox', 'mail']] },
  { id: 'gcal', name: 'Google Calendar', category: 'cal', badge: 'Calendar', logo: fav('calendar.google.com'), status: 'expired',
    account: 'sai.kamara@example.com', lastSync: '8 minutes ago',
    alert: 'Google Calendar permission has expired. New appointments are not syncing.', alertAction: 'Review connection',
    desc: 'Sync appointments, enrollment calls, follow-ups, and important deadlines.',
    tagline: 'Keep appointments and deadlines in one place.',
    capabilities: ['Read appointments', 'Show meetings on Today', 'Suggest appointment times', 'Add enrollment deadlines'],
    permissions: { can: ['Read appointments', 'Suggest appointments'], confirm: ['Create events', 'Change or cancel an event'], cannot: ['Invite clients without your confirmation'] },
    usedBy: [['My Meetings', 'cal'], ['Scheduling', 'cal'], ['Ask HealthFlow', 'ask']] },
  { id: 'mscal', name: 'Microsoft Calendar', category: 'cal', badge: 'Calendar', logo: fav('outlook.office.com'), status: 'disconnected',
    desc: 'Bring your Microsoft calendar events and appointments into HealthFlow.',
    tagline: 'Keep appointments and deadlines in one place.',
    capabilities: ['Read appointments', 'Show meetings on Today', 'Suggest appointment times'],
    permissions: { can: ['Read appointments', 'Suggest appointments'], confirm: ['Create events'], cannot: ['Invite clients without your confirmation'] },
    usedBy: [['My Meetings', 'cal'], ['Scheduling', 'cal']] },
  { id: 'cms', name: 'CMS', category: 'health', badge: 'CMS', logo: fav('cms.gov'), status: 'available', lastSync: 'Dataset updated Sep 2026', account: 'Public plan datasets',
    desc: 'Access supported CMS plan and healthcare datasets used by HealthFlow workflows.',
    tagline: 'Plan data behind comparisons and cost estimates.',
    capabilities: ['Plan lookup', 'Plan metadata', 'Marketplace data', 'Supported CMS datasets'],
    permissions: { can: ['Query supported plan information'], confirm: [], cannot: ['Access member or claims data'] },
    usedBy: [['Ask HealthFlow', 'ask'], ['Compare Plans', 'compare'], ['Estimate Costs', 'cost']] },
  { id: 'nppes', name: 'NPPES / NPI Registry', category: 'health', badge: 'NPI', logo: fav('npiregistry.cms.hhs.gov'), status: 'available', lastSync: 'Live lookups', account: 'Public provider registry',
    desc: 'Search healthcare providers, NPIs, specialties, organizations, and practice locations.',
    tagline: 'Find and confirm providers by name or NPI.',
    capabilities: ['Search providers', 'Resolve provider NPI', 'View provider specialty', 'View practice location', 'Identify organizations'],
    permissions: { can: ['Query supported provider information'], confirm: [], cannot: ['Confirm network status on a plan’s behalf'] },
    usedBy: [['Ask HealthFlow', 'ask'], ['Check Network', 'network'], ['Client profiles', 'clients']] },
  { id: 'bluebutton', name: 'Medicare', sub: 'CMS Blue Button', category: 'health', badge: 'FHIR', logo: fav('bluebutton.cms.gov'), status: 'permission',
    desc: 'Connect authorized Medicare data using supported FHIR resources.',
    tagline: 'Each client authorizes their own Medicare data.',
    alert: 'Each client must sign in to Medicare.gov and approve access before any data is shared.', alertAction: 'Set up client authorization',
    capabilities: ['Coverage summary', 'Part D prescription history', 'Explanation of benefits'],
    permissions: { can: ['Read data a client has approved'], confirm: ['Request authorization from a client'], cannot: ['Access data without the client’s approval', 'Keep data after the client revokes access'] },
    usedBy: [['Ask HealthFlow', 'ask'], ['Compare Plans', 'compare'], ['Client profiles', 'clients']] },
  payer('aetna', 'Aetna', 'aetna.com'), payer('uhc', 'UnitedHealthcare', 'uhc.com'), payer('cigna', 'Cigna', 'cigna.com'),
  payer('humana', 'Humana', 'humana.com'), payer('bcbs', 'Blue Cross Blue Shield', 'bcbs.com'),
  { id: 'gdrive', name: 'Google Drive', category: 'docs', badge: 'Documents', logo: fav('drive.google.com'), status: 'syncfailed',
    account: 'sai.kamara@example.com', lastSync: '25 minutes ago',
    alert: 'Google Drive sync failed. 2 files could not be read.', alertAction: 'Retry sync',
    desc: 'Access authorized client documents and plan materials from Google Drive.',
    tagline: 'Use plan materials and client files you already store.',
    capabilities: ['Open authorized files', 'Attach files to clients and issues', 'Explain Summary of Benefits files'],
    permissions: { can: ['Read files in folders you choose'], confirm: ['Save a HealthFlow document to Drive'], cannot: ['Read folders you have not shared', 'Delete files'] },
    usedBy: [['Documents', 'docs'], ['Explain Coverage', 'explain'], ['Ask HealthFlow', 'ask']] },
  { id: 'onedrive', name: 'Microsoft OneDrive', category: 'docs', badge: 'Documents', logo: fav('onedrive.live.com'), status: 'disconnected',
    desc: 'Connect authorized documents stored in Microsoft OneDrive.',
    tagline: 'Use plan materials and client files you already store.',
    capabilities: ['Open authorized files', 'Attach files to clients and issues'],
    permissions: { can: ['Read files in folders you choose'], confirm: ['Save a HealthFlow document to OneDrive'], cannot: ['Delete files'] },
    usedBy: [['Documents', 'docs'], ['Explain Coverage', 'explain']] },
  { id: 'crm', name: 'CRM', category: 'biz', badge: 'CRM', icon: 'address-book', status: 'disconnected',
    desc: 'Connect your existing client system to keep client information synchronized.',
    tagline: 'Keep client records in step with the system you use.',
    capabilities: ['Import client records', 'Keep contact details in sync', 'Match clients to conversations'],
    permissions: { can: ['Read client records'], confirm: ['Update a record in your CRM'], cannot: ['Delete records'] },
    usedBy: [['Clients', 'clients'], ['Ask HealthFlow', 'ask']] },
  { id: 'ams', name: 'Agency Management System', category: 'biz', badge: 'CRM', icon: 'kanban', status: 'disconnected',
    desc: 'Connect supported agency systems to bring client and workflow information into HealthFlow.',
    tagline: 'Bring agency workflow information into HealthFlow.',
    capabilities: ['Import policies and clients', 'Bring in open workflow items', 'Match enrollments'],
    permissions: { can: ['Read clients and policies'], confirm: ['Write back enrollment status'], cannot: ['Delete records'] },
    usedBy: [['Enrollments', 'enroll'], ['Clients', 'clients']] },
];

const SEED_ACTIVITY = [
  { id: 'gmail', what: 'Synced 12 conversations', when: '2 minutes ago' },
  { id: 'gcal', what: 'Permission expired', when: '6 minutes ago', tone: 'warn' },
  { id: 'gcal', what: 'Imported 3 upcoming appointments', when: '8 minutes ago' },
  { id: 'nppes', what: 'Provider lookup completed', when: '12 minutes ago' },
  { id: 'cms', what: 'Plan lookup completed', when: '18 minutes ago' },
  { id: 'gdrive', what: 'Sync failed on 2 files', when: '25 minutes ago', tone: 'warn' },
];

const STATUS = {
  connected: { label: 'Connected', icon: 'check-circle', tone: 'pos', action: 'Manage' },
  available: { label: 'Available', icon: 'check-circle', tone: 'pos', action: 'View' },
  disconnected: { label: 'Not connected', icon: 'plugs', tone: 'mute', action: 'Connect' },
  connecting: { label: 'Connecting…', icon: 'circle-notch', tone: 'accent', spin: true, action: 'Connecting…' },
  syncing: { label: 'Syncing', icon: 'arrows-clockwise', tone: 'accent', spin: true, action: 'Manage' },
  failed: { label: 'Connection failed', icon: 'x-circle', tone: 'neg', action: 'Try again' },
  expired: { label: 'Needs attention', icon: 'warning', tone: 'warn', action: 'Review' },
  permission: { label: 'Permission required', icon: 'lock-key', tone: 'warn', action: 'Set up' },
  syncfailed: { label: 'Sync failed', icon: 'warning', tone: 'warn', action: 'Retry sync' },
  soon: { label: 'Coming soon', icon: 'hourglass-medium', tone: 'mute', action: null },
};
const LIVE = ['connected', 'available', 'syncing', 'syncfailed', 'expired'];

/* ---------- components ---------- */
function ConnectorLogo({ c, size = 40 }) {
  if (c.icon) return <span className="cx-logo cx-logo-ic" style={{ width: size, height: size }}>{PHI(c.icon)}</span>;
  return <window.OrgLogo name={c.name} src={c.logo} size={size} />;
}
const ConnectorBadge = ({ children }) => <span className="cx-badge">{children}</span>;
function ConnectorStatus({ status }) {
  const s = STATUS[status];
  return <span className={`cx-status ${s.tone}`}>{PHI(s.icon, s.spin ? 'cx-spin' : '')}{s.label}</span>;
}

function ConnectorCard({ c, onOpen, onPrimary }) {
  const s = STATUS[c.status];
  const live = c.status === 'connected' || c.status === 'syncing';
  return (
    <li className={`card cx-card ${c.status === 'soon' ? 'soon' : ''}`}>
      <button className="cx-card-hit" onClick={() => onOpen(c.id)} aria-label={`Open ${c.name} details`} />
      <div className="cx-card-top">
        <ConnectorLogo c={c} />
        <div className="cx-card-name">
          <strong>{c.name}</strong>
          <span className="cx-card-sub">{c.sub && <small>{c.sub}</small>}<ConnectorBadge>{c.badge}</ConnectorBadge></span>
        </div>
      </div>
      <ConnectorStatus status={c.status} />
      <p className="cx-desc">{c.desc}</p>
      {live && (
        <dl className="cx-meta">
          <div><dt>Account</dt><dd>{c.account}</dd></div>
          <div><dt>Last synced</dt><dd>{c.status === 'syncing' ? 'Syncing now' : c.lastSync}</dd></div>
          <div className="cx-meta-perm"><dt>Permissions</dt><dd>{c.permissions.can.slice(0, 2).join(', ')}</dd></div>
        </dl>
      )}
      <div className="cx-card-foot">
        {s.action
          ? <button className={`btn sm ${c.status === 'disconnected' || c.status === 'failed' ? 'accent' : ''}`} disabled={c.status === 'connecting'} onClick={(e) => { e.stopPropagation(); onPrimary(c); }}>{s.action}</button>
          : <span className="cx-soon-note">Not available yet</span>}
      </div>
    </li>
  );
}

function ConnectorCategory({ cat, items, onOpen, onPrimary }) {
  return (
    <section className="cx-cat" aria-labelledby={`cx-${cat.id}`}>
      <div className="cx-cat-head">
        <h2 id={`cx-${cat.id}`}>{PHI(cat.icon)}{cat.label}</h2>
        {cat.id === 'payer' && <small>Planned. No payer partnerships or data access exist yet.</small>}
      </div>
      <ConnectorGrid items={items} onOpen={onOpen} onPrimary={onPrimary} />
    </section>
  );
}
const ConnectorGrid = ({ items, onOpen, onPrimary }) => (
  <ul className="cx-grid">{items.map(c => <ConnectorCard key={c.id} c={c} onOpen={onOpen} onPrimary={onPrimary} />)}</ul>
);

function ConnectorPermissions({ p }) {
  return (
    <div className="cx-perm">
      {p.can.length > 0 && <div><h4>HealthFlow can</h4><ul>{p.can.map(x => <li key={x} className="yes">{PHI('check')}{x}</li>)}</ul></div>}
      {p.confirm.length > 0 && <div><h4>Asks you first</h4><ul>{p.confirm.map(x => <li key={x} className="ask">{PHI('hand')}{x}</li>)}</ul></div>}
      {p.cannot.length > 0 && <div><h4>HealthFlow cannot</h4><ul>{p.cannot.map(x => <li key={x} className="no">{PHI('x')}{x}</li>)}</ul></div>}
    </div>
  );
}

function ConnectorActivity({ items, byId, compact }) {
  if (!items.length) return <p className="workspace-empty">No activity yet.</p>;
  return (
    <ul className="cx-act">
      {items.map((a, i) => { const c = byId[a.id]; return (
        <li key={i} className={a.tone === 'warn' ? 'warn' : ''}>
          {!compact && <ConnectorLogo c={c} size={30} />}
          <div><strong>{compact ? a.what : c.name}</strong>{!compact && <span className="cx-act-what">{a.what}</span>}<small>{a.when}</small></div>
        </li>
      ); })}
    </ul>
  );
}

function ConnectorDetails({ c, activity, byId, onClose, api }) {
  const [step, setStep] = useSC(null); // null | consent | disconnect
  const [failNext, setFailNext] = useSC(false);
  const ref = useRC(null);
  useEC(() => { setStep(null); }, [c.id]);
  useEC(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  useEC(() => { if (ref.current) ref.current.scrollTop = 0; }, [c.id, step]);
  const st = c.status;
  const healthPublic = st === 'available';
  const doConnect = () => { setStep(null); api.connect(c.id, failNext); };
  const mine = activity.filter(a => a.id === c.id).slice(0, 4);

  return (
    <>
      <div className="cx-scrim" onClick={onClose} />
      <aside className="cx-drawer" role="dialog" aria-label={`${c.name} connector`}>
        <header className="cx-d-head">
          <ConnectorLogo c={c} size={48} />
          <div className="cx-d-title">
            <h2>{c.name}</h2>
            <span className="cx-card-sub">{c.sub && <small>{c.sub}</small>}<ConnectorBadge>{c.badge}</ConnectorBadge></span>
          </div>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">{PHI('x')}</button>
        </header>

        <div className="cx-d-body" ref={ref}>
          <p className="cx-tagline">{c.tagline}</p>
          <ConnectorStatus status={st} />

          {api.justConnected === c.id && st === 'connected' && (
            <div className="cx-note ok">{PHI('check-circle')}<div><strong>Connected successfully</strong><span>{c.name} is ready. Ask HealthFlow can now use it with the permissions below.</span></div></div>
          )}
          {st === 'failed' && (
            <div className="cx-note neg">{PHI('x-circle')}<div><strong>{c.name} could not connect</strong><span>The sign-in window closed before access was approved. Nothing was shared.</span></div><button className="btn sm" onClick={() => setStep('consent')}>Try again</button></div>
          )}
          {(st === 'expired' || st === 'syncfailed' || st === 'permission') && c.alert && (
            <div className="cx-note warn">{PHI(st === 'permission' ? 'lock-key' : 'warning')}<div><strong>{st === 'expired' ? 'Needs to be reconnected' : st === 'syncfailed' ? 'Sync failed' : 'Permission required'}</strong><span>{c.alert}</span></div>
              <button className="btn sm" onClick={() => st === 'syncfailed' ? api.sync(c.id) : st === 'permission' ? api.flash('Client authorization links open in the full app.') : setStep('consent')}>{st === 'expired' ? 'Reconnect' : st === 'syncfailed' ? 'Retry sync' : 'Set up'}</button></div>
          )}
          {st === 'soon' && <div className="cx-note mute">{PHI('hourglass-medium')}<div><strong>Coming soon</strong><span>{c.desc}</span></div></div>}

          {step === 'consent' && (
            <div className="cx-consent">
              <h3>Review access before connecting</h3>
              <p>You will sign in with {c.name} in a new window. HealthFlow only receives what is listed here, and you can disconnect at any time.</p>
              <ConnectorPermissions p={c.permissions} />
              <div className="cx-sim">
                <span>Prototype: next attempt</span>
                <div className="cx-seg" role="group" aria-label="Simulate result">
                  <button className={!failNext ? 'on' : ''} onClick={() => setFailNext(false)}>Succeeds</button>
                  <button className={failNext ? 'on' : ''} onClick={() => setFailNext(true)}>Fails</button>
                </div>
              </div>
              <div className="quick-create-actions"><button className="btn" onClick={() => setStep(null)}>Cancel</button><button className="btn accent" onClick={doConnect}>Continue to {c.name.split(' ')[0] === 'Microsoft' ? 'Microsoft' : c.name.split(' ')[0]}</button></div>
            </div>
          )}
          {st === 'connecting' && (
            <div className="cx-connecting">{PHI('circle-notch', 'cx-spin')}<div><strong>Connecting to {c.name}…</strong><span>Waiting for you to approve access in the sign-in window.</span></div></div>
          )}

          {(st === 'connected' || st === 'syncing' || st === 'expired' || st === 'syncfailed' || healthPublic) && (
            <dl className="cx-meta cx-meta-d">
              <div><dt>{healthPublic ? 'Source' : 'Connected account'}</dt><dd>{c.account}</dd></div>
              <div><dt>{healthPublic ? 'Freshness' : 'Last synced'}</dt><dd>{st === 'syncing' ? 'Syncing now' : c.lastSync}</dd></div>
            </dl>
          )}

          <section><h3>What it enables</h3><ul className="cx-caps">{c.capabilities.map(x => <li key={x}>{PHI('check')}{x}</li>)}</ul></section>

          {c.usedBy.length > 0 && (
            <section><h3>Used by HealthFlow</h3>
              <div className="cx-used">
                {c.usedBy.map(([l, ic]) => <span key={l} className="cx-used-chip"><window.WSTile n={ic} />{l}</span>)}
              </div>
            </section>
          )}

          {step !== 'consent' && st !== 'soon' && <section><h3>Permissions</h3><ConnectorPermissions p={c.permissions} /></section>}

          {mine.length > 0 && <section><h3>Recent activity</h3><ConnectorActivity items={mine} byId={byId} compact /></section>}

          {step === 'disconnect' && (
            <div className="cx-note neg">{PHI('plugs')}<div><strong>Disconnect {c.name}?</strong><span>Ask HealthFlow and {c.usedBy.map(u => u[0]).filter(n => n !== 'Ask HealthFlow').join(', ') || 'your workspace'} will stop receiving new data. Records already saved in HealthFlow stay put.</span></div></div>
          )}
        </div>

        <footer className="cx-d-foot">
          {st === 'disconnected' && step !== 'consent' && <button className="btn accent" onClick={() => setStep('consent')}>Connect {c.name}</button>}
          {st === 'failed' && step !== 'consent' && <button className="btn accent" onClick={() => setStep('consent')}>Try again</button>}
          {(st === 'connected' || st === 'syncfailed') && step !== 'disconnect' && <><button className="btn" onClick={() => api.sync(c.id)}>{PHI('arrows-clockwise')} Sync now</button><button className="btn ghost cx-danger" onClick={() => setStep('disconnect')}>Disconnect</button></>}
          {st === 'expired' && step !== 'consent' && <><button className="btn accent" onClick={() => setStep('consent')}>Reconnect</button><button className="btn ghost cx-danger" onClick={() => setStep('disconnect')}>Disconnect</button></>}
          {step === 'disconnect' && <><button className="btn" onClick={() => setStep(null)}>Cancel</button><button className="btn cx-danger-solid" onClick={() => { setStep(null); api.disconnect(c.id); }}>Disconnect</button></>}
          {st === 'syncing' && <span className="workspace-small">Sync in progress…</span>}
          {healthPublic && <span className="workspace-small">Public data. No sign-in needed.</span>}
          {st === 'soon' && <button className="btn" onClick={() => api.flash(`We will let you know when ${c.name} is available.`)}>Notify me</button>}
        </footer>
      </aside>
    </>
  );
}

function ConnectorsPage({ ctx }) {
  const [list, setList] = useSC(CONNECTORS);
  const [activity, setActivity] = useSC(SEED_ACTIVITY);
  const [q, setQ] = useSC('');
  const [cat, setCat] = useSC('all');
  const [open, setOpen] = useSC(null);
  const [justConnected, setJust] = useSC(null);
  const [empty, setEmpty] = useSC(false);
  const byId = Object.fromEntries(list.map(c => [c.id, c]));
  const set = (id, patch) => setList(l => l.map(c => c.id === id ? { ...c, ...patch } : c));
  const log = (id, what, tone) => setActivity(a => [{ id, what, when: 'Just now', tone }, ...a]);

  const api = {
    justConnected, flash: ctx.flash,
    connect(id, fail) {
      set(id, { status: 'connecting' }); setJust(null);
      setTimeout(() => {
        if (fail) { set(id, { status: 'failed' }); log(id, 'Connection failed', 'warn'); ctx.flash(`${byId[id].name} could not connect.`); return; }
        set(id, { status: 'connected', account: byId[id].account || 'sai.kamara@example.com', lastSync: 'Just now', alert: null });
        setJust(id); log(id, 'Connected'); ctx.flash(`${byId[id].name} connected successfully.`);
      }, 1600);
    },
    sync(id) {
      set(id, { status: 'syncing' });
      setTimeout(() => { set(id, { status: 'connected', lastSync: 'Just now', alert: null }); log(id, id === 'gdrive' ? 'Synced 14 files' : 'Sync completed'); ctx.flash(`${byId[id].name} is up to date.`); }, 1300);
    },
    disconnect(id) { set(id, { status: 'disconnected', lastSync: null }); setJust(null); log(id, 'Disconnected'); ctx.flash(`${byId[id].name} disconnected.`); },
  };
  const primary = (c) => {
    if (c.status === 'syncfailed') return api.sync(c.id);
    setOpen(c.id);
  };

  const shown = empty ? [] : list;
  const match = (c) => !q.trim() || `${c.name} ${c.sub || ''} ${c.desc} ${c.badge}`.toLowerCase().includes(q.toLowerCase());
  const visible = shown.filter(c => (cat === 'all' || (cat === 'connected' ? LIVE.includes(c.status) : c.category === cat)) && match(c));
  const connected = shown.filter(c => c.status === 'connected' || c.status === 'available');
  const alerts = shown.filter(c => (c.status === 'expired' || c.status === 'syncfailed') && c.alert);
  const openC = open && byId[open];

  return (
    <>
      <window.PageHead eyebrow="Settings" title="Connectors" sub="Connect the tools and healthcare data sources your team already uses."
        action={<label className="search cx-search">{PHI('magnifying-glass')}<input value={q} onChange={e => setQ(e.target.value)} placeholder="Search connectors…" aria-label="Search connectors" /></label>} />

      {empty ? (
        <section className="card cx-empty">
          <span className="cx-empty-ic">{PHI('plugs-connected')}</span>
          <h2>Bring your workflow into HealthFlow.</h2>
          <p>Connect email, calendars, healthcare data sources, and documents so HealthFlow can help organize your work.</p>
          <button className="btn accent" onClick={() => setEmpty(false)}>Browse connectors</button>
        </section>
      ) : (<>
        <section className="card cx-power">
          <div className="cx-power-copy">
            <h2>Power up Ask HealthFlow</h2>
            <p>Connect your tools to give Ask HealthFlow permissioned access to the information it needs to help with your daily work.</p>
          </div>
          <div className="cx-power-viz" aria-label={`${connected.length} connected tools`}>
            <span className="cx-power-ask"><window.WSTile n="ask" />Ask HealthFlow</span>
            <span className="cx-power-line" />
            <span className="cx-power-tools">
              {connected.map(c => <ConnectorLogo key={c.id} c={c} size={30} />)}
              <small>{connected.length} connected</small>
            </span>
          </div>
        </section>

        {alerts.map(c => (
          <div key={c.id} className="cx-alert">
            <ConnectorLogo c={c} size={30} />
            <span className="cx-alert-msg">{c.alert}</span>
            <button className="btn sm" onClick={() => c.status === 'syncfailed' ? api.sync(c.id) : setOpen(c.id)}>{c.alertAction}</button>
          </div>
        ))}

        <div className="cx-filters" role="tablist" aria-label="Filter connectors">
          {[['all', 'All'], ['connected', 'Connected'], ...CATEGORIES.map(x => [x.id, x.label])].map(([id, l]) => (
            <button key={id} role="tab" aria-selected={cat === id} className={`pill ${cat === id ? 'on' : ''}`} onClick={() => setCat(id)}>{l}</button>
          ))}
        </div>

        <div className="cx-layout">
          <div className="cx-main">
            {visible.length === 0 && <div className="card cx-none"><strong>No connectors match “{q}”.</strong><button className="td-link" onClick={() => { setQ(''); setCat('all'); }}>Clear search</button></div>}
            {CATEGORIES.map(k => { const items = visible.filter(c => c.category === k.id); return items.length ? <ConnectorCategory key={k.id} cat={k} items={items} onOpen={setOpen} onPrimary={primary} /> : null; })}
          </div>
          <aside className="cx-rail">
            <section className="card workspace-section">
              <h2 className="ws-h2">Recent connector activity</h2>
              <ConnectorActivity items={activity.slice(0, 7)} byId={byId} />
            </section>
            <section className="card workspace-section cx-rule">
              <h2 className="ws-h2">Your approval comes first</h2>
              <p className="workspace-small">Anything that reaches outside HealthFlow, like sending an email or creating a calendar event, waits in Approvals until you confirm it.</p>
              <button className="td-link" onClick={() => setEmpty(true)}>Preview the empty state</button>
            </section>
          </aside>
        </div>
      </>)}

      {openC && <ConnectorDetails c={openC} activity={activity} byId={byId} onClose={() => setOpen(null)} api={api} />}
    </>
  );
}

window.WS_PAGES = Object.assign(window.WS_PAGES || {}, { 'Connectors': ConnectorsPage });
Object.assign(window, { HF_CONNECTORS: CONNECTORS, ConnectorCard, ConnectorGrid, ConnectorCategory, ConnectorStatus, ConnectorDetails, ConnectorPermissions, ConnectorActivity, ConnectorBadge });
