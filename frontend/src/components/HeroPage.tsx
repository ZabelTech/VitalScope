import { Link } from "react-router-dom";

export function HeroPage() {
  return (
    <div className="hero-page">
      <section className="hero-fold">
        <div className="hero-eyebrow">Open-source · Self-hosted · AI-powered</div>
        <h1 className="hero-headline">
          Stop Optimizing Blind.<br />
          <span className="hero-headline-accent">Know Yourself at Signal Depth.</span>
        </h1>
        <p className="hero-lead">
          VitalScope unifies every biometric, every rep, every night of sleep into a single
          command center — then runs it through the OODA loop so you always know where you
          stand, what it means, and what to do next.
        </p>
        <div className="hero-actions">
          <Link to="/" className="hero-cta-primary">Enter Dashboard</Link>
          <a href="#problem" className="hero-cta-secondary">Why It Matters</a>
        </div>
      </section>

      <section id="problem" className="hero-section hero-problem">
        <div className="hero-section-label">The Broken Ecosystem</div>
        <h2>Your health data is fragmented, monetized, and stuck in the past.</h2>
        <p className="hero-section-body">
          You wear a fitness wearable. You log your lifts in a gym tracker. You weigh yourself every morning.
          But your wearable doesn't talk to your gym tracker. Your gym tracker doesn't talk to your smart scale.
          Your scale phones home to a server in Shenzhen. None of it gives you a
          complete picture — and none of it actually belongs to you.
        </p>
        <div className="hero-problem-grid">
          <div className="hero-problem-item">
            <div className="hero-problem-heading">Data Fragmentation</div>
            <p>Heart rate in one app. PRs in another. Body composition somewhere else. Insight nowhere.</p>
          </div>
          <div className="hero-problem-item">
            <div className="hero-problem-heading">Rigid, Inflexible Analysis</div>
            <p>Pre-baked charts for pre-baked questions. Can't ask your own. Can't correlate across domains. Can't query what the product managers didn't predict.</p>
          </div>
          <div className="hero-problem-item">
            <div className="hero-problem-heading">No Holistic View</div>
            <p>Sleep, stress, training load, nutrition, bloodwork — never in the same room at the same time. The full picture is invisible by design.</p>
          </div>
          <div className="hero-problem-item">
            <div className="hero-problem-heading">Static Plans, No Feedback Loop</div>
            <p>A PDF program written for a generic human, with zero feedback from your actual physiology. You adapt. Your plan doesn't. That gap is costing you results.</p>
          </div>
          <div className="hero-problem-item">
            <div className="hero-problem-heading">You Are the Product</div>
            <p>Fitness wearables, gym trackers, food trackers, smart scales. Your most intimate biological data — sold, licensed, and aggregated by corporations you'll never audit and can't hold accountable.</p>
          </div>
          <div className="hero-problem-item">
            <div className="hero-problem-heading">Walled Gardens</div>
            <p>Export features are an afterthought. Your longitudinal health record is held hostage by monthly subscriptions, proprietary formats, and deletion clauses buried in ToS updates.</p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-deadreckoning">
        <div className="hero-section-label">Why Stale Data Kills</div>
        <h2>Dead reckoning works in open ocean. In a dogfight — or inside your own biology — it gets you killed.</h2>
        <p className="hero-section-body">
          Dead reckoning is the practice of estimating your current position from a last known fix,
          advancing it using assumed speed and heading. For centuries it was the best sailors had.
          For a fighter pilot in a beyond-visual-range engagement, it is a death sentence.
        </p>
        <div className="hero-dr-scenario">
          <div className="hero-dr-column hero-dr-column--danger">
            <div className="hero-dr-column-label">Dead Reckoning in a Dogfight</div>
            <p>
              Two aircraft are engaged at a combined closing speed above 1,000 mph.
              The enemy's position from three seconds ago is irrelevant — they've already altered
              heading, bled energy, and rolled out of your firing cone. If you shoot at where
              your mental model says they <em>should</em> be, you miss clean. The 1–2 seconds
              it takes to correct that model is the window they need to lock a firing solution
              on you. You don't get a second chance to update the picture.
            </p>
            <p>
              Colonel John Boyd flew against every student at Nellis in under forty seconds — not
              because he was faster, but because he could cycle his situational model faster than
              his opponent could maintain theirs. The pilot flying on stale data wasn't just
              inaccurate; they were acting on a world that had already ceased to exist.
            </p>
          </div>
          <div className="hero-dr-column hero-dr-column--body">
            <div className="hero-dr-column-label">Dead Reckoning in Your Biology</div>
            <p>
              Your physiology is the same adversarial, non-linear system — with no pause button and
              no static state. Inflammation cascades in minutes. Hormonal feedback loops shift
              across hours. Autonomic nervous system tone changes breath to breath. The systems
              you are trying to optimise do not hold still while you deliberate.
            </p>
            <p>
              A training intensity block that ignores today's HRV because "the programme says so"
              is dead reckoning. A supplement stack built on a bloodwork panel from six months
              ago is dead reckoning. Nutrition targets derived from a population average rather
              than your own longitudinal response is dead reckoning. You are flying a
              high-performance system through an environment that updates constantly — using
              instruments that were read yesterday and maps drawn last quarter.
            </p>
            <p>
              That is not optimization. That is hope dressed up as a plan.
            </p>
          </div>
        </div>
        <div className="hero-dr-callout">
          <p>
            Boyd's insight was not that you need more data — it was that you need to cycle your
            observation and orientation faster than the environment changes. In the air, that is
            measured in seconds. In your biology, it is measured in days and weeks. The principle
            is identical: the pilot — or the athlete, or the person managing their own health —
            who holds a more current and more accurate model of reality wins every time.
          </p>
        </div>
      </section>

      <section className="hero-section hero-ooda">
        <div className="hero-section-label">The Framework</div>
        <h2>The OODA Loop: a cognitive framework built for adversarial environments — repurposed for the relentless optimization of you.</h2>
        <p className="hero-section-body">
          Developed by fighter pilot Colonel John Boyd, the OODA loop — Observe, Orient, Decide, Act —
          is the fastest decision-making framework ever conceived under uncertainty.
          Your physiology is a dynamic, adversarial system with no pause button. You need the same edge.
        </p>
        <div className="hero-ooda-grid">
          <div className="hero-ooda-node">
            <div className="hero-ooda-letter">O</div>
            <div className="hero-ooda-name">Observe</div>
            <p>Raw data in. Heart rate variability, resting HR, sleep architecture, body composition, training volume, bloodwork panels. Every sensor, every sync, every morning.</p>
          </div>
          <div className="hero-ooda-arrow">→</div>
          <div className="hero-ooda-node">
            <div className="hero-ooda-letter hero-ooda-letter--ai">O</div>
            <div className="hero-ooda-name">Orient</div>
            <p>Context engine on. Cross-domain pattern recognition. AI correlates your HRV trend with training load and sleep debt — telling you what the data actually means for you specifically.</p>
          </div>
          <div className="hero-ooda-arrow">→</div>
          <div className="hero-ooda-node">
            <div className="hero-ooda-letter">D</div>
            <div className="hero-ooda-name">Decide</div>
            <p>Options on the table. Push harder or back off? Adjust macros? Flag the bloodwork panel? You own the decision — VitalScope surfaces the intelligence to make it well.</p>
          </div>
          <div className="hero-ooda-arrow">→</div>
          <div className="hero-ooda-node">
            <div className="hero-ooda-letter">A</div>
            <div className="hero-ooda-name">Act</div>
            <p>Log the meal. Hit the workout. Check the supplements. Journal the day. Close the loop and start the next iteration — tighter, faster, better calibrated.</p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-ai">
        <div className="hero-section-label">AI-Powered Orient Phase</div>
        <h2>The Orient phase is where champions are made. AI makes yours superhuman.</h2>
        <p className="hero-section-body">
          Most health apps stop at observation — they show you the data and leave interpretation to you.
          VitalScope goes further. The Orient phase is cognitive: it interprets, correlates, and
          contextualizes your signals across every domain simultaneously. No human analyst can do
          this in real time. An AI can.
        </p>
        <div className="hero-ai-grid">
          <div className="hero-ai-card">
            <div className="hero-ai-card-title">Bloodwork Intelligence</div>
            <p>Upload a PDF lab report. The AI extracts every analyte, flags out-of-range markers, and contextualizes results against your longitudinal trends — not just generic population reference ranges.</p>
          </div>
          <div className="hero-ai-card">
            <div className="hero-ai-card-title">Meal Analysis</div>
            <p>Photograph your plate. AI identifies macros, micronutrients, and bioactives — then cross-references against your supplement stack and daily targets to surface real nutritional gaps.</p>
          </div>
          <div className="hero-ai-card">
            <div className="hero-ai-card-title">Form Assessment</div>
            <p>Record a lift. AI analyzes movement mechanics, flags technique drift under fatigue, and builds a longitudinal record of your form quality over weeks and months of training.</p>
          </div>
          <div className="hero-ai-card">
            <div className="hero-ai-card-title">Cross-Domain Correlation</div>
            <p>Why did your HRV crash this week? Sleep quality, nutrition timing, training load, and stress scores analyzed together surface the signal that single-domain apps can never see.</p>
          </div>
        </div>
        <p className="hero-ai-footnote">
          Works with Claude (Anthropic), GPT-4o (OpenAI), or any OpenRouter model. Your AI, your API key, your cost — not a subscription tax bundled into a tier you didn't ask for.
        </p>
      </section>

      <section className="hero-section hero-sources">
        <div className="hero-section-label">Unified Data Pipeline</div>
        <h2>Every sensor. One database. Infinite correlation.</h2>
        <p className="hero-section-body">
          The more data streams you combine, the more the hidden patterns emerge.
          VitalScope syncs from the platforms you already use — continuously, incrementally, silently —
          into a single local SQLite database that you own outright. No middleman. No cloud sync tax.
        </p>
        <div className="hero-sources-grid">
          <div className="hero-source-card">
            <div className="hero-source-name">Fitness Wearable</div>
            <div className="hero-source-metrics">
              Heart rate · HRV · Sleep architecture · Stress score · Body battery · Steps · VO2 max · Activities
            </div>
            <p>Continuous intraday time-series plus nightly summaries. Always re-fetches the last 48 hours because your overnight physiology is still being written at sync time.</p>
          </div>
          <div className="hero-source-card">
            <div className="hero-source-name">Gym Tracker</div>
            <div className="hero-source-metrics">
              Exercises · Sets · Reps · Weight · Volume load · PRs · Rest periods · Training density
            </div>
            <p>Every working set logged, never inflated by rest-timer rows. Progressive overload curves, weekly volume, and training density across every movement pattern in your history.</p>
          </div>
          <div className="hero-source-card">
            <div className="hero-source-name">Smart Scale</div>
            <div className="hero-source-metrics">
              Weight · Body fat % · Muscle mass · Bone mass · BMR · Visceral fat index
            </div>
            <p>Daily body composition snapshots correlated against training load and nutrition — so the number on the scale finally means something in context rather than noise.</p>
          </div>
          <div className="hero-source-card">
            <div className="hero-source-name">Manual Inputs</div>
            <div className="hero-source-metrics">
              Nutrition · Bloodwork · Supplements · Water intake · Daily journal · Form checks
            </div>
            <p>The data your wearables can't capture: what you ate, what you took, how you felt, what you noticed. Logged once, available for correlation forever.</p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-plugins">
        <div className="hero-section-label">Extensible by Design</div>
        <h2>Connect any data source. The plugin architecture was built for it.</h2>
        <p className="hero-section-body">
          VitalScope ships with connectors for the most popular health platforms,
          but the plugin system is open. Every data source is a self-contained plugin:
          a sync script that writes to SQLite plus a lightweight wrapper that schedules it,
          passes credentials, and records every run. Nothing hardwired. Nothing locked.
        </p>
        <div className="hero-plugins-grid">
          <div className="hero-plugin-card">
            <div className="hero-plugin-card-title">Bring Your Own Source</div>
            <p>Write a sync script for any platform with an API or data export. Implement two methods, register the plugin, and your new data source flows into the same dashboard, the same charts, and the same AI correlation engine as every built-in connector.</p>
          </div>
          <div className="hero-plugin-card">
            <div className="hero-plugin-card-title">Incremental by Default</div>
            <p>Every plugin fetches only new data on each run — querying the last recorded timestamp and syncing forward. Full resyncs are opt-in via a single flag. Your database stays lean and your syncs stay fast regardless of how many sources you've wired in.</p>
          </div>
          <div className="hero-plugin-card">
            <div className="hero-plugin-card-title">Scheduled & Audited</div>
            <p>The scheduler runs every registered plugin on its configured interval. Every run — success or failure — is recorded: what ran, when, how long, and what it returned. You always know the state of your data pipeline without having to check.</p>
          </div>
          <div className="hero-plugin-card">
            <div className="hero-plugin-card-title">Credentials You Control</div>
            <p>Plugin credentials live in environment variables, never in the database. Token caches stay on your own machine. Rotate a credential and the next sync picks it up automatically — no config files to hunt down, no dashboard UI to re-authorise.</p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-genomics">
        <div className="hero-section-label">The Missing Layer</div>
        <h2>Measurements tell you where you are. Your genome tells you why — and where you're predisposed to go.</h2>
        <p className="hero-section-body">
          Bloodwork and wearable data are phenotype: the live readout of your physiology right now.
          DNA sequencing is genotype: the blueprint you were born with. Neither is complete without the other.
          When you overlay genomic variants on top of continuous biometric data and lab panels,
          population averages stop mattering and your actual biology starts making sense.
        </p>
        <div className="hero-genomics-grid">
          <div className="hero-genomics-card hero-genomics-card--accent">
            <div className="hero-genomics-card-title">Outlier Bloodwork Explained</div>
            <p>Persistently elevated LDL despite a clean diet? APOE ε4 carriage changes the entire risk calculus. Chronically low B12 absorption? An MTHFR C677T variant may be why your methylation pathway runs inefficiently. Genomic context turns unexplained lab anomalies into actionable biology.</p>
          </div>
          <div className="hero-genomics-card">
            <div className="hero-genomics-card-title">Nutrigenomics: Eat for Your Genome</div>
            <p>VDR polymorphisms predict blunted vitamin D response — explaining why your 25(OH)D bloodwork stalls at suboptimal levels despite supplementation. FADS1/FADS2 variants govern omega-3 conversion efficiency, determining whether dietary ALA reaches EPA/DHA or dead-ends. Your macros are guesses until you know the variants that process them.</p>
          </div>
          <div className="hero-genomics-card">
            <div className="hero-genomics-card-title">Performance Genetics + Training Load</div>
            <p>ACTN3 R577X determines your ratio of fast-twitch to slow-twitch fibre expression — the genetic underpinning of whether your body is wired for power or endurance. Cross that against your actual training volume and HRV trends to stop programming against your own biology and start working with it.</p>
          </div>
          <div className="hero-genomics-card">
            <div className="hero-genomics-card-title">Inflammation &amp; Recovery Genetics</div>
            <p>CRP and IL-6 variants raise your baseline inflammatory tone — so a "normal" CRP reading for you may still be elevated relative to your own genetic floor. When your HRV dips after a hard week, knowing whether you carry high-inflammation genotypes tells you whether that's adaptation or a warning sign requiring a longer recovery window.</p>
          </div>
          <div className="hero-genomics-card">
            <div className="hero-genomics-card-title">Chronotype &amp; Sleep Architecture</div>
            <p>PER3 and CLOCK gene variants directly shape circadian period length and sleep pressure dynamics — the genetic reasons why your HRV and sleep stage data look different from the population charts. Stop optimising for an average chronotype when your genome encodes a specific one.</p>
          </div>
          <div className="hero-genomics-card">
            <div className="hero-genomics-card-title">Pharmacogenomics &amp; Supplements</div>
            <p>CYP450 enzyme variants determine how rapidly you metabolise caffeine, certain supplements, and medications — the difference between a therapeutic dose and an adverse reaction. When your supplement stack and your drug metabolism profile are in the same system, you stop dosing blind.</p>
          </div>
        </div>
        <div className="hero-genomics-synthesis">
          <div className="hero-genomics-synthesis-label">The Synthesis</div>
          <p>
            Most people treat their genome report as a one-time curiosity. VitalScope treats it as a permanent interpretive layer — the context engine that makes every bloodwork panel, every HRV trend, and every performance plateau legible. When genotype and phenotype converge in the same dashboard, you stop playing statistical averages and start playing your actual hand.
          </p>
        </div>
      </section>

      <section className="hero-section hero-responsibility">
        <div className="hero-section-label">Greater Power, Greater Responsibility</div>
        <h2>Unified biometric data is powerful. Handle it accordingly.</h2>
        <p className="hero-section-body">
          Combining heart rate variability, body composition, sleep architecture, bloodwork panels, and
          multi-year training history creates a profile of extraordinary sensitivity.
          This data, in the wrong hands or misread by the wrong mind, causes real harm.
        </p>
        <div className="hero-responsibility-grid">
          <div className="hero-responsibility-item">
            <div className="hero-responsibility-heading">Medical Decisions Stay With Clinicians</div>
            <p>VitalScope surfaces patterns and flags anomalies. It does not diagnose. Abnormal bloodwork means a conversation with a doctor — not a self-prescribed protocol from a forum thread.</p>
          </div>
          <div className="hero-responsibility-item">
            <div className="hero-responsibility-heading">Correlations Are Not Causation</div>
            <p>The AI identifies relationships in your data. It cannot prove cause and effect. Treat every AI insight as a hypothesis to test, not a conclusion to blindly act on.</p>
          </div>
          <div className="hero-responsibility-item">
            <div className="hero-responsibility-heading">Access Control Is Non-Negotiable</div>
            <p>Your instance must be behind authentication. If you self-host on a home server or VPS, your security posture must be commensurate with the sensitivity of what's inside.</p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-privacy">
        <div className="hero-section-label">Data Sovereignty</div>
        <h2>Your most intimate data belongs to exactly one person.</h2>
        <p className="hero-section-body">
          When you self-host VitalScope, your biometric profile never leaves your hardware.
          No cloud ingestion. No analytics pipeline. No data broker handshake.
          No terms-of-service update that retroactively licenses your health history to an insurance consortium.
        </p>
        <div className="hero-privacy-grid">
          <div className="hero-privacy-card hero-privacy-card--highlight">
            <div className="hero-privacy-card-title">Self-Hosted by Default</div>
            <p>One SQLite file. One Python backend. One Vite frontend. Deploy on a Raspberry Pi, a home server, or a private VPS. No third-party infrastructure required by design.</p>
          </div>
          <div className="hero-privacy-card">
            <div className="hero-privacy-card-title">Open Source, Fully Auditable</div>
            <p>Every line of code is public. No black-box telemetry. No obfuscated data collection. Fork it, audit it, modify it. Trust is earned through transparency, not marketing copy.</p>
          </div>
          <div className="hero-privacy-card">
            <div className="hero-privacy-card-title">Local AI Option</div>
            <p>Route AI analysis through Ollama or any OpenAI-compatible local model. The most sensitive analysis — bloodwork, form assessment — never has to leave your own network.</p>
          </div>
          <div className="hero-privacy-card">
            <div className="hero-privacy-card-title">You Own the Exit</div>
            <p>Your data is a SQLite file. Open it with any client. Export to CSV. Run your own queries. No vendor lock-in. No export limits. No account deletion required to reclaim what was always yours.</p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-final-cta">
        <h2>The loop is waiting.</h2>
        <p className="hero-section-body">
          Your physiology generates signal every second. Most of it is lost to fragmented apps,
          siloed dashboards, and quarterly software updates nobody asked for.
          VitalScope captures it, connects it, and puts you back in command.
        </p>
        <div className="hero-actions">
          <Link to="/" className="hero-cta-primary">Enter VitalScope</Link>
        </div>
      </section>
    </div>
  );
}
