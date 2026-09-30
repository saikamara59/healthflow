import { Link } from 'react-router-dom'
import Icon from '../ui/Icon'

export const QUICK_TOOLS = [
  { label: 'Ask HealthFlow', path: '/ask', icon: 'support' },
  { label: 'Compare Plans', path: '/compare', icon: 'compare' },
  { label: 'Estimate Costs', path: '/calculator', icon: 'calculator' },
  { label: 'Check Network', path: '/network', icon: 'network' },
  { label: 'Explain Coverage', path: '/translator', icon: 'translate' },
  { label: 'Draft Appeal', path: '/appeals', icon: 'appeal' },
]

export default function QuickTools() {
  return <section className="card workspace-section"><h2>Tools</h2><div className="workspace-tools">{QUICK_TOOLS.map((tool) => <Link className="workspace-tool" to={tool.path} key={tool.path}><Icon name={tool.icon} size={22} /><span>{tool.label}</span><Icon name="chev_r" size={15} /></Link>)}</div></section>
}
