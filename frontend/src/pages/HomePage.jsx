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
    key: 'compare', n: '01', icon: 'M21 3 3 21M9 3h12v12M15 21H3V9',
    title: 'Plan comparison', tab: 'Ranks plans against a client’s real meds & providers',
    desc: 'Weighs every available Medicare Advantage plan against the client’s prescriptions, doctors, and budget — then ranks by true annual cost, not sticker premium.',
    inLbl: 'Input', in: [['zip', '10025'], ['age', '67'], ['rx', '3 meds']],
    outLbl: 'Output', out: [['best', 'Aetna Prime'], ['est/yr', '$1,864'], ['fit', '96%']],
    chips: ['CMS 2026 filings', 'formulary-pinned', 'typed output'],
  },
  {
    key: 'translate', n: '02', icon: 'M5 8h14M7 5l5 6-5 6M13 13l4 8 4-8M15 17h8',
    title: 'Coverage translator', tab: 'Turns Summary-of-Benefits into plain English',
    desc: 'Answers benefit questions in plain language and cites the exact section it came from — so a broker never paraphrases a plan wrong.',
    inLbl: 'Asked', in: [['q', 'ER copay if admitted?']],
    outLbl: 'Answered', out: [['$120', 'waived if admitted'], ['cite', '§1.2 Emergency']],
    chips: ['section citations', 'no hallucinated benefits'],
  },
  {
    key: 'plan', n: '03', icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
    title: 'Temporal plan', tab: 'Turns a deadline into an ordered action list',
    desc: 'Takes an event — a denial, a life change, an enrollment window — and produces a dated, ordered action plan anchored to the real deadline.',
    inLbl: 'Event', in: [['type', 'SEP'], ['trigger', 'May 1']],
    outLbl: 'Plan', out: [['deadline', 'Jun 30'], ['actions', '5 steps'], ['urgency', 'high']],
    chips: ['date-anchored', 'owner-assigned'],
  },
  {
    key: 'verify', n: '04', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
    title: 'Network verify', tab: 'Confirms doctors & pharmacies are in-network',
    desc: 'Checks a client’s providers, hospitals, and pharmacies against a plan’s live network before enrollment — and re-checks when carriers publish changes.',
    inLbl: 'Checking', in: [['Dr. Patel', 'cardiology'], ['pharmacy', 'mail-order']],
    outLbl: 'Result', out: [['Dr. Patel', 'in-network ✓'], ['pharmacy', 'in-network ✓']],
    chips: ['re-checks on change', 'provider-level'],
  },
  {
    key: 'appeal', n: '05', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h3',
    title: 'Appeal drafter', tab: 'Drafts denial appeals with cited guidance',
    desc: 'Drafts a denial appeal from the denial letter and the plan’s own language, citing the relevant CMS guidance — ready for a broker to review and file.',
    inLbl: 'Denial', in: [['claim', 'cardiac cath'], ['carrier', 'Cigna']],
    outLbl: 'Draft', out: [['cites', 'LCD L33559'], ['status', 'ready to file']],
    chips: ['CMS-cited', 'human-reviewed'],
  },
];

function IoRows({ rows }) {
  return rows.map(([k, v], i) => (
    <div className="io-line" key={i}><span className="k">{k}</span> {v}</div>
  ));
}

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
            <a href="#system" onClick={(e) => scrollToId(e, 'system')}>System</a>
            <a href="#agents" onClick={(e) => scrollToId(e, 'agents')}>Agents</a>
            <a href="#regulated" onClick={(e) => scrollToId(e, 'regulated')}>Compliance</a>
            <a href="#demo" onClick={(e) => scrollToId(e, 'demo')}>Demo</a>
            <a href="#how" onClick={(e) => scrollToId(e, 'how')}>How it works</a>
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
              <span className="lp-eyebrow glass-chip"><span className="pulse"></span> Multi-agent · regulated by Saidu Kamara</span>
              <h1 className="lp-h1">Coverage advice you can <em>defend</em> — months later, under audit.</h1>
              <p className="lp-hero-sub">
                HealthFlow is the agent workspace Medicare brokers use to compare plans, translate dense
                benefits, and draft appeals — with an attributable, PHI-aware record under every recommendation.
              </p>
              <div className="lp-hero-actions">
                <Link className="lp-btn lg" to="/login?mode=register">
                  Request access {ARROW_LG}
                </Link>
                <a className="lp-btn ghost lg" href="#system" onClick={(e) => scrollToId(e, 'system')}>See the system</a>
              </div>
              <div className="lp-hero-stats">
                <div className="s glass"><div className="n">5 agents</div><div className="l">one orchestrated workflow</div></div>
                <div className="s glass"><div className="n">100%</div><div className="l">actions logged &amp; attributable</div></div>
                <div className="s glass"><div className="n">SOC 2 · HIPAA</div><div className="l">tenant-isolated by default</div></div>
              </div>
            </div>

            {/* agent-flow motif */}
            <div className="flowcard glass-panel" id="system">
              <div className="fc-head">
                <span className="fc-title">Request lifecycle</span>
              </div>
              <svg viewBox="0 0 460 360" role="img" aria-label="Agent flow: a client request is routed by an orchestrator to specialized agents and recorded in an immutable audit log.">
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
                  <text className="flow-node-label" x="38" y="62">REQUEST</text>
                  <text className="flow-node-sub" x="38" y="75">client intake</text>
                </g>
                <g>
                  <rect className="flow-rect accent" x="230" y="100" width="110" height="44" rx="8" />
                  <text className="flow-node-label" x="246" y="120">ORCHESTRATOR</text>
                  <text className="flow-node-sub" x="246" y="133">routes &amp; verifies</text>
                </g>
                <g>
                  <rect className="flow-rect" x="70" y="185" width="100" height="50" rx="8" />
                  <text className="flow-node-label" x="84" y="206">COMPARE</text>
                  <text className="flow-node-sub" x="84" y="219">plan ranking</text>
                </g>
                <g>
                  <rect className="flow-rect" x="178" y="185" width="74" height="50" rx="8" />
                  <text className="flow-node-label" x="190" y="206">TRANSLATE</text>
                  <text className="flow-node-sub" x="190" y="219">benefits</text>
                </g>
                <g>
                  <rect className="flow-rect" x="262" y="185" width="100" height="50" rx="8" />
                  <text className="flow-node-label" x="276" y="206">PLAN</text>
                  <text className="flow-node-sub" x="276" y="219">deadlines</text>
                </g>
                <g>
                  <rect className="flow-rect" x="380" y="155" width="70" height="40" rx="8" />
                  <text className="flow-node-label" x="392" y="173">VERIFY</text>
                  <text className="flow-node-sub" x="392" y="186">network</text>
                </g>
                <g>
                  <rect className="flow-rect" x="120" y="290" width="220" height="46" rx="8" />
                  <text className="flow-node-label" x="138" y="311">AUDIT LOG</text>
                  <text className="flow-node-sub" x="138" y="324">immutable · hashed · attributable</text>
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
          <span className="lbl">Reads from</span>
          <div className="marks">
            <span className="mark">Aetna</span>
            <span className="mark">Humana</span>
            <span className="mark">UnitedHealthcare</span>
            <span className="mark">CMS Plan Finder</span>
          </div>
          <div className="marks" style={{ marginLeft: 'auto' }}>
            <span className="badge">SOC 2 Type II</span>
            <span className="badge">HIPAA</span>
          </div>
        </div>
      </div>

      {/* ================= PROBLEM ================= */}
      <section className="lp-section lp-problem">
        <div className="lp-wrap">
          <div className="sec-marker reveal"><span className="idx">01</span> <span className="ln"></span> The problem</div>
          <div className="lp-problem-grid">
            <blockquote className="quote reveal">
              A broker advises a 67-year-old on the plan that won't bankrupt her if she gets sick. Then has to <em>defend that call</em> a year later.
            </blockquote>
            <div className="body reveal">
              <p>Medicare Advantage is a maze of formularies, networks, and deadlines that shift every plan year. The advice a broker gives is high-stakes — and increasingly, it's regulated.</p>
              <p>Most tools in this space are spreadsheets with a chat box bolted on. They produce an answer, then forget how they got there. When a denial gets appealed or a regulator asks <strong>"why this plan?"</strong> — there's nothing to point to.</p>
              <p>HealthFlow treats every recommendation as a <strong>compliance event</strong>: routed through specialized agents, grounded in live carrier data, and recorded so it holds up when it matters.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= AGENT SYSTEM ================= */}
      <section className="lp-section" id="agents">
        <div className="lp-wrap">
          <div className="sec-marker reveal"><span className="idx">02</span> <span className="ln"></span> The agent system</div>
          <h2 className="sec-title reveal">Five specialized agents. One orchestrated workflow.</h2>
          <p className="sec-lead reveal">Each agent does one job well and hands off through the orchestrator — not a single model guessing at everything. Every input and output is typed, grounded, and logged.</p>

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
                  <span className="num">{ag.n}</span>
                </button>
              ))}
            </div>
            <div className="agent-panel glass-panel" key={active}>
              <div className="ap-eyebrow">Agent {a.n}</div>
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
          <div className="sec-marker reveal"><span className="idx">03</span> <span className="ln"></span> Built for regulated environments</div>
          <h2 className="sec-title reveal">The part most AI tools skip.</h2>
          <p className="sec-lead reveal">PHI doesn't tolerate "move fast and break things." The architecture is the product: forensic logging, data minimization, and hard tenant boundaries — not features bolted on after a breach.</p>

          <div className="reg-grid">
            <div className="reg-card glass-panel reveal">
              <div className="rc-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>
              </div>
              <div className="rc-title">Audit-grade forensics</div>
              <div className="rc-desc">Every agent action is appended to an immutable, hash-chained log — who, what, which data version, and why. Reconstruct any recommendation, exactly, on demand.</div>
              <div className="rc-demo">
                <div className="audit-row"><span className="ts">09:42:07</span><span className="ev">compare.run <span className="hash">#a3f… signed</span></span></div>
                <div className="audit-row"><span className="ts">09:42:07</span><span className="ev">formulary@2026.4 pinned</span></div>
                <div className="audit-row"><span className="ts">09:42:09</span><span className="ev">rec emitted <span className="hash">#b1c… by SK</span></span></div>
              </div>
            </div>

            <div className="reg-card glass-panel reveal">
              <div className="rc-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
              </div>
              <div className="rc-title">PHI-conscious by default</div>
              <div className="rc-desc">Identifiers are minimized and masked before they reach a model. Agents reason over the clinical shape of a case — not the patient's name, ID, or address.</div>
              <div className="rc-demo">
                <div className="phi-line"><span className="k">member</span><span className="phi-mask">▮▮▮▮▮▮▮▮</span></div>
                <div className="phi-line"><span className="k">medicare_id</span><span className="phi-mask">1EG4-▮▮▮-▮▮72</span></div>
                <div className="phi-line"><span className="k">conditions</span><span className="ok">visible to agent ✓</span></div>
              </div>
            </div>

            <div className="reg-card glass-panel reveal">
              <div className="rc-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </div>
              <div className="rc-title">Hard tenant isolation</div>
              <div className="rc-desc">Every agency's data lives behind its own boundary — separate keys, separate stores, no shared context window. One broker's book can never leak into another's.</div>
              <div className="rc-demo">
                <div className="tenant-row"><span className="box">tenant: kamara-benefits</span><span className="lock">🔒</span></div>
                <div className="tenant-row"><span className="box">tenant: atlas-advisors</span><span className="lock">🔒</span></div>
                <div className="tenant-row"><span className="box" style={{ opacity: 0.5 }}>cross-tenant read</span><span style={{ color: 'oklch(0.6 0.12 25)' }}>denied</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= HOW IT WORKS ================= */}
      <section className="lp-section" id="how">
        <div className="lp-wrap">
          <div className="sec-marker reveal"><span className="idx">04</span> <span className="ln"></span> How it works</div>
          <h2 className="sec-title reveal">From a client's situation to a recommendation that holds up.</h2>
          <div className="steps reveal">
            <div className="step glass-panel">
              <div className="sn">01</div>
              <div className="st">Intake</div>
              <div className="sd">A client's meds, providers, and budget enter once. PHI is minimized at the door.</div>
            </div>
            <div className="step glass-panel">
              <div className="sn">02</div>
              <div className="st">Orchestrate</div>
              <div className="sd">The orchestrator routes the case to the agents it needs and pins the live data versions.</div>
            </div>
            <div className="step glass-panel">
              <div className="sn">03</div>
              <div className="st">Reason</div>
              <div className="sd">Agents compare plans, translate benefits, and surface deadlines — each output grounded and typed.</div>
            </div>
            <div className="step glass-panel">
              <div className="sn">04</div>
              <div className="st">Record</div>
              <div className="sd">The recommendation and its full lineage are signed into the audit log. Defensible later, by design.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= DEMO ================= */}
      <section className="lp-section lp-demo" id="demo">
        <div className="lp-wrap">
          <div className="sec-marker reveal"><span className="idx">05</span> <span className="ln"></span> See it in action</div>
          <h2 className="sec-title reveal">Watch a recommendation come together.</h2>
          <p className="sec-lead reveal">A short walkthrough — from a client's intake to a ranked plan, a plain-English benefit answer, and a signed entry in the audit log.</p>

          <figure className="video-frame glass-panel reveal">
            <div className="vf-chrome">
              <span className="vf-dot"></span><span className="vf-dot"></span><span className="vf-dot"></span>
              <span className="vf-url">app.healthflow.work — product demo</span>
            </div>
            <div className="vf-stage">
              <div className="vf-placeholder">
                <span className="vf-play">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                </span>
                <span className="vf-ph-title">Guided walkthrough — coming soon</span>
                <span className="vf-ph-desc">In the meantime, request access to explore the live workspace yourself.</span>
              </div>
            </div>
          </figure>
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section className="lp-cta">
        <div className="lp-wrap">
          <div className="lp-cta-glass glass-panel">
            <div className="k reveal">For independent Medicare brokers &amp; agencies</div>
            <h2 className="reveal">Give every recommendation a <em>paper trail.</em></h2>
            <p className="sub reveal">Set up your workspace in an afternoon. Bring your book; keep your license clean.</p>
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
              <p>Multi-agent infrastructure for health coverage decisions that have to hold up later.</p>
            </div>
            <div className="fcol">
              <h4>Product</h4>
              <a href="#agents" onClick={(e) => scrollToId(e, 'agents')}>Agents</a>
              <a href="#regulated" onClick={(e) => scrollToId(e, 'regulated')}>Compliance</a>
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
              <a href="#regulated" onClick={(e) => scrollToId(e, 'regulated')}>HIPAA notice</a>
              <a href="https://healthflow.work" target="_blank" rel="noreferrer">Status</a>
            </div>
          </div>
          <div className="lp-footer-base">
            <span>© 2026 HealthFlow — built by Saidu Kamara. Not affiliated with CMS or Medicare.</span>
            <div className="legal">
              <a href="https://github.com/saikamara59/health-insurance-agent" target="_blank" rel="noreferrer">GitHub</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
