import TopBar from '../components/TopBar';
import Icon from '../components/ui/Icon';
import useLayout from '../components/ui/useLayout';

const RESOURCES = [
  {
    title: 'Plan comparison',
    desc: 'How cost ranking works, which CMS snapshot is used, and how to review a recommendation.',
    icon: 'compare',
  },
  {
    title: 'Deadline planner',
    desc: 'Create an action list for enrollment windows, renewal dates, and eligible special enrollment periods.',
    icon: 'history',
  },
  {
    title: 'Coverage translator',
    desc: 'What kinds of documents work best. Citations, formulary tiers, and section-level quoting.',
    icon: 'translate',
  },
  {
    title: 'Network check',
    desc: 'How the NPI registry and formulary lookups work. Warning codes and what to do about them.',
    icon: 'network',
  },
  {
    title: 'Cost calculator',
    desc: 'The math behind annual estimates, including premiums, deductibles, copays, and out-of-pocket limits.',
    icon: 'calculator',
  },
  {
    title: 'Claim appeals',
    desc: 'Denial-code parsing, CMS appeal grounds, and template customization.',
    icon: 'appeal',
  },
  {
    title: 'Feedback',
    desc: 'How broker ratings help identify useful results and responses that need review.',
    icon: 'feedback',
  },
];

export default function SupportPage() {
  const { openMenu, openNotifications } = useLayout();
  return (
    <>
      <TopBar crumbs={['Review', 'Support']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>How it works</div>
            <h1 className="page-title"><em>Support</em></h1>
            <p className="page-sub">
              Short explainers for each tool, plus a direct line if something is unclear. If you encounter a problem,
              tell us what happened.
            </p>
          </div>
        </div>

        <div className="grid-3">
          {RESOURCES.map((r) => (
            <div key={r.title} className="card card-pad">
              <div className="row" style={{ gap: 10, marginBottom: 10 }}>
                <Icon name={r.icon} size={18} className="ink-4" />
                <span className="eyebrow">Topic</span>
              </div>
              <div style={{ fontFamily: 'var(--serif)', fontSize: 20, letterSpacing: '-0.01em', marginBottom: 8 }}>
                {r.title}
              </div>
              <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>{r.desc}</div>
            </div>
          ))}
        </div>

        <div className="section-head"><h2>Still stuck?</h2></div>
        <div className="card card-pad" style={{ maxWidth: 720 }}>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 20 }}>
            HealthFlow is built and maintained by Saidu Kamara. For feature requests, bug reports, or a walkthrough of
            the tools, email directly. We typically respond within one business day.
          </p>
          <a href="mailto:mhsaidu@gmail.com" className="btn accent">
            <Icon name="send" size={14} /> Email support
          </a>
        </div>
      </div>
    </>
  );
}
