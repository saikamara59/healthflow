/* global React, ReactDOM */
// Top-right team switcher: who the broker works with and which agency they're in.
const { useState: useSTm, useEffect: useETm, useRef: useRTm } = React;

const WORKSPACES = [
  { id: 'kbg', name: 'Kamara Benefits Group', role: 'Owner', plan: 'Agency', initials: 'KB', hue: 200,
    team: [
      { n: 'Sai Kamara', r: 'Owner', you: true, on: 'now' },
      { n: 'Renata Aguirre', r: 'Senior broker', on: 'now' },
      { n: 'Mehmet Aydın', r: 'Broker', on: '12m' },
      { n: 'Joelle Beaumont', r: 'Broker', on: '2h' },
      { n: 'Cyrus Manuelian', r: 'Operations', on: 'Yesterday' },
    ],
    upline: 'Integrity Marketing Group' },
  { id: 'solo', name: 'Sai Kamara', role: 'Independent', plan: 'Personal', initials: 'SK', hue: 150, team: [{ n: 'Sai Kamara', r: 'Broker', you: true, on: 'now' }], upline: null },
];
const HUES = [200, 258, 28, 152, 302, 68];
const ini = (n) => n.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
const hueOf = (n) => HUES[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const Av = ({ n, s = 28, ring }) => (
  <span className={`tm-av ${ring ? 'ring' : ''}`} style={{ width: s, height: s, fontSize: s * 0.38, '--h': hueOf(n) }} aria-hidden="true">{ini(n)}</span>
);

function TeamSwitcher({ flash }) {
  const [open, setOpen] = useSTm(false);
  const [ws, setWs] = useSTm(WORKSPACES[0]);
  const ref = useRTm(null);
  useETm(() => {
    if (!open) return;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', down); addEventListener('keydown', key);
    return () => { removeEventListener('mousedown', down); removeEventListener('keydown', key); };
  }, [open]);
  const online = ws.team.filter(m => m.on === 'now' && !m.you);
  const others = ws.team.filter(m => !m.you);
  const Ic = window.Ico;

  return (
    <div className="tm" ref={ref}>
      <button className={`tm-trigger ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open}>
        {others.length > 0 && (
          <span className="tm-stack" aria-hidden="true">
            {others.slice(0, 3).map(m => <Av key={m.n} n={m.n} s={24} ring />)}
            {others.length > 3 && <span className="tm-more">+{others.length - 3}</span>}
          </span>
        )}
        <span className="tm-org">
          {ws.id === 'kbg' ? <window.AgencyLogo name={ws.name} size={28} /> : <span className="tm-logo" style={{ '--h': ws.hue }}>{ws.initials}</span>}
          <span className="tm-org-t"><strong>{ws.name}</strong><small>{ws.role}</small></span>
        </span>
        <Ic n="chev" s={13} className="tm-chev" />
      </button>

      {open && (
        <div className="tm-pop" role="dialog" aria-label="Team and workspace">
          <div className="tm-scroll">
          <div className="tm-head">
            {ws.id === 'kbg' ? <window.AgencyLogo name={ws.name} size={44} /> : <span className="tm-logo lg" style={{ '--h': ws.hue }}>{ws.initials}</span>}
            <div>
              <strong>{ws.name}</strong>
              <small>{ws.plan} workspace · you are {ws.role.toLowerCase() === 'independent' ? 'an independent broker' : `the ${ws.role.toLowerCase()}`}</small>
            </div>
          </div>
          {ws.upline && <div className="tm-upline"><small>Contracted through</small><span>{ws.upline}</span></div>}

          <div className="tm-sec">
            <div className="between"><h3>Team</h3><small>{online.length} online now</small></div>
            <ul className="tm-list">
              {ws.team.map(m => (
                <li key={m.n}>
                  <span className="tm-av-wrap"><Av n={m.n} s={30} />{m.on === 'now' && <i className="tm-live" />}</span>
                  <span className="tm-who"><strong>{m.n}{m.you && <em> (you)</em>}</strong><small>{m.r}</small></span>
                  <small className="tm-seen">{m.on === 'now' ? 'Online' : m.on}</small>
                </li>
              ))}
            </ul>
            <p className="tm-note">Client records stay private to each broker. Teammates can't see your clients.</p>
          </div>

          <div className="tm-sec">
            <h3>Switch workspace</h3>
            {WORKSPACES.map(w => (
              <button key={w.id} className={`tm-ws ${w.id === ws.id ? 'on' : ''}`} onClick={() => { setWs(w); setOpen(false); if (w.id !== ws.id) flash(`Switched to ${w.name}.`); }}>
                {w.id === 'kbg' ? <window.AgencyLogo name={w.name} size={28} /> : <span className="tm-logo" style={{ '--h': w.hue }}>{w.initials}</span>}
                <span className="tm-org-t"><strong>{w.name}</strong><small>{w.plan} · {w.team.length} member{w.team.length === 1 ? '' : 's'}</small></span>
                {w.id === ws.id && <span className="tm-check" aria-label="Current">✓</span>}
              </button>
            ))}
          </div>

          </div>
          <div className="tm-foot">
            <button className="btn sm" onClick={() => { setOpen(false); location.hash = 'Team'; }}><Ic n="plus" s={13} className="" /> Invite teammate</button>
            <button className="td-link" onClick={() => { setOpen(false); location.hash = 'Team'; }}>Team settings</button>
          </div>
        </div>
      )}
    </div>
  );
}

window.TeamSwitcher = TeamSwitcher;
