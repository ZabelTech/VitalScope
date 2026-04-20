import { Link } from "react-router-dom";

interface MarketingPageProps {
  onLoginClick?: () => void;
}

export function MarketingPage({ onLoginClick }: MarketingPageProps) {
  return (
    <div className="marketing-page">
      <section className="mkt-fold">
        <div className="mkt-eyebrow">Signal depth · Self-hosted · Sovereign AI</div>
        <h1 className="mkt-headline">
          The fastest loop wins.<br />
          <span className="mkt-headline-accent">every.single.time.</span>
        </h1>
        <p className="mkt-subhead">
          Boyd's OODA loop, turned inward. Your physiology is the hardest optimisation problem of your life — VitalScope is the loop that tracks it, interprets it, and keeps the whole record yours. Performance today, healthspan tomorrow, longevity across every decade after.
        </p>
        <div className="mkt-actions">
          {onLoginClick ? (
            <button className="mkt-cta-primary" onClick={onLoginClick}>Begin the Cycle</button>
          ) : (
            <Link to="/" className="mkt-cta-primary">Begin the Cycle</Link>
          )}
          <Link to="/manifesto" className="mkt-cta-secondary">Read the manifesto →</Link>
        </div>
      </section>

      <section className="mkt-contrast">
        <div className="mkt-contrast-col mkt-contrast-col--broken">
          <div className="mkt-contrast-label">The broken way</div>
          <ul>
            <li>Fragmented apps, siloed data</li>
            <li>Readings from yesterday, bloodwork from last year</li>
            <li>Population averages — not you</li>
            <li>Someone else's server, someone else's roadmap</li>
          </ul>
        </div>
        <div className="mkt-contrast-col mkt-contrast-col--fixed">
          <div className="mkt-contrast-label">The loop</div>
          <ul>
            <li>One canvas. Every sensor.</li>
            <li>Cycled continuously. Interpreted live.</li>
            <li>Your own longitudinal baseline.</li>
            <li>Hardware you own. Code you can read.</li>
          </ul>
        </div>
      </section>

      <section className="mkt-ooda">
        <div className="mkt-section-label">How it works</div>
        <div className="mkt-ooda-flow">
          <div className="mkt-ooda-node">
            <div className="mkt-ooda-letter">O</div>
            <div className="mkt-ooda-name">Observe</div>
            <p>Every sensor, every sync, every morning.</p>
          </div>
          <div className="mkt-ooda-arrow">→</div>
          <div className="mkt-ooda-node mkt-ooda-node--ai">
            <div className="mkt-ooda-letter">O</div>
            <div className="mkt-ooda-name">Orient</div>
            <p>The orient engine correlates across every domain at once.</p>
          </div>
          <div className="mkt-ooda-arrow">→</div>
          <div className="mkt-ooda-node">
            <div className="mkt-ooda-letter">D</div>
            <div className="mkt-ooda-name">Decide</div>
            <p>You choose. VitalScope surfaces what you need to choose well.</p>
          </div>
          <div className="mkt-ooda-arrow">→</div>
          <div className="mkt-ooda-node">
            <div className="mkt-ooda-letter">A</div>
            <div className="mkt-ooda-name">Act</div>
            <p>Log the work. Close the loop. Start the next one.</p>
          </div>
        </div>
      </section>

      <section className="mkt-diff">
        <div className="mkt-diff-grid">
          <div className="mkt-diff-card">
            <div className="mkt-diff-title">Signal Depth</div>
            <p>How much of your own biology you can resolve right now — and how fast your model of it drifts out of date between readings. The product's core metric, and the one no closed dashboard will ever show you.</p>
          </div>
          <div className="mkt-diff-card">
            <div className="mkt-diff-title">The Orient Engine</div>
            <p>An AI trained on the biomedical literature, pointed at your longitudinal canvas, cycling across your full record the moment you ask. Claude, GPT, or a locally-hosted model — your choice, your account, no subscription tax.</p>
          </div>
          <div className="mkt-diff-card">
            <div className="mkt-diff-title">The Longitudinal Canvas</div>
            <p>Wearables, training load, bloodwork, nutrition, supplements, peptide protocols, genome — one file, one format, open-source and self-hosted. Every sensor and every intervention compounds into a record that outlives any vendor.</p>
          </div>
        </div>
      </section>

      <section className="mkt-creed-section">
        <div className="mkt-creed">
          <div className="mkt-creed-label">The Cycle</div>
          <ol className="mkt-creed-list">
            <li>Observe continuously.</li>
            <li>Orient across domains.</li>
            <li>Decide from your own baseline.</li>
            <li>Act on today's instruments, not last quarter's.</li>
            <li>Own the canvas.</li>
            <li>Outlive the vendor.</li>
            <li>Build your signal depth.</li>
          </ol>
        </div>
      </section>

      <section className="mkt-objections">
        <div className="mkt-section-label">What you'll hear</div>
        <div className="mkt-objections-list">
          <div className="mkt-objection">
            <div className="mkt-objection-q">"Isn't this hypochondria?"</div>
            <div className="mkt-objection-a">Hypochondria is alarm <em>without</em> resolution. This is vigilance <em>with</em> resolution.</div>
          </div>
          <div className="mkt-objection">
            <div className="mkt-objection-q">"Won't quantifying everything cause anxiety?"</div>
            <div className="mkt-objection-a">A single metric in isolation is anxiety. The same metric integrated with context is information.</div>
          </div>
          <div className="mkt-objection">
            <div className="mkt-objection-q">"Isn't n=1 just noise?"</div>
            <div className="mkt-objection-a">Population studies are rigorous claims about populations. Personal optimisation is a claim about one person — yours.</div>
          </div>
        </div>
      </section>

      <section className="mkt-final">
        <h2>Close the loop.</h2>
        <p className="mkt-final-tagline">Stop reading. Start observing.</p>
        <div className="mkt-actions">
          {onLoginClick ? (
            <button className="mkt-cta-primary" onClick={onLoginClick}>Begin the Cycle</button>
          ) : (
            <Link to="/" className="mkt-cta-primary">Begin the Cycle</Link>
          )}
          <Link to="/manifesto" className="mkt-cta-secondary">Read the full argument →</Link>
        </div>
      </section>
    </div>
  );
}
