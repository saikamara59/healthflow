import HfTile from './HfTile'

// Page heading from the Claude Design refresh: optional eyebrow, a large icon tile
// beside the title, a one-line summary, and right-aligned actions.
export default function PageHead({ icon, eyebrow, title, sub, actions }) {
  return (
    <div className="page-head ws-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <div className="ws-title-row">{icon && <HfTile icon={icon} large />}<h1 className="page-title">{title}</h1></div>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="quick-create-actions">{actions}</div>}
    </div>
  )
}
