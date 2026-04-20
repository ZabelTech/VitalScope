import { Link } from "react-router-dom";

interface HeroPageProps {
  onLoginClick?: () => void;
}

export function HeroPage({ onLoginClick }: HeroPageProps) {
  return (
    <div className="hero-page">
      <section className="hero-fold">
        <div className="hero-eyebrow">Signal depth · Self-hosted · Sovereign AI</div>
        <h1 className="hero-headline">
          The fastest loop wins.<br />
          <span className="hero-headline-accent">every.single.time.</span>
        </h1>
        <p className="hero-lead">
          Colonel John Boyd beat every student at Nellis Air Force Base in under forty seconds
          — not by flying faster, but by cycling his model of the fight faster than his opponent
          could hold one. That insight turns inward on the only moving, adversarial system you
          can't afford to lose: yours. Your physiology never pauses, never stabilises, never
          waits for your decisions to catch up — yet you optimise it with readings from
          yesterday, bloodwork from six months ago, and reference ranges calibrated against a
          population that isn't you. What
          you need is <strong>signal depth</strong>: how much of your own biology you can
          resolve at any given moment, and how fast your model of it drifts out of date. This
          is the loop that builds it — and keeps it yours.
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
              Two aircraft locked into a high-stakes death dance at a combined closing speed above
              1,000 mph. The enemy's position from three seconds ago is irrelevant — they've
              already altered heading, bled energy, and rolled out of your firing cone. If you
              shoot at where your mental model says they <em>should</em> be, you miss clean.
            </p>
            <p>
              The pilot flying on stale data isn't just
              inaccurate; they're acting on a world that has already ceased to exist.
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
        <div className="hero-clinical-callout">
          <p>
            Boyd spent the next three decades formalising that single insight into
            <em> Patterns of Conflict</em> — the briefing that reshaped how the US military
            thought about adaptation rate, manoeuvre, and why the side that cycles faster almost
            always wins.
          </p>
          <p>
            His claim wasn't that you need more data. It's that you need to cycle your observation
            and orientation faster than the world around you changes. In the cockpit that's
            measured in seconds. In your biology it's days and weeks. The principle is the same
            either way: whoever holds the more current, more accurate model of reality wins.
          </p>
        </div>
      </section>

      <section className="hero-section hero-ooda">
        <div className="hero-section-label">The Framework</div>
        <h2>Observe. Orient. Decide. Act. Boyd's loop — turned inward.</h2>
        <p className="hero-section-body">
          The OODA loop is the fastest decision cycle ever built for moving, adversarial systems under uncertainty.
          Your physiology is exactly that: it never stops, it never stabilises, and
          every intervention arrives into a state that's already different from the one it was
          designed for.
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
            <p>Orient engine on. Cross-domain pattern recognition. AI correlates your HRV trend with training load and sleep debt — telling you what the data actually means for you specifically.</p>
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
        <div className="hero-section-label">The Orient Engine</div>
        <h2>Observation is cheap. Orientation is where champions are made — and where AI earns its keep.</h2>
        <p className="hero-section-body">
          Most health apps stop at observation — they show you the data and leave interpretation to
          you. VitalScope goes further. The Orient phase is cognitive: it interprets, correlates,
          and contextualizes your signals across every domain simultaneously. No human analyst can
          do this in real time. Your <strong>orient engine</strong> — an AI trained on the
          biomedical literature, pointed at your longitudinal canvas, cycling across your full
          record the moment you ask — can. It's connected to the sum of human knowledge, has an
          unlimited attention span, and never sleeps.
        </p>
        <p className="hero-section-body">
          <strong>And before any of that — pain-free manual data entry.</strong> Manual tracking is
          why most quantified-self projects die on day eleven: nobody has the patience to transcribe
          a five-page lab report, tag every macro on a plate, or hand-type variant IDs out of a
          23andMe export. VitalScope inverts that entire loop. You snap, upload, or paste — and the
          AI does the typing. Lab PDFs, meal photos, raw genome files, supplement labels, form-check
          clips — ingested, structured, and filed into the right table without you keying a single
          value. The friction that kills every other tracker is where VitalScope's AI earns its
          keep first; the cards below are what it does <em>after</em> that friction is gone.
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
            <div className="hero-ai-card-title">DNA Sequencing Analysis</div>
            <p>Upload your raw genome file. AI maps your variants against performance, nutrition, recovery, and metabolic pathways — translating genetic data into context that makes every other metric in your dashboard make sense.</p>
          </div>
          <div className="hero-ai-card">
            <div className="hero-ai-card-title">Cognition &amp; Mental Performance</div>
            <p><em>Mens sana in corpore sano</em> — Juvenal's line encodes the truth that mind and body are one system. Journal focus, mood, reaction time, and cognitive load alongside the physiology driving them, and let the AI surface which sleep architectures, training blocks, supplements, and nutritional choices actually lift your mental performance — not just your biomarkers.</p>
          </div>
          <div className="hero-ai-card">
            <div className="hero-ai-card-title">Cross-Domain Correlation</div>
            <p>Why did your HRV crash this week? Sleep quality, nutrition timing, training load, and stress scores analyzed together surface the signal that single-domain apps can never see.</p>
          </div>
        </div>
        <p className="hero-ai-footnote">
          Choose your agent — Claude, GPT, or a locally-hosted alternative. Bring your own provider, pay only what you actually use. No subscription tax bundled into a tier you didn't ask for.
        </p>
      </section>

      <section className="hero-section hero-sources">
        <div className="hero-section-label">The Longitudinal Canvas</div>
        <h2>Every sensor. One canvas. Infinite correlation.</h2>
        <p className="hero-section-body">
          The more data streams you combine, the more the hidden patterns emerge.
          VitalScope syncs from the platforms you already use — continuously, incrementally, silently —
          into a single local database that you own outright. No middleman. No cloud sync tax.
        </p>
        <div className="hero-sources-grid">
          <div className="hero-source-card">
            <div className="hero-source-name">Continuous Physiology</div>
            <p>The heart rate, HRV, sleep architecture, stress, body battery, and training output your wearable records whether you're paying attention or not — re-fetched every sync, because last night's biology is still being written at the moment you ask about it.</p>
          </div>
          <div className="hero-source-card">
            <div className="hero-source-name">Training Load</div>
            <p>The one intervention whose dose you have complete control over. Every working set, rep, and load resolves into a longitudinal curve — progressive overload, weekly volume, density across every movement pattern — never inflated by rest-timer rows pretending to be work.</p>
          </div>
          <div className="hero-source-card">
            <div className="hero-source-name">Body Composition</div>
            <p>The slowest-to-lie output variable. One weight reading is a number; hundreds of weight, body-fat, lean-mass, and visceral-fat readings correlated against training load and nutrition is a signal — and the signal is what tells you whether what you're doing is actually working. Paired with a longitudinal visual record the AI stitches from progress photos, so the numbers and the mirror finally tell the same story.</p>
          </div>
          <div className="hero-source-card">
            <div className="hero-source-name">The Levers You Pull Yourself</div>
            <p>The causal variables nobody else can log for you: meals, supplements, peptide protocols, PED regimens, water, bloodwork panels, and a daily journal that captures what you felt and what you noticed. Your wearable reports the output; this is where you record the input.</p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-plugins">
        <div className="hero-section-label">Extensible by Design</div>
        <h2>Nothing hardwired. Nothing locked. Nothing waiting for a product manager.</h2>
        <p className="hero-section-body">
          The connectors ship as small, independent modules — one per source, each doing one
          job. What's included is obvious: wearables, gym trackers, scales, lab uploads. What's
          missing is yours to write, fork, or adapt from someone else's. The architecture
          doesn't decide what you're allowed to measure.
        </p>
        <div className="hero-plugins-grid">
          <div className="hero-plugin-card">
            <div className="hero-plugin-card-title">Bring Your Own Source</div>
            <p>Any platform that lets you export your data can be plugged in. New sources flow into the same dashboard, the same charts, and the same AI correlation engine as every built-in connector — no gatekeeper deciding which ones ship.</p>
          </div>
          <div className="hero-plugin-card">
            <div className="hero-plugin-card-title">Forked at the Forefront of Human Evolution</div>
            <p>Biohackers, longevity researchers, and quantified-self self-experimenters iterate protocols faster than any product roadmap can absorb them — CGM curves mapped to sleep onset, peptide stacks titrated against bloodwork, n=1 trials run on their own physiology. VitalScope is open source so they can run those experiments here. Fork the project, adapt its connectors, rewrite how the AI reasons, publish your variants back. The frontier of human performance isn't being shipped by a vendor — it's being iterated on by the people living at the edge of it.</p>
          </div>
        </div>
        <div className="hero-genomics-synthesis">
          <div className="hero-genomics-synthesis-label">The TL;DR</div>
          <p>
            Cathedral-model apps — one vendor, one roadmap, one subscription, one permitted
            way of thinking — are monopoly plays. The bazaar gets further, and it gets there
            faster: fork the code, run your own instance, write the plugin before a product
            manager at a Big Health vendor decides they want to. Self-host the whole stack on
            hardware that outlives whatever platform gets acquired, bankrupted, or pivoted to
            B2B in the next funding cycle. The people who build their own stay free when the
            vendors collapse; the people who rent don't. This project exists for the first
            group — anyone who read <em>"if you're not paying, you're the product"</em> and
            decided to do something about it. Your physiology is too interesting to outsource
            to doctors and academics working from decades-old knowledge under arbitrary
            regulations.
          </p>
        </div>
      </section>

      <section className="hero-section hero-genomics">
        <div className="hero-section-label">The Missing Layer</div>
        <h2>Measurements tell you where you are. Your genome tells you why — and where you're predisposed to go.</h2>
        <p className="hero-section-body">
          Bloodwork and wearable data are phenotype — the live readout of your physiology right
          now. DNA sequencing is genotype — the blueprint you were born with. Most people treat
          their genome report as a one-time curiosity; VitalScope treats it as a permanent
          interpretive layer that makes every bloodwork panel, every HRV trend, and every
          performance plateau legible. When genotype and phenotype converge in the same
          dashboard, you stop playing statistical averages and start playing your actual hand.
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
            <div className="hero-genomics-card-title">Pharmacogenomics, Peptides &amp; PEDs</div>
            <p>CYP450 variants decide how fast you metabolise caffeine, supplements, peptide protocols, PED regimens, and medications — the difference between a therapeutic dose and an adverse reaction. When your stack and your metabolism profile live in the same system, you stop dosing blind.</p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-longevity">
        <div className="hero-section-label">The Compounding Outcome</div>
        <h2>Lifespan is a lagging indicator. Healthspan is the one you can actually move — and it compounds, silently, with every decision you make well or badly across every decade.</h2>
        <p className="hero-section-body">
          Longevity is not a feature on a dashboard. It is the cumulative result of every
          training block, every sleep cycle, every supplement, every peptide, every fasted
          window, and every inflammatory meal — integrated across decades. The goal isn't
          more years; it's what James Fries called the <em>compression of morbidity</em> —
          pushing sickness, decline, and frailty into the shortest possible window at the end
          of life while every decade before stays full-signal. Peter Attia frames it as
          Medicine 3.0, David Sinclair as information-theoretic ageing, Valter Longo as
          fasting-mimicking metabolic reset — three different vocabularies for the same
          underlying question: how fast am I ageing right now, which levers are actually
          decelerating that rate for <em>me</em>, and which ones am I pulling on fashion
          rather than evidence? VitalScope is the longitudinal canvas where those answers
          accrete.
        </p>
        <div className="hero-longevity-grid">
          <div className="hero-longevity-card hero-longevity-card--accent">
            <div className="hero-longevity-card-title">Biological Age, Not Chronological</div>
            <p>Epigenetic clocks (GrimAge, Horvath, PhenoAge, DunedinPACE), telomere length, ApoB, Lp(a), hs-CRP, fasting insulin, HOMA-IR, VO₂ max, grip strength — plus hemostasis markers (fibrinogen, D-dimer, PT/INR, homocysteine) for the silent clotting physiology that quietly underwrites stroke, MI, and thrombotic risk long before any symptom shows up. Log them as they come in from any lab and watch the trajectory — the number on your driver's license is a rounding error next to the number your methylation pattern is quietly writing.</p>
          </div>
          <div className="hero-longevity-card">
            <div className="hero-longevity-card-title">Intervention Protocols</div>
            <p>Rapamycin pulses. Metformin. NAD⁺ precursors. Senolytics. GLP-1 agonists. Hormesis — the calibrated dose of heat, cold, hypoxia, fasting, and Zone 2 that upregulates stress-response pathways instead of damaging them. Time-restricted eating. Protein cycling. Log dose, cadence, and window; correlate the protocol against the markers that actually moved. Stop running protocols on Twitter consensus.</p>
          </div>
          <div className="hero-longevity-card">
            <div className="hero-longevity-card-title">The Rate of Ageing, Not the Age</div>
            <p>DunedinPACE measures how many biological years you age per chronological year. A score below 1.0 is deceleration. The interventions that actually move that number are rare, individual, and dose-dependent — you find yours by measuring repeatedly against your own baseline, not by copying a podcast stack.</p>
          </div>
          <div className="hero-longevity-card">
            <div className="hero-longevity-card-title">Compound Interest on Biology</div>
            <p>Every sub-optimal night of sleep, every skipped Zone 2 session, every week of unresolved inflammation is a micro-payment on the ageing trajectory. Every well-executed one is a micro-deposit. The point isn't perfection — it's making the cumulative arithmetic visible so the curve, compounded across decades, is yours to shape.</p>
          </div>
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
        <div className="hero-section-label">Data Sovereignty</div>
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
          No hidden telemetry. No data broker handshake. No terms-of-service update that
          retroactively licenses your health history to somebody else's roadmap.
        </p>
        <div className="hero-privacy-grid">
          <div className="hero-privacy-card hero-privacy-card--highlight">
            <div className="hero-privacy-card-title">Self-Hosted by Default</div>
            <p>Runs on hardware you own — a Raspberry Pi, a home server, or any private box on your network. No third-party infrastructure required by design.</p>
          </div>
          <div className="hero-privacy-card">
            <div className="hero-privacy-card-title">Open Source, Fully Auditable</div>
            <p>Every line of code is public. No black-box telemetry. No obfuscated data collection. Fork it, audit it, modify it. Trust is earned through transparency, not marketing copy.</p>
          </div>
          <div className="hero-privacy-card">
            <div className="hero-privacy-card-title">Local AI Option</div>
            <p>Route AI analysis through a locally-hosted model. The most sensitive analysis — bloodwork, form assessment — never has to leave your own network.</p>
          </div>
          <div className="hero-privacy-card">
            <div className="hero-privacy-card-title">You Own the Exit</div>
            <p>Your data lives in a single portable file you own. Export to standard formats, open it with any tool, run your own analyses. No vendor lock-in. No export limits. No account deletion required to reclaim what was always yours.</p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-objections">
        <div className="hero-section-label">What You'll Hear</div>
        <h2>Three objections to everything on this page. They deserve honest answers.</h2>
        <p className="hero-section-body">
          A worldview worth holding has to survive its strongest critics. These are the three
          that come up most often — from thoughtful doctors, from reasonable skeptics, and from
          quantified-self converts who tried it and quit. Every one of them is partially right.
          None of them defeats the thesis.
        </p>
        <div className="hero-objections-grid">
          <div className="hero-objection-card">
            <div className="hero-objection-card-label">Objection</div>
            <div className="hero-objection-card-title">"Isn't this hypochondria with extra steps?"</div>
            <p className="hero-objection-card-body">
              Yes — tracking creates more moments of "something looks off." That's true, and
              it's the real version of the concern. The question is whether those moments net
              out positive or negative, and the asymmetry answers it: a false alarm costs
              thirty seconds of checking correlated data until the context dissolves it; a
              missed signal costs a pattern that's already run for months before any symptom
              surfaces. Hypochondria is alarm <em>without</em> resolution. This is vigilance
              <em>with</em> resolution. The compression-of-morbidity literature is clear that
              earlier, more granular observation buys decades of full-signal living — provided
              you have the correlated context to tell a false alarm from a real one. A
              single-metric app gives you alarm. An integrated dashboard turns it back into
              information — or confirms it was nothing and lets you go back to your day.
            </p>
          </div>
          <div className="hero-objection-card">
            <div className="hero-objection-card-label">Objection</div>
            <div className="hero-objection-card-title">"Doesn't quantification produce anxiety, not insight?"</div>
            <p className="hero-objection-card-body">
              It does — when you optimise a metric without understanding what it reports, chase
              the number instead of the physiology, or let every app treat every deviation as
              alarming. That failure mode is real, and it's the failure mode of closed,
              feature-limited dashboards that can't correlate one signal against another. A
              single HRV dip in isolation is anxiety. The same HRV dip correlated with last
              night's sleep, this week's training load, yesterday's alcohol, and your
              historical baseline is information. The fix for bad quantification isn't less
              quantification — it's <em>integrated</em> quantification.
            </p>
          </div>
          <div className="hero-objection-card">
            <div className="hero-objection-card-label">Objection</div>
            <div className="hero-objection-card-title">"Isn't n=1 just noise?"</div>
            <p className="hero-objection-card-body">
              A single n=1 data point is noise. A year of longitudinal n=1 data — with
              controlled protocol changes and clean correlation against intervention windows —
              is the highest-grade evidence that can exist about <em>you specifically</em>.
              Population studies are rigorous claims about populations; they're being offered
              as guidance to an individual they didn't sample, on a diet they didn't model, with
              a training history they didn't have, and a genome they never sequenced. Statistical
              power matters for claims about averages. Personal optimisation is a claim about
              one person. The evidence bar is different by design — and for you, personally,
              your own data is the only data that actually addresses the question.
            </p>
          </div>
        </div>
      </section>

      <section className="hero-section hero-final-cta">
        <h2>Close the loop.</h2>
        <p className="hero-section-body">
          Your physiology is generating signal every second. Right now most of it is lost to
          fragmented apps, siloed dashboards, and quarterly product updates nobody asked for.
          VitalScope captures it, connects it, and hands the picture back to the one person it
          belongs to — so every decision, across every decade, compounds into the longevity
          and healthspan you actually live through.
        </p>
        <div className="hero-creed">
          <div className="hero-creed-label">The Cycle</div>
          <ol className="hero-creed-list">
            <li>Observe continuously.</li>
            <li>Orient across domains.</li>
            <li>Decide from your own baseline.</li>
            <li>Act on today's instruments, not last quarter's.</li>
            <li>Own the canvas.</li>
            <li>Outlive the vendor.</li>
            <li>Build your signal depth.</li>
          </ol>
        </div>
        <p className="hero-section-body">
          Stop reading. Start observing.
        </p>
        <div className="hero-actions">
          {onLoginClick ? (
            <button className="hero-cta-primary" onClick={onLoginClick}>Begin the Cycle</button>
          ) : (
            <Link to="/" className="hero-cta-primary">Begin the Cycle</Link>
          )}
        </div>
      </section>
    </div>
  );
}
