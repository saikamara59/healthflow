import { Link } from 'react-router-dom'
import { CaretRight } from '@phosphor-icons/react'
import HfTile from '../ui/HfTile'

const TOOLS = [
  { label: 'Ask HealthFlow', path: '/ask', icon: 'ask' },
  { label: 'Compare Plans', path: '/compare', icon: 'compare' },
  { label: 'Estimate Costs', path: '/calculator', icon: 'cost' },
  { label: 'Check Network', path: '/network', icon: 'network' },
  { label: 'Explain Coverage', path: '/translator', icon: 'explain' },
  { label: 'Draft Appeal', path: '/appeals', icon: 'appeal' },
]

export default function TodayTools() {
  return <section className="card workspace-section" aria-labelledby="today-tools-heading">
    <h2 id="today-tools-heading" className="ws-h2"><HfTile icon="ask" />Tools</h2>
    <div className="workspace-tools">{TOOLS.map((tool) => <Link className="workspace-tool" to={tool.path} key={tool.path}>
      <HfTile icon={tool.icon} /><span>{tool.label}</span><CaretRight weight="bold" size={14} aria-hidden="true" />
    </Link>)}</div>
  </section>
}
