import {
  ArrowsClockwise, ArrowsLeftRight, BookOpenText, Buildings, Calculator, CalendarBlank, ChatCircleDots,
  ClipboardText, Clock, ClockCounterClockwise, EnvelopeSimple, FileText, IdentificationBadge, LinkSimple,
  PencilSimpleLine, PlugsConnected, SealCheck, SquaresFour, Stamp, UsersThree, WarningCircle,
} from '@phosphor-icons/react'
import { OrgMark } from './OrgLogo'

export const HF_ICONS = {
  today: Clock, approve: Stamp, overview: SquaresFour, clients: UsersThree, orgs: Buildings, enroll: ClipboardText,
  issues: WarningCircle, docs: FileText, follow: ArrowsClockwise, cal: CalendarBlank, ask: ChatCircleDots,
  compare: ArrowsLeftRight, cost: Calculator, network: SealCheck, explain: BookOpenText, appeal: PencilSimpleLine,
  history: ClockCounterClockwise, team: IdentificationBadge, connect: PlugsConnected, mail: EnvelopeSimple,
}

// Colored duotone icon tile. `color` picks the tint independently of the icon.
export default function HfTile({ icon, color, large = false }) {
  const Glyph = HF_ICONS[icon] || Clock
  return <span className={`hf-tile${large ? ' lg' : ''}`} data-c={color || icon} aria-hidden="true">
    <Glyph weight="duotone" size={large ? 25 : 16} />
  </span>
}

// "🔗 Client · [logo] Organization · Contact" under a task or meeting.
export function RecordLinks({ record }) {
  const parts = [
    record.client_name && { key: 'client', text: record.client_name },
    record.organization_name && { key: 'org', text: record.organization_name, logo: true },
    record.contact_name && { key: 'contact', text: record.contact_name },
  ].filter(Boolean)
  if (!parts.length) return null
  return <small className="td-links"><LinkSimple size={11} aria-hidden="true" />{parts.map((part, index) => (
    <span key={part.key} className="td-link-part">{index > 0 && ' · '}{part.logo && <OrgMark name={part.text} size={14} />}{part.text}</span>
  ))}</small>
}
