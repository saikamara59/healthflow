/* global React */
// Real organization logos. Pulls each company's own site icon; falls back to initials.
const ORG_DOMAINS = {
  'Aetna': 'aetna.com', 'Humana': 'humana.com', 'Cigna': 'cigna.com',
  'UnitedHealthcare': 'uhc.com', 'Kaiser Permanente': 'kp.org', 'BlueCross BlueShield': 'bcbs.com',
  'Integrity Marketing Group': 'integritymarketing.com',
};
const domainFor = (name, email) => {
  if (ORG_DOMAINS[name]) return ORG_DOMAINS[name];
  if (email && email.includes('@')) {
    const dm = email.split('@')[1].toLowerCase();
    if (!/gmail|yahoo|outlook|hotmail|icloud|aol/.test(dm)) return dm;
  }
  return null;
};
const orgInitials = (n) => (n || '?').split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase();

function OrgLogo({ name, email, size = 36, src }) {
  const dm = domainFor(name, email);
  const url = src || (dm ? `https://www.google.com/s2/favicons?domain=${dm}&sz=128` : null);
  const [ok, setOk] = React.useState(!!url);
  React.useEffect(() => { setOk(!!url); }, [url]);
  return (
    <span className={`org-logo ${ok ? 'has-img' : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {ok
        ? <img src={url} alt="" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} onError={() => setOk(false)} onLoad={(e) => { if (e.currentTarget.naturalWidth <= 16) setOk(false); }} />
        : orgInitials(name)}
    </span>
  );
}

// Agency logo: user can drop their own file; persists in localStorage.
function AgencyLogo({ name, size = 32 }) {
  const key = 'hf-agency-logo';
  const [src, setSrc] = React.useState(() => { try { return localStorage.getItem(key); } catch (e) { return null; } });
  const pick = (e) => {
    e.stopPropagation();
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { localStorage.setItem(key, r.result); } catch (err) {} setSrc(r.result); };
      r.readAsDataURL(f);
    };
    inp.click();
  };
  return (
    <span className={`org-logo agency ${src ? 'has-img' : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      title={src ? 'Agency logo' : 'Upload your agency logo'} onDoubleClick={pick}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} /> : orgInitials(name)}
    </span>
  );
}

Object.assign(window, { OrgLogo, AgencyLogo });
