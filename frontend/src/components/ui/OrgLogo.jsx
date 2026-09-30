import { useEffect, useState } from 'react'

// Major Medicare carriers a broker can add in one click. Their names also map to
// a logo before the broker fills in a website.
export const COMMON_CARRIERS = [
  { name: 'Aetna', website: 'aetna.com' },
  { name: 'Humana', website: 'humana.com' },
  { name: 'UnitedHealthcare', website: 'uhc.com' },
  { name: 'Cigna', website: 'cigna.com' },
  { name: 'BlueCross BlueShield', website: 'bcbs.com' },
  { name: 'Kaiser Permanente', website: 'kp.org' },
  { name: 'Wellcare', website: 'wellcare.com' },
  { name: 'Anthem', website: 'anthem.com' },
]

const KNOWN_DOMAINS = {
  ...Object.fromEntries(COMMON_CARRIERS.map((carrier) => [carrier.name.toLowerCase(), carrier.website])),
  'blue cross blue shield': 'bcbs.com', 'integrity marketing group': 'integritymarketing.com',
}

// Only the organization's own name or website reaches the favicon service,
// never a contact's email address.
function domainFor(name, website) {
  const known = KNOWN_DOMAINS[(name || '').trim().toLowerCase()]
  if (known) return known
  if (!website) return null
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
    return url.hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

const initials = (name) => (name || '?').split(/\s+/).filter((word) => /^[A-Za-z]/.test(word)).map((word) => word[0]).slice(0, 2).join('').toUpperCase() || '?'

// Organization logo from its site icon, falling back to initials.
export default function OrgLogo({ name, website, size = 38 }) {
  const domain = domainFor(name, website)
  const src = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null
  const [ok, setOk] = useState(Boolean(src))
  useEffect(() => { setOk(Boolean(src)) }, [src])
  const inner = Math.round(size * 0.62)
  return (
    <span className={`org-logo${ok ? ' has-img' : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {ok
        ? <img src={src} alt="" width={inner} height={inner} referrerPolicy="no-referrer" onError={() => setOk(false)} onLoad={(event) => { if (event.currentTarget.naturalWidth <= 16) setOk(false) }} />
        : initials(name)}
    </span>
  )
}
