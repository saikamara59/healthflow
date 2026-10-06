import { useState } from 'react'
import { Plus, X } from '@phosphor-icons/react'

/** "Prefill from client" dropdown shared by the AI tools. */
export function ClientPrefill({ clients, value, onPick }) {
  return (
    <label>Prefill from client
      <select value={value} onChange={(event) => onPick(clients.find((client) => client.id === event.target.value) || null)}>
        <option value="">None</option>
        {clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}, ZIP {client.zip_code}</option>)}
      </select>
    </label>
  )
}

/** Free-text list: type, press Enter or Add, remove a chip with its x. */
export function ChipInput({ label, placeholder, items, setItems }) {
  const [value, setValue] = useState('')
  const add = () => { if (value.trim()) { setItems([...items, value.trim()]); setValue('') } }
  const id = `chip-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div className="ws-listin">
      <label className="ws-listin-label" htmlFor={id}>{label}</label>
      <div className="ws-listin-row">
        <input id={id} placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add() } }} />
        <button type="button" className="btn" disabled={!value.trim()} onClick={add}><Plus size={14} weight="bold" /> Add</button>
      </div>
      {items.length > 0 && (
        <div className="ws-chips">
          {items.map((item, index) => (
            <span key={`${item}-${index}`} className="chip">{item}<button type="button" aria-label={`Remove ${item}`} onClick={() => setItems(items.filter((_, other) => other !== index))}><X size={11} weight="bold" /></button></span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * List of named entries with a second field, e.g. a medication and fills per
 * year, or a doctor and an optional NPI. `fields` is [{ key, placeholder,
 * type?, initial?, narrow? }]; the first field is the required name.
 */
export function PairListInput({ label, fields, items, setItems, format }) {
  const blank = () => Object.fromEntries(fields.map((field) => [field.key, field.initial ?? '']))
  const [draft, setDraft] = useState(blank)
  const nameKey = fields[0].key
  const ready = String(draft[nameKey]).trim()
  const add = () => {
    if (!ready) return
    setItems([...items, { ...draft, [nameKey]: String(draft[nameKey]).trim() }])
    setDraft(blank())
  }
  return (
    <div className="ws-listin">
      <div className="ws-listin-label">{label}</div>
      <div className="ws-listin-row">
        {fields.map((field) => (
          <input
            key={field.key}
            className={field.narrow ? 'narrow' : ''}
            type={field.type || 'text'}
            min={field.type === 'number' ? 1 : undefined}
            placeholder={field.placeholder}
            aria-label={field.placeholder}
            value={draft[field.key]}
            onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add() } }}
          />
        ))}
        <button type="button" className="btn" disabled={!ready} onClick={add}><Plus size={14} weight="bold" /> Add</button>
      </div>
      {items.length > 0 && (
        <div className="ws-chips">
          {items.map((item, index) => (
            <span key={`${item[nameKey]}-${index}`} className="chip">{format ? format(item) : item[nameKey]}<button type="button" aria-label={`Remove ${item[nameKey]}`} onClick={() => setItems(items.filter((_, other) => other !== index))}><X size={11} weight="bold" /></button></span>
          ))}
        </div>
      )}
    </div>
  )
}
