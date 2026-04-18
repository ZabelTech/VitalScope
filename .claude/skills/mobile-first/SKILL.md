---
name: mobile-first
description: Apply this when writing or editing any frontend CSS, JSX/TSX, or layout code in /frontend. VitalScope is being retrofitted mobile-first, primary target iPhone Air (420×912 CSS px). Default to the mobile layout; scale up with min-width breakpoints. Aesthetic is slick and restrained — no bells and whistles.
---

# VitalScope mobile-first

Primary target is **iPhone Air (420 × 912 CSS px, DPR 3)**. The app must also look correct at:

- **375 × 667** (iPhone SE / smallest current iPhone) — no horizontal scroll, no truncation
- **768** (iPad portrait)
- **1200+** (desktop — current baseline, don't regress)

## Workflow rule

When touching any file under `frontend/src/`:

1. Start styles at the base (no media query). That's the **mobile** layout.
2. Add `@media (min-width: 640px)` to enhance for tablet.
3. Add `@media (min-width: 1024px)` to enhance for desktop.
4. Never use `max-width` media queries to "undo" desktop styles — that's desktop-first and backwards for this project.

## Breakpoints

```css
/* base — mobile (≤ 639px, including iPhone Air at 420) */
/* @media (min-width: 640px)  — tablet */
/* @media (min-width: 1024px) — desktop */
```

Don't invent new breakpoints without a concrete layout reason. If a component breaks *between* 640 and 1024, fix the component (fluid type, wrap, grid auto-fit) rather than adding a breakpoint.

## Rules that apply everywhere

- **Touch targets** are ≥ 44 × 44 CSS px (Apple HIG). Buttons, links, checkboxes, the plugin card toggle. Use `min-height: 44px` on interactive rows; don't rely on visual size alone — padding counts.
- **Spacing between touchable elements** ≥ 8px. Stacked checkboxes in `IntakeLog` and `SupplementsPage` need `gap: 12px` or more.
- **Form inputs**: `font-size: 16px` minimum — anything smaller triggers iOS auto-zoom on focus. Use `inputmode="numeric"` for number-like fields (dosage, minutes, ml, reps) to surface the numeric keypad without switching `type="number"` (which adds up/down spinners).
- **Viewport meta** in `frontend/index.html` needs `viewport-fit=cover` so we can honour Dynamic Island and home-indicator insets:
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  ```
- **Safe areas**: any element pinned to the top or bottom edge must add `env(safe-area-inset-*)`. The NavBar is top-pinned on mobile; the future bottom tab bar (if added) needs `padding-bottom: env(safe-area-inset-bottom)`.
- **Viewport height**: use `100dvh` (not `100vh`) whenever a full-height element depends on it. `100vh` on mobile Safari leaves a gap when the URL bar shows; `100dvh` adapts.
- **Fluid type**: body text is 16px, headings use `clamp()` so they scale without breakpoints. Example: `h2 { font-size: clamp(1.25rem, 1.1rem + 0.8vw, 1.75rem); }`.
- **No hover-only affordances**: `:hover` states are fine as an enhancement, but every interaction must work on tap. No tooltips that require hover to reveal information.
- **`prefers-reduced-motion`**: wrap any non-trivial transition in `@media (prefers-reduced-motion: no-preference)` or skip transitions entirely — this project already defaults to restraint.
- **Don't set `width: 1200px`** anywhere — use `max-width: 1200px` with `margin: 0 auto` and `padding: 0 clamp(16px, 4vw, 24px)` so mobile gets proper edge padding.

## VitalScope component-level guidance

### `App.tsx` / `.app` container

- Drop the fixed `padding: 24px`. Use `padding: env(safe-area-inset-top) clamp(16px, 4vw, 24px) env(safe-area-inset-bottom);`.
- `max-width: 1200px` stays.

### `NavBar` (`top-bar`)

- On mobile, the 4 OODA links + Settings won't fit in one row alongside the brand block. Options, pick one:
  - **Stack** — brand on line 1, nav on line 2 as a horizontally scrollable row (`overflow-x: auto; scroll-snap-type: x mandatory`). Simplest.
  - **Bottom tab bar** — position: fixed; bottom: 0 on mobile, reverts to top bar on `min-width: 640px`. Better ergonomics but more code.
- Hide the `navbar-tagline` below 640px — it's decorative.
- Increase link `padding` so tap targets clear 44px.

### `OodaPage` section nav

- The inline anchor row becomes a horizontally scrollable chip bar on mobile: `overflow-x: auto; flex-wrap: nowrap; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch`.
- Each chip: `min-height: 40px`, `padding: 8px 16px`, `flex-shrink: 0`.
- Consider `position: sticky; top: 0` with a solid background so sections stay navigable while scrolling.

### Charts (all `*Chart.tsx`)

- `ResponsiveContainer` height: **240px** default (mobile), bump to **300px** at `min-width: 640px`. Use a CSS variable on the wrapper div rather than hard-coding the prop.
- `XAxis` / `YAxis` `tick={{ fontSize: 10 }}` on mobile — the current 11 causes overlap below 500px.
- Reduce horizontal tick count on narrow widths (Recharts `interval="preserveStartEnd"` or a computed interval).
- Legends: wrap, or drop legend entirely on mobile (the chart title + color already implies the series).

### `MetricCards`

- Grid: `grid-template-columns: repeat(2, 1fr)` on mobile (two cards per row), `repeat(5, 1fr)` at `min-width: 1024px`. Never a 5-column row on mobile — values become unreadable.
- Card padding: `12px` mobile, `16px` desktop.
- Number size: `clamp(1.125rem, 1rem + 1vw, 1.5rem)`.

### `ActivityCard` + recent activity lists

- Each card full-width on mobile, no side-by-side.
- Expanded view scrolls internally if it exceeds 50dvh — prevent the expanded card from pushing the whole page.
- Tap target for expand/collapse covers the whole card header (not just a chevron).

### Settings plugin cards

- Credential `<input>`s: `width: 100%`, `font-size: 16px`, `type="password"` for secrets.
- "Enabled" toggle row: make the whole row tappable, not just the checkbox.
- Buttons (Save, Run now): `min-height: 44px`, `gap: 8px` between them, wrap if they don't fit.

### Forms (`IntakeLog`, `NutritionPage`, `SupplementsPage`, journal)

- Single column always. Two-column form layouts don't survive 420px.
- Labels above inputs, not beside.
- Sticky action buttons (Save / Cancel) at the bottom with `padding-bottom: env(safe-area-inset-bottom)` so they clear the home indicator.

### `DateRangePicker`

- The preset pills (30d / 90d / 6mo / 1yr / All) become a horizontally scrollable strip on mobile.
- Date inputs stack vertically below the preset strip on mobile, beside on desktop.

## Aesthetic — slick, restrained

Keep the current palette and typography. **Do not** add:

- Gradients, glassmorphism, or background blur
- Custom fonts, icon animations, or decorative illustrations
- Ambient motion (floating blobs, particles, auto-playing transitions)
- Box shadows deeper than `0 1px 2px rgba(0,0,0,0.4)` — subtle depth only
- Emojis anywhere

Do:

- Functional transitions only, ≤ 150ms, ease-out. Example: accordion chevron rotation, card expand.
- Rely on spacing and hierarchy, not ornament. Headers distinguish via weight and size, not borders.
- One accent colour (`#3b82f6`). Status colours (success/error) are the only exceptions.
- Consistent 8px spacing grid — 8, 12, 16, 24, 32, 48.

## What NOT to do

- **Don't add a CSS framework** (Tailwind, Bootstrap, Chakra). The app uses plain CSS in `index.css` and that's intentional; stay consistent.
- **Don't use `vh` for full-height layouts** — use `dvh`. Mobile Safari's URL bar will bite you.
- **Don't target specific devices** in media queries (`@media (max-device-width: 420px)` is anti-pattern). Use content-driven breakpoints.
- **Don't regress desktop.** The 1200px layout works today; any change must remain correct there.
- **Don't fight Recharts defaults.** If a chart type doesn't work at 420px, simplify the chart (fewer series, aggregated data) rather than zooming/scrolling horizontally.
- **Don't add swipe gestures** or other touch-only interactions that can't be reproduced with a mouse.
- **Don't assume** — test by resizing the browser to 420×912 (iPhone Air) and 375×667 (SE) before claiming a task done.

## Verification checklist before reporting a mobile change done

- [ ] Resize browser to 420 × 912 — no horizontal scroll, no clipped content
- [ ] Resize to 375 × 667 — same, plus all touch targets reachable
- [ ] Every interactive element ≥ 44 × 44 CSS px including padding
- [ ] No text below 14px in body, no input below 16px
- [ ] `cd frontend && npx tsc --noEmit` exits 0
- [ ] Desktop (1200+) still looks correct — screenshot comparison if a chart or grid was touched
