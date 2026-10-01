import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { workspaceApi } from '../../api/workspace'
import HfTile from '../ui/HfTile'
import { OrgMark } from '../ui/OrgLogo'

// Section icon per result kind; organizations show their own logo instead.
const KIND_ICON = { client: 'clients', contact: 'team', task: 'follow', appointment: 'cal' }

export default function WorkspaceSearch({ onClose }) {
  const navigate = useNavigate()
  const dialogRef = useRef(null)
  const inputRef = useRef(null)
  const requestRef = useRef(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [active, setActive] = useState(0)
  const [state, setState] = useState('idle')

  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    inputRef.current?.focus()
    const cancel = (event) => { event.preventDefault(); onClose() }
    dialog.addEventListener('cancel', cancel)
    return () => { dialog.removeEventListener('cancel', cancel); dialog.close() }
  }, [onClose])

  useEffect(() => {
    const trimmed = query.trim()
    const request = ++requestRef.current
    setResults([])
    setActive(0)
    if (trimmed.length < 2) { setState('idle'); return }
    setState('loading')
    const timer = setTimeout(() => {
      workspaceApi.search(trimmed).then((items) => {
        if (request !== requestRef.current) return
        setResults(items); setActive(0); setState('ready')
      }).catch(() => { if (request === requestRef.current) setState('error') })
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  function select(item) {
    onClose(false)
    navigate(item.href)
  }
  function keyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.min(value + 1, results.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)) }
    else if (event.key === 'Enter' && results[active]) { event.preventDefault(); select(results[active]) }
  }

  return <dialog className="workspace-dialog workspace-search-dialog" ref={dialogRef} aria-label="Search workspace"><div className="between"><h2>Search workspace</h2><button className="btn icon ghost" aria-label="Close search" onClick={onClose}>×</button></div>
    <input ref={inputRef} type="search" aria-label="Search workspace" role="searchbox" placeholder="Find clients, organizations, tasks…" value={query} onChange={(event) => { setResults([]); setActive(0); setQuery(event.target.value) }} onKeyDown={keyDown} aria-controls="workspace-search-results" aria-activedescendant={results[active] ? `workspace-result-${active}` : undefined} />
    <div className="workspace-search-hint">Type at least two characters. Use ↑ ↓ to choose and Enter to open.</div>
    {state === 'error' && <p role="alert" className="workspace-error">Search could not load. Try again.</p>}
    {state === 'loading' && <p role="status">Searching…</p>}
    <div id="workspace-search-results" role="listbox" aria-label="Workspace results">{results.map((item, index) => <button id={`workspace-result-${index}`} type="button" role="option" aria-selected={index === active} className={`workspace-search-result ${index === active ? 'active' : ''}`} key={`${item.kind}-${item.id}`} onMouseEnter={() => setActive(index)} onClick={() => select(item)}>{item.kind === 'organization' ? <OrgMark name={item.title} size={26} /> : <HfTile icon={KIND_ICON[item.kind] || 'today'} />}<span className="workspace-search-copy"><span>{item.title}</span><small>{item.subtitle}</small></span></button>)}</div>
    {state === 'ready' && results.length === 0 && <p className="workspace-empty">No matches found.</p>}
  </dialog>
}
