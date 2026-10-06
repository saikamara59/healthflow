import { File, FileDoc, FileImage, FilePdf } from '@phosphor-icons/react'

const TYPE_ICON = { pdf: FilePdf, doc: FileDoc, docx: FileDoc, jpg: FileImage, jpeg: FileImage, png: FileImage }
export const TYPE_GROUPS = { PDF: ['pdf'], Word: ['doc', 'docx'], Images: ['jpg', 'jpeg', 'png'] }
export const ACCEPTED = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png']

// Tinted file-type tile: PDF red, Word blue, images green.
export function DocTypeTile({ type, large = false }) {
  const kind = (type || '').toLowerCase()
  const Glyph = TYPE_ICON[kind] || File
  const tone = kind === 'pdf' ? 'pdf' : ['doc', 'docx'].includes(kind) ? 'word' : ['jpg', 'jpeg', 'png'].includes(kind) ? 'image' : 'other'
  return <span className={`doc-type${large ? ' lg' : ''}`} data-tone={tone} aria-hidden="true"><Glyph weight="duotone" size={large ? 26 : 22} /></span>
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDay(iso) {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

export const isOpenable = (type) => !['doc', 'docx'].includes((type || '').toLowerCase())

// "Enrollment · Harbor Gold PPO" from a link, using whatever records are loaded.
export function linkLabel(link, names) {
  const kind = link.target_type[0].toUpperCase() + link.target_type.slice(1)
  const name = names[`${link.target_type}:${link.target_id}`]
  return name ? `${kind} · ${name}` : kind
}
