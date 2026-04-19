import { Link } from "react-router-dom";

interface HeroPageProps {
  onLoginClick?: () => void;
}

export function HeroPage({ onLoginClick }: HeroPageProps) {
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
          {onLoginClick ? (
            <button className="hero-cta-primary" onClick={onLoginClick}>Sign In</button>
          ) : (
            <Link to="/" className="hero-cta-primary">Enter Dashboard</Link>
          )}
          <a href="#problem" className="hero-cta-secondary">Why It Matters</a>
        </div>
      </section>

      <section id="problem" className="hero-section hero-problem">
        <div className="hero-section-label">The Broken Ecosystem</div>
        <h2>Your health data is fragmented, monetised, and already out of date by the time you see it.</h2>
        <p className="hero-section-body">
          A wearable on your wrist. A gym tracker on your phone. A smart scale on the bathroom
          floor. A food log, a lab portal, a DNA report you haven't opened in a year. None of it
          talks. None of it adds up. And every byte of it lives on somebody else's server,
          answering to somebody else's roadmap.
        </p>
        <div className="hero-problem-grid">
          <div className="hero-problem-item">
            <div className="hero-problem-heading">Data Fragmentation</div>
            <p>Heart rate in one app. PRs in another. Body comp, bloodwork, DNA — each in its own silo. Signal everywhere. Insight nowhere.</p>
          </div>
          <div className="hero-problem-item">
            <div className="hero-problem-heading">Pre-Baked Analysis</div>
            <p>Fixed charts for fixed questions. No way to correlate across domains. No way to ask anything a product manager didn't already ship.</p>
          </div>
          <div className="hero-problem-item">
            <div className="hero-problem-heading">No Holistic View</div>
            <p>Sleep, stress, training load, nutrition, bloodwork — never in the same room at the same time. The full picture is invisible by design.</p>
          </div>
          <div className="hero-problem-item">
            <div className="hero-problem-heading">You Are the Product</div>
            <p>Your most intimate biological data — sold, licensed, aggregated, and walled behind subscriptions you stop paying the moment you want to export it.</p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-deadreckoning">
        <div className="hero-section-label">Why Stale Data Kills</div>
        <h2>Dead reckoning got ships across oceans. In a dogfight — or inside your own biology — it gets you killed.</h2>
        <p className="hero-section-body">
          Dead reckoning is navigation by assumption: a last known position, projected forward on
          guessed speed and heading. It kept sailors alive for centuries. It gets a fighter pilot
          locked onto before they finish the calculation.
        </p>
        <div className="hero-dr-scenario">
          <div className="hero-dr-column hero-dr-column--danger">
            <div className="hero-dr-column-label">Dead Reckoning in a Dogfight</div>
            <p>
              Two aircraft are engaged at a combined closing speed above 1,000 mph.
              The enemy's position from three seconds ago is irrelevant — they've already altered
              heading, bled energy, and rolled out of your firing cone. If you shoot at where
              your mental model says they <em>should</em> be, you miss clean.
            </p>
            <p>
              The pilot flying on stale data wasn't just
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
            Colonel John Boyd beat every student at Nellis Air Force Base in under forty seconds
            — not because he was faster, but because he could cycle his model of the fight faster
            than his opponent could maintain theirs.
          </p>
          <p>
            His insight wasn't that you need more data. It's that you need to cycle your
            observation and orientation faster than the world around you changes. In the cockpit
            that's measured in seconds. In your biology it's days and weeks. The principle is
            the same either way: whoever holds the more current, more accurate model of reality
            wins.
          </p>
        </div>
      </section>

      <section className="hero-section hero-ooda">
        <div className="hero-section-label">The Framework</div>
        <h2>Observe. Orient. Decide. Act. Boyd's loop — turned inward.</h2>
        <p className="hero-section-body">
          The OODA loop is the fastest decision cycle ever built for moving, adversarial systems.
          Your physiology is exactly that kind of system: it never stops, it never stabilises, and
          every intervention arrives into a state that's already different from the one it was
          designed for. VitalScope rebuilds the loop around you.
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
          this in real time. An AI can. It's connected to the sum of human knowledge, has an
          unlimited attention span, and never sleeps.
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
            <div className="hero-ai-card-title">Visual Assessment</div>
            <p>Photograph yourself. The AI analyses your appearance to assess visible physical indicators — estimated BMI, water retention, and other visually noticeable vitals — and builds a longitudinal record across weeks and months of tracking.</p>
          </div>
          <div className="hero-ai-card">
            <div className="hero-ai-card-title">DNA Sequencing Analysis</div>
            <p>Upload your raw genome file. AI maps your variants against performance, nutrition, recovery, and metabolic pathways — translating genetic data into context that makes every other metric in your dashboard make sense.</p>
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
            <p>Continuous intraday time-series plus nightly summaries. Always re-fetches recent data because your overnight physiology is still being written at sync time.</p>
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
          but the plugin system is open. Nothing hardwired. Nothing locked.
        </p>
        <div className="hero-plugins-grid">
          <div className="hero-plugin-card">
            <div className="hero-plugin-card-title">Bring Your Own Source</div>
            <p>Write a sync script for any platform with an API or data export. Implement two methods, register the plugin, and your new data source flows into the same dashboard, the same charts, and the same AI correlation engine as every built-in connector.</p>
          </div>
          <div className="hero-plugin-card">
            <div className="hero-plugin-card-title">Forked at the Forefront of Human Evolution</div>
            <p>Biohackers, longevity researchers, and quantified-self self-experimenters iterate protocols faster than any product roadmap can absorb them — CGM curves mapped to sleep onset, peptide stacks titrated against bloodwork, n=1 trials run on their own physiology. VitalScope is open source so they can run those experiments here. Fork the plugins, bend the schema, rewrite the AI prompts, publish variants back. The frontier of human performance isn't being shipped by a vendor — it's being iterated on by the people living at the edge of it.</p>
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
            <p>ACTN3 R577X determines your fast-twitch to slow-twitch fibre ratio — the genetic underpinning of whether you're wired for power or endurance. Cross it against your actual training volume and HRV trends and stop programming against your own biology.</p>
          </div>
          <div className="hero-genomics-card">
            <div className="hero-genomics-card-title">Pharmacogenomics &amp; Supplements</div>
            <p>CYP450 variants decide how fast you metabolise caffeine, supplements, and medications — the difference between a therapeutic dose and an adverse reaction. When your stack and your metabolism profile live in the same system, you stop dosing blind.</p>
          </div>
        </div>
        <div className="hero-genomics-synthesis">
          <div className="hero-genomics-synthesis-label">The Synthesis</div>
          <p>
            Most people treat their genome report as a one-time curiosity. VitalScope treats it as a permanent interpretive layer — the context engine that makes every bloodwork panel, every HRV trend, and every performance plateau legible. When genotype and phenotype converge in the same dashboard, you stop playing statistical averages and start playing your actual hand.
          </p>
        </div>
      </section>

      <section className="hero-section hero-clinical">
        <div className="hero-section-label">The Clinical Blind Spot</div>
        <h2>Clinical care was built to treat symptoms. It was not designed to track the continuous system that produces them.</h2>
        <p className="hero-section-body">
          The gap between your biology and your healthcare is structural — a consequence of how clinical
          infrastructure was architected, not a failure of any individual practitioner. Understanding
          that gap is the first step to filling it yourself.
        </p>
        <div className="hero-clinical-grid">
          <div className="hero-clinical-card">
            <div className="hero-clinical-card-title">Episodic by Design</div>
            <p>Ten minutes, once a year. That's one data point on a continuous time-series. Referral pathways, diagnostic thresholds, treatment protocols — all built around intervening after symptoms surface, not watching the system that produces them. By the time a pattern shows up on an annual snapshot, it's been running for months.</p>
          </div>
          <div className="hero-clinical-card">
            <div className="hero-clinical-card-title">Curricula Written for a Different Era</div>
            <p>Precision nutrition, HRV-guided periodisation, chronobiology, pharmacogenomics — the disciplines most relevant to proactive optimisation have matured faster than multi-decade curricula can absorb them. Not a failure of any practitioner. A structural lag in how the field trains.</p>
          </div>
          <div className="hero-clinical-card">
            <div className="hero-clinical-card-title">You Are Not the Population Average</div>
            <p>The reference ranges on your lab report are statistical distributions across a heterogeneous sample — not a calibration against your genetics, your training history, or your baseline. "Normal" means you're not an outlier. It says nothing about whether the result is optimal for <em>you</em>.</p>
          </div>
          <div className="hero-clinical-card">
            <div className="hero-clinical-card-title">The Knowledge Update Rate Problem</div>
            <p>Tens of thousands of biomedical papers publish every year across immunology, endocrinology, exercise physiology, and nutritional biochemistry. No human can stay current across all of them. An AI trained on the literature can — and surfaces cross-disciplinary connections no single specialist would stumble onto in a practice week.</p>
          </div>
        </div>
        <div className="hero-clinical-callout">
          <p>
            VitalScope is not a substitute for clinical expertise — it is what happens in the gap
            between appointments. Between the annual bloodwork panel and next year's review.
            Between the population reference range and your individual baseline. Between the
            discipline boundaries that clinical training draws and the cross-domain correlations
            your biology ignores entirely.
          </p>
        </div>
      </section>

      <section className="hero-section hero-privacy">
        <div className="hero-section-label">Great Power, Greater Responsibility: Data Sovereignty</div>
        <h2>No single stream is sensitive. Combined, they're a high-resolution portrait of you.</h2>
        <p className="hero-section-body">
          An HRV number on its own is noise. A page of lab ranges is noise. Your sleep curve,
          training log, body composition, and genome — each one is inert in isolation. Layer
          them on top of each other over months and years and the combined record becomes
          something else entirely: a longitudinal readout of your physiology, your habits, and
          your predisposition. The kind of asset insurers, employers, data brokers, and
          tomorrow's AI systems would pay real money to own.
        </p>
        <p className="hero-section-body">
          Most of that record ages out — last month's HRV is context, not liability. Your
          genome is the exception: it doesn't change, and it doesn't only describe you. Which
          is exactly why the only sane place to hold any of it is hardware you control.
          Self-hosted, your biometric profile never leaves your network. No cloud ingestion.
          No analytics pipeline. No data broker handshake. No terms-of-service update that
          retroactively licenses your health history to somebody else's roadmap.
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
        <h2>Close the loop.</h2>
        <p className="hero-section-body">
          Your physiology is generating signal every second. Right now most of it is lost to
          fragmented apps, siloed dashboards, and quarterly product updates nobody asked for.
          VitalScope captures it, connects it, and hands the picture back to the one person it
          belongs to.
        </p>
        <div className="hero-actions">
          {onLoginClick ? (
            <button className="hero-cta-primary" onClick={onLoginClick}>Sign In</button>
          ) : (
            <Link to="/" className="hero-cta-primary">Enter VitalScope</Link>
          )}
        </div>
      </section>
    </div>
  );
}
