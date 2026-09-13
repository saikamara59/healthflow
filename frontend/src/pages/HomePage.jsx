import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/ui/BrandLogo';
import BrandWordmark from '../components/ui/BrandWordmark';
import '../home-v2.css';

// Smooth-scroll for in-page anchors (replaces the design's vanilla handler).
function scrollToId(e, id) {
  const t = document.getElementById(id);
  if (t) {
    e.preventDefault();
    t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const ARROW = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
);
const ARROW_LG = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
);

const AGENTS = [
  {
    key: 'compare', icon: 'M21 3 3 21M9 3h12v12M15 21H3V9',
    title: 'Plan comparison', tab: 'Compares plans using a client’s medications and providers',
    desc: 'Compares Medicare Advantage plans using the client’s prescriptions, providers, and budget, then ranks them by estimated annual cost.',
    inLbl: 'Input', in: [['zip', '10025'], ['age', '67'], ['rx', '3 meds']],
    outLbl: 'Output', out: [['best', 'Aetna Prime'], ['est/yr', '$1,864'], ['fit', '96%']],
    chips: ['CMS snapshot', 'formulary checked', 'structured result'],
  },
  {
    key: 'translate', icon: 'M5 8h14M7 5l5 6-5 6M13 13l4 8 4-8M15 17h8',
    title: 'Coverage translator', tab: 'Explains plan benefits in plain language',
    desc: 'Answers benefit questions in plain language and cites the section used, so brokers can review the source directly.',
    inLbl: 'Asked', in: [['q', 'ER copay if admitted?']],
    outLbl: 'Answered', out: [['$120', 'waived if admitted'], ['cite', '§1.2 Emergency']],
    chips: ['section citations', 'source-based answers'],
  },
  {
    key: 'plan', icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
    title: 'Deadline planner', tab: 'Creates a dated action list',
    desc: 'Uses a denial, life change, or enrollment window to create an ordered action plan tied to the relevant deadline.',
    inLbl: 'Event', in: [['type', 'SEP'], ['trigger', 'May 1']],
    outLbl: 'Plan', out: [['deadline', 'Jun 30'], ['actions', '5 steps'], ['urgency', 'high']],
    chips: ['date-anchored', 'owner-assigned'],
  },
  {
    key: 'verify', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
    title: 'Network check', tab: 'Checks providers and pharmacies before enrollment',
    desc: 'Checks available provider and pharmacy data for the selected plan. Brokers should confirm network status with the plan before enrollment.',
    inLbl: 'Checking', in: [['Dr. Patel', 'cardiology'], ['pharmacy', 'mail-order']],
    outLbl: 'Result', out: [['Dr. Patel', 'listed in network'], ['pharmacy', 'listed in network']],
    chips: ['provider data', 'manual confirmation'],
  },
  {
    key: 'appeal', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h3',
    title: 'Appeal drafter', tab: 'Drafts denial appeals with cited guidance',
    desc: 'Drafts a denial appeal using the denial letter, plan language, and relevant guidance for a broker to review before filing.',
    inLbl: 'Denial', in: [['claim', 'cardiac cath'], ['carrier', 'Cigna']],
    outLbl: 'Draft', out: [['cites', 'LCD L33559'], ['status', 'ready for review']],
    chips: ['guidance cited', 'broker review'],
  },
];

function IoRows({ rows }) {
  return rows.map(([k, v], i) => (
    <div className="io-line" key={i}><span className="k">{k}</span> {v}</div>
  ));
}

// Vimeo video ID for the product demo (the number in vimeo.com/123456789).
const VIMEO_ID = '1197158139';

// Click-to-load Vimeo facade: shows a poster + play button and loads NOTHING
// from Vimeo until a visitor clicks — zero third-party bytes or tracking on
// page load. dnt=1 asks Vimeo not to track.
/** Defers loading the product-demo player until a visitor chooses to watch it. */
function DemoVideoFrame() {
  const [playing, setPlaying] = useState(false);
  return (
    <figure className="video-frame glass-panel reveal">
      <div className="vf-chrome">
        <span className="vf-url">HealthFlow product demo</span>
      </div>
      <div className="vf-stage">
        {playing ? (
          <iframe
            className="vf-video"
            style={{ border: 0 }}
            src={`https://player.vimeo.com/video/${VIMEO_ID}?autoplay=1&dnt=1&title=0&byline=0&portrait=0`}
            title="HealthFlow product demo"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            className="vf-placeholder"
            type="button"
            onClick={() => setPlaying(true)}
            aria-label="Play demo video"
          >
            <span className="vf-play">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </span>
            <span className="vf-ph-title">Watch the product demo</span>
            <span className="vf-ph-desc">Click to play. The video loads from Vimeo only when requested.</span>
          </button>
        )}
      </div>
    </figure>
  );
}

/** Renders the public HealthFlow product overview and primary calls to action. */
export default function HomePage() {
  const [active, setActive] = useState('compare');
  const a = AGENTS.find((x) => x.key === active);

  // Scroll-reveal: reveal-anim hides .reveal until the observer adds .in.
  // Fallback timer reveals everything in case the observer never fires.
  useEffect(() => {
    const root = document.getElementById('lp-root');
    if (!root) return;
    root.classList.add('reveal-anim');
    const els = root.querySelectorAll('.reveal');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    const t1 = setTimeout(() => els.forEach((el) => el.classList.add('in')), 1400);
    const t2 = setTimeout(() => root.classList.remove('reveal-anim'), 2500);
    return () => {
      io.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="lp glassui" id="lp-root">
      {/* aurora backdrop */}
      <div className="aurora" aria-hidden="true">
        <span className="blob b1"></span>
        <span className="blob b2"></span>
        <span className="blob b3"></span>
        <span className="blob b4"></span>
        <span className="grain"></span>
      </div>

      <span id="top"></span>

      {/* ================= NAV ================= */}
      <nav className="lp-nav">
        <div className="lp-nav-inner glass">
          <a className="lp-logo" href="#top" onClick={(e) => scrollToId(e, 'top')}>
            <BrandLogo size={30} className="mk" />
            <BrandWordmark className="wm" />
          </a>
          <div className="lp-navlinks">
            <a href="#system" onClick={(e) => scrollToId(e, 'system')}>Overview</a>
            <a href="#agents" onClick={(e) => scrollToId(e, 'agents')}>Tools</a>
            <a href="#regulated" onClick={(e) => scrollToId(e, 'regulated')}>Records and privacy</a>
            <a href="#demo" onClick={(e) => scrollToId(e, 'demo')}>Demo</a>
          </div>
          <div className="lp-nav-cta">
            <Link to="/login">Sign in</Link>
            <Link className="lp-btn" to="/login?mode=register">
              Request access {ARROW}
            </Link>
          </div>
        </div>
      </nav>

      {/* ================= HERO ================= */}
      <header className="lp-section lp-hero">
        <div className="lp-wrap">
          <div className="lp-hero-grid">
            <div>
              <span className="lp-eyebrow glass-chip"><span className="pulse"></span> Built for Medicare brokers</span>
              <h1 className="lp-h1">Compare coverage options and keep a clear supporting record.</h1>
              <p className="lp-hero-sub">
                HealthFlow helps Medicare brokers compare plans, explain benefits, and draft appeals.
                Each result includes its sources and activity record.
              </p>
              <div className="lp-hero-actions">
                <Link className="lp-btn lg" to="/login?mode=register">
                  Request access {ARROW_LG}
                </Link>
                <a className="lp-btn ghost lg" href="#agents" onClick={(e) => scrollToId(e, 'agents')}>See the tools</a>
              </div>
              <div className="lp-hero-stats">
                <div className="s glass"><div className="n">5 tools</div><div className="l">for common broker tasks</div></div>
                <div className="s glass"><div className="n">Recorded</div><div className="l">sources and activity</div></div>
                <div className="s glass"><div className="n">CMS data</div><div className="l">from the current snapshot</div></div>
              </div>
            </div>

            {/* agent-flow motif */}
            <div className="flowcard glass-panel" id="system">
              <div className="fc-head">
                <span className="fc-title">Request lifecycle</span>
              </div>
              <svg viewBox="0 0 460 360" role="img" aria-label="A client request is routed to focused tools and recorded in an activity log.">
                <path className="flow-path" d="M120 64 C 180 64, 180 120, 230 120" />
                <path className="flow-dash" d="M120 64 C 180 64, 180 120, 230 120" />
                <path className="flow-path" d="M340 120 C 380 120, 380 175, 410 175" />
                <path className="flow-path" d="M230 140 C 150 150, 120 175, 120 185" />
                <path className="flow-path" d="M230 140 C 200 175, 210 175, 215 185" />
                <path className="flow-path" d="M286 140 C 300 175, 305 175, 312 185" />
                <path className="flow-dash" d="M230 140 C 150 150, 120 175, 120 185" />
                <path className="flow-dash" d="M286 140 C 300 175, 305 175, 312 185" />
                <path className="flow-path" d="M120 235 C 120 270, 200 280, 230 290" />
                <path className="flow-path" d="M215 235 C 230 270, 230 280, 230 290" />
                <path className="flow-path" d="M312 235 C 312 270, 260 280, 230 290" />
                <path className="flow-dash" d="M215 235 C 230 270, 230 280, 230 290" />
                <g>
                  <rect className="flow-rect" x="20" y="44" width="100" height="40" rx="8" />
                  <text className="flow-node-label" x="38" y="62">Request</text>
                  <text className="flow-node-sub" x="38" y="75">client intake</text>
                </g>
                <g>
                  <rect className="flow-rect accent" x="230" y="100" width="110" height="44" rx="8" />
                  <text className="flow-node-label" x="246" y="120">Router</text>
                  <text className="flow-node-sub" x="246" y="133">chooses a tool</text>
                </g>
                <g>
                  <rect className="flow-rect" x="70" y="185" width="100" height="50" rx="8" />
                  <text className="flow-node-label" x="84" y="206">Compare</text>
                  <text className="flow-node-sub" x="84" y="219">plan ranking</text>
                </g>
                <g>
                  <rect className="flow-rect" x="178" y="185" width="74" height="50" rx="8" />
                  <text className="flow-node-label" x="190" y="206">Explain</text>
                  <text className="flow-node-sub" x="190" y="219">benefits</text>
                </g>
                <g>
                  <rect className="flow-rect" x="262" y="185" width="100" height="50" rx="8" />
                  <text className="flow-node-label" x="276" y="206">Plan</text>
                  <text className="flow-node-sub" x="276" y="219">deadlines</text>
                </g>
                <g>
                  <rect className="flow-rect" x="380" y="155" width="70" height="40" rx="8" />
                  <text className="flow-node-label" x="392" y="173">Check</text>
                  <text className="flow-node-sub" x="392" y="186">network</text>
                </g>
                <g>
                  <rect className="flow-rect" x="120" y="290" width="220" height="46" rx="8" />
                  <text className="flow-node-label" x="138" y="311">Activity record</text>
                  <text className="flow-node-sub" x="138" y="324">source, timestamp, outcome</text>
                  <circle className="flow-dot-pulse" cx="322" cy="313" r="3" />
                </g>
              </svg>
            </div>
          </div>
        </div>
      </header>

      {/* ================= TRUST STRIP ================= */}
      <div className="lp-trust">
        <div className="lp-trust-inner glass">
          <span className="lbl">Uses</span>
          <div className="marks">
            <span className="mark">CMS plan data</span>
            <span className="mark">FDA drug data</span>
            <span className="mark">NPPES provider data</span>
          </div>
        </div>
      </div>

      {/* ================= PROBLEM ================= */}
      <section className="lp-section lp-problem">
        <div className="lp-wrap">
          <div className="sec-marker reveal">Why records matter</div>
          <div className="lp-problem-grid">
            <blockquote className="quote reveal">
              Coverage decisions depend on plan terms, provider networks, medications, and deadlines.
            </blockquote>
            <div className="body reveal">
              <p>Plan details can change each year, and provider or formulary information may require confirmation before enrollment.</p>
              <p>HealthFlow brings common comparison and documentation tasks into one workspace. It keeps the source and timestamp with each result so brokers can review the basis for a decision later.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= AGENT SYSTEM ================= */}
      <section className="lp-section" id="agents">
        <div className="lp-wrap">
          <div className="sec-marker reveal">Tools</div>
          <h2 className="sec-title reveal">Five focused tools for common broker tasks.</h2>
          <p className="sec-lead reveal">Choose a task, add the relevant client details, and review the result with its source information.</p>

          <div className="agents-grid reveal">
            <div className="agent-tabs glass-panel">
              {AGENTS.map((ag) => (
                <button
                  key={ag.key}
                  className={`agent-tab ${ag.key === active ? 'on' : ''}`}
                  onClick={() => setActive(ag.key)}
                >
                  <span className="ti">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={ag.icon} /></svg>
                  </span>
                  <span>
                    <span className="tt">{ag.title}</span>
                    <span className="td">{ag.tab}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="agent-panel glass-panel" key={active}>
              <div className="ap-eyebrow">Selected tool</div>
              <div className="ap-title">{a.title}</div>
              <div className="ap-desc">{a.desc}</div>
              <div className="ap-io">
                <div className="io-box">
                  <div className="io-lbl">{a.inLbl}</div>
                  <IoRows rows={a.in} />
                </div>
                <div className="arrow">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                </div>
                <div className="io-box">
                  <div className="io-lbl">{a.outLbl}</div>
                  <IoRows rows={a.out} />
                </div>
              </div>
              <div className="ap-foot">
                {a.chips.map((c) => <span className="ap-chip" key={c}>{c}</span>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= REGULATED ENVIRONMENTS ================= */}
      <section className="lp-section lp-reg" id="regulated">
        <div className="lp-wrap">
          <div className="sec-marker reveal">Records and privacy</div>
          <h2 className="sec-title reveal">Keep the information behind each result.</h2>
          <p className="sec-lead reveal">HealthFlow records source details and limits the client information used for each task.</p>

          <div className="reg-grid">
            <div className="reg-card glass-panel reveal">
              <div className="rc-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>
              </div>
              <div className="rc-title">Activity records</div>
              <div className="rc-desc">Each completed task records its source, timestamp, and outcome for later review.</div>
              <div className="rc-demo">
                <div className="audit-row"><span className="ts">09:42</span><span className="ev">Comparison recorded</span></div>
                <div className="audit-row"><span className="ts">Source</span><span className="ev">CMS snapshot</span></div>
                <div className="audit-row"><span className="ts">Result</span><span className="ev">Recommendation saved</span></div>
              </div>
            </div>

            <div className="reg-card glass-panel reveal">
              <div className="rc-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
              </div>
              <div className="rc-title">Personal information controls</div>
              <div className="rc-desc">The workspace limits and masks identifiers before a task is processed. Only details needed for the task are included.</div>
              <div className="rc-demo">
                <div className="phi-line"><span className="k">Member</span><span className="phi-mask">Masked</span></div>
                <div className="phi-line"><span className="k">Medicare ID</span><span className="phi-mask">Masked</span></div>
                <div className="phi-line"><span className="k">Medical details</span><span className="ok">Included when needed</span></div>
              </div>
            </div>

            <div className="reg-card glass-panel reveal">
              <div className="rc-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </div>
              <div className="rc-title">Separate agency data</div>
              <div className="rc-desc">Agency workspaces use separate data boundaries and access controls.</div>
              <div className="rc-demo">
                <div className="tenant-row"><span className="box">Kamara Benefits</span><span className="lock">Separate workspace</span></div>
                <div className="tenant-row"><span className="box">Atlas Advisors</span><span className="lock">Separate workspace</span></div>
                <div className="tenant-row"><span className="box" style={{ opacity: 0.5 }}>Cross-agency access</span><span style={{ color: 'oklch(0.6 0.12 25)' }}>Blocked</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= HOW IT WORKS ================= */}
      <section className="lp-section" id="how">
        <div className="lp-wrap">
          <div className="sec-marker reveal">How it works</div>
          <h2 className="sec-title reveal">From client details to a recorded result.</h2>
          <div className="steps reveal">
            <div className="step glass-panel">
              <div className="sn">1</div>
              <div className="st">Intake</div>
              <div className="sd">Enter medications, providers, and budget once. Only information needed for the task is sent.</div>
            </div>
            <div className="step glass-panel">
              <div className="sn">2</div>
              <div className="st">Choose a tool</div>
              <div className="sd">HealthFlow sends the request to the right tool and records the data source used.</div>
            </div>
            <div className="step glass-panel">
              <div className="sn">3</div>
              <div className="st">Review</div>
              <div className="sd">Compare plans, explain benefits, or create a deadline plan.</div>
            </div>
            <div className="step glass-panel">
              <div className="sn">4</div>
              <div className="st">Save</div>
              <div className="sd">The result, source, and timestamp are saved for later review.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= DEMO ================= */}
      <section className="lp-section lp-demo" id="demo">
        <div className="lp-wrap">
          <div className="sec-marker reveal">Product demo</div>
          <h2 className="sec-title reveal">See HealthFlow in use.</h2>
          <p className="sec-lead reveal">A short walkthrough from client intake to a plan comparison, benefit answer, and saved activity record.</p>

          <DemoVideoFrame />
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section className="lp-cta">
        <div className="lp-wrap">
          <div className="lp-cta-glass glass-panel">
            <div className="k reveal">For independent Medicare brokers and agencies</div>
            <h2 className="reveal">Compare plans and document each result.</h2>
            <p className="sub reveal">Create a workspace to compare plans and document results.</p>
            <div className="actions reveal">
              <Link className="lp-btn lg" to="/login?mode=register">
                Request access {ARROW_LG}
              </Link>
              <Link className="lp-btn ghost lg" to="/login">Explore the workspace</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-grid glass">
            <div className="fcol fbrand">
              <div className="lp-logo">
                <BrandLogo size={28} className="mk" />
                <BrandWordmark className="wm" />
              </div>
              <p>Tools for Medicare plan comparisons, benefit questions, deadlines, and appeals.</p>
            </div>
            <div className="fcol">
              <h4>Product</h4>
              <a href="#agents" onClick={(e) => scrollToId(e, 'agents')}>Tools</a>
              <a href="#regulated" onClick={(e) => scrollToId(e, 'regulated')}>Records and privacy</a>
              <a href="#how" onClick={(e) => scrollToId(e, 'how')}>How it works</a>
              <Link to="/login">Workspace</Link>
            </div>
            <div className="fcol">
              <h4>Company</h4>
              <a href="https://github.com/saikamara59/health-insurance-agent" target="_blank" rel="noreferrer">About</a>
              <a href="#regulated" onClick={(e) => scrollToId(e, 'regulated')}>Security</a>
              <a href="mailto:mhsaidu@gmail.com">Contact</a>
            </div>
            <div className="fcol">
              <h4>Legal</h4>
              <a href="#regulated" onClick={(e) => scrollToId(e, 'regulated')}>Security overview</a>
              <a href="https://healthflow.work" target="_blank" rel="noreferrer">Status</a>
            </div>
          </div>
          <div className="lp-footer-base">
            <span>© 2026 HealthFlow. Built by Saidu Kamara. Not affiliated with CMS or Medicare.</span>
            <div className="legal">
              <a href="https://github.com/saikamara59/health-insurance-agent" target="_blank" rel="noreferrer">GitHub</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
