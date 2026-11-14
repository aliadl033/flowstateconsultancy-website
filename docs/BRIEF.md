# Flow State Consultancy · website brief

This is the single source of truth for everyone building this site. Read it fully before touching code.
Copy (all visible Dutch text) lives in `docs/COPY.md`. Tokens live in `site/assets/css/tokens.css`.

Paths below are relative to the project root (the folder that contains `site/`, `dev/`, `docs/`).


## 0. What this is, and the honesty rules

Flow State Consultancy is the trade name of a small Dutch B.V. It offers **sales training and sales coaching**. Its specialisation is **telecom** (outbound, inbound/retention, retail, door-to-door, business market). The approach also applies to other subscription and contract markets: energy, insurance, software, sustainable installations.

The owner wants a striking, credible company website with clear branding, scroll animations and 3D. Pages: Home, Diensten (services and trainings), Over ons, Contact, plus Privacy and a 404.

**Honesty rules (hard, non-negotiable):**
* Never invent numbers, clients, logos, testimonials, reviews, case studies, years of experience, certifications, team members, awards or personal names. No "500+ verkopers getraind", no client logo bars, no star ratings, no quotes from customers.
* Describe approach, services and method instead. That is what the copy in `docs/COPY.md` does. Do not add claims beyond it.
* The mono "instrument readouts" (e.g. `S/R +38 dB`) are decorative UI of the signal metaphor, not performance claims. Keep them clearly instrument-like and never phrase them as results.
* Company details (filled in at integration): legal name Flowstate Consultancy B.V. (brand: Flow State Consultancy), KvK 98730185, Bredesteeg 6, 3811 WS Amersfoort, e-mail ali@flowstateconsultancy.nl. The btw-id is not known yet: `[BTW-ID]` lines are removed until it is. No phone number anywhere.


## 1. Concept

**"Van ruis naar signaal."** Most sales conversations don't fail on product or price; they fail on noise: pitching too early, questions without follow-up questions, objections argued away, sounding like a script, never asking for the decision, training that is never followed up. Flow State trains teams to hear that noise and remove it.

Telecom gives the language: signal and noise, frequencies, channels, *afstemmen* (Dutch for tuning a radio AND for attuning to a customer: a deliberate double meaning).
"Flow" comes from psychologist Mihaly Csikszentmihalyi: flow happens when challenge and skill are in balance. Too much challenge gives stress, too little gives boredom. Coaching keeps skill and challenge growing together, until selling feels effortless.

**Direction in one sentence:** warm editorial paper with a dark measuring instrument inside it: serif headlines, mono readouts, one vermilion signal color, and a signal that goes from noise to clean.

**Signature move:** the signal motif. It appears as: the 3D particle field that turns from static noise into a flowing wave as you scroll (home hero), a line that goes from jagged to a clean sine (logo mark, werkwijze, dividers), and mono instrument readouts. Everything else stays quiet and editorial so this one thing can be loud.


## 2. Brand

### Logo

* Mark: `site/assets/img/logo-mark.svg` (ink square, vermilion line going from jagged noise to a clean wave). Favicon: `site/favicon.svg`.
* Wordmark: "Flow State" in Newsreader 500, tracking -0.02em, with "CONSULTANCY" in JetBrains Mono, xs, uppercase, tracking 0.08em, beneath or beside it. The header markup in `site/_template.html` is canonical; reuse it verbatim.

### Color (see tokens.css; components use semantic tokens only)

* Paper `--bg` (warm off-white) is the default ground; ink `--text` near-black.
* One brand color: vermilion `--primary` / `--accent`. On paper, vermilion **text** must use `--accent-text` (darker, 5.2:1). Bright vermilion on paper is for graphics, fills and large shapes only.
* Dark sections: add class `theme-ink` to the section; all semantic tokens remap automatically.
* Instrument surfaces (3D canvas, readouts) use `--scope-*` tokens and are always dark.
* 60/30/10: paper and ink dominate; vermilion stays around 10% of any screen. When a screen feels loud, remove vermilion.

### Typography

* Display: **Newsreader** (variable, optical sizing on) for h1, h2, statements, pull quotes. Weights 400 and 500. Italic for one emphasised word at most per heading (e.g. *ruis*), often in `--accent-text`.
* Text and UI: **Schibsted Grotesk** 400 / 500 / 700 for body, nav, buttons, labels.
* Mono: **JetBrains Mono** 400 / 500 for instrument readouts, index labels ("01"), small uppercase meta labels. Uppercase mono labels get tracking `--tracking-caps`.
* Sizes ONLY from tokens (`--text-xs` … `--text-7xl`, `--text-statement`, `--text-display`, `--text-display-xl`, `--text-mega`). Max four sizes per screen. Body is `--text-base` (16px) or `--text-lg` (18px) with `max-width: var(--measure)`.
* Display line-height `--leading-tight`/`--leading-snug`, tracking `--tracking-tight`/`--tracking-tighter`. Body line-height `--leading-body`.
* Dutch has long words: headings use `hyphens: manual` plus `overflow-wrap: break-word` (set in base.css). Check 375px.

### Shape, borders, depth

* Radius: `--radius-sm` (4px) for buttons, inputs, tags, nested items; `--radius-md` (8px) for cards and panels. No pills except status dots.
* 1px hairline borders and rules. Border OR shadow, never both. Shadows only for floating things (menu, toast).
* No glassmorphism, no blurred gradient blobs, no purple, no gradient text, no emoji, no badge above a headline, no three-column icon-in-rounded-square feature grids, no stock photos.

### Icons

Lucide-style inline SVG, `stroke-width: 1.5`, `stroke: currentColor`, 20px in text, 24px standalone, `aria-hidden="true"` when decorative. A small set is defined in `docs/ICONS.md`; use those exact paths.

### Voice (Dutch)

Direct, concrete, warm-professional, `je`. The quotes of salespeople talking to customers use `u` (realistic for telesales). Follow the `menselijke-nl-copy` skill: no dashes as punctuation, no hollow marketing words, sentence-case headings, no rhetorical-question headlines. Use the copy in `docs/COPY.md` verbatim; small layout-driven trims are fine, new claims are not.


## 3. Tech stack and constraints

* Static site, no build step. Plain HTML files in `site/`, shared CSS and JS in `site/assets/`. Every page starts from `site/_template.html` (copy it; keep `<head>` structure, header and footer byte-identical apart from `aria-current="page"` on the active nav item).
* Zero third-party requests. Fonts are self-hosted (`assets/css/fonts.css`). Vendor JS is self-hosted in `assets/vendor/`: GSAP 3.15 (`gsap.min.js`, `ScrollTrigger.min.js`, `SplitText.min.js`, all free for commercial use) and Lenis 1.3 (`lenis.min.js`). No CDNs, no analytics, no cookies, no embeds, no Google anything.
* 3D is raw WebGL2 in `assets/js/signal-field.js` (ES module, no dependencies). three.js is NOT used (it would add 2 MB).
* Own JS is ES modules (`<script type="module">`). Vendor scripts are classic `<script defer>` tags that define globals `gsap`, `ScrollTrigger`, `SplitText`, `Lenis`. Modules run after defer scripts, so the globals exist when modules execute.
* `assets/js/core.js` (shared, imported by every page module) sets up Lenis + ScrollTrigger, header behaviour, mobile menu, generic reveal animations, current year, and exports helpers (section 5).
* Progressive enhancement: without JS, everything is visible and usable. Elements hidden for reveal animations are only hidden under `html.js` (class set by an inline script in `<head>`).
* Reduced motion (`prefers-reduced-motion: reduce`): no Lenis, no pinning, no scrubbing, no parallax, no autoplaying 3D; show final states immediately; 3D renders one static frame. `core.js` exports `reducedMotion`.
* Performance: total JS per page under 250 KB uncompressed excluding vendor; no layout thrash; animate only `transform` and `opacity` (and SVG stroke-dashoffset). 3D pauses when offscreen or the tab is hidden. Images: there are none besides SVG.
* Browsers: last two versions of Chrome, Edge, Firefox, Safari; iOS Safari 16+. WebGL2 missing → 2D canvas fallback inside signal-field.js.
* Accessibility: semantic landmarks, one h1 per page, skip link, visible focus rings (`:focus-visible`, 2px `--ring`, 2px offset), 44px touch targets, `aria-hidden` on decorative canvases and readouts, `aria-expanded` on toggles, labels on every form field, WCAG AA contrast. The 3D canvas never carries meaning that is not also in text.
* Responsive: test 375, 768, 1440. Nothing may scroll horizontally. Pinned horizontal-scroll sections become vertical stacks or native swipe below 960px.


## 4. Files and ownership

```
site/
  _template.html            canonical page skeleton (orchestrator)
  index.html                Home
  diensten.html             Diensten (services + training modules)
  over-ons.html             Over ons
  contact.html              Contact
  privacy.html              Privacyverklaring
  404.html                  Geen signaal
  favicon.svg
  robots.txt
  assets/
    css/tokens.css          orchestrator (only file with raw colors)
    css/fonts.css           orchestrator
    css/base.css            orchestrator: reset, typography, layout, shared components, header, footer
    css/<page>.css          one per page, owned by that page's builder (home.css, diensten.css, over-ons.css, contact.css, legal.css)
    js/core.js              orchestrator: shared behaviour
    js/signal-field.js      3D builder
    js/<page>.js            one per page module, owned by that page's builder
    img/logo-mark.svg       orchestrator
    vendor/                 do not edit
    fonts/                  do not edit
dev/qa/                     QA scripts (do not ship)
docs/                       brief, copy, icons
```

Builders only edit files they own. If you need something in a shared file (base.css, core.js, template), do not edit it: put the page-specific version in your own file and mention the shared need in your final report.


## 5. Shared foundation (base.css + core.js)

`base.css` provides (read the file for exact class names and markup patterns, it is the reference):
* Layout: `.container` (max `--container`, side padding `--gutter`), `.container--wide`, `.container--narrow`, `.section` (vertical padding `--space-section`), `.grid-12` helpers, `.stack-*` spacing utilities.
* Type: `.display-xl` (h1), `.display` (h2), `.statement`, `.lead`, `.prose`, `.label` (mono uppercase micro label), `.index` (mono section number like `01`), `.em` (italic display emphasis in `--accent-text`).
* Components: `.btn` + `.btn--primary` / `.btn--secondary` / `.btn--ghost`, sizes `.btn--lg`, all six states; `.link-arrow`; `.tag`; `.card`; `.rule`; `.section-head` (index + title + intro, asymmetric); `.readout` (instrument readout block); `.signal-divider` (inline SVG line from noise to clean); form fields (`.field`, `.field__label`, `.field__input`, `.field__hint`, `.field__error`); `.faq` (details/summary accordion); `.toast`.
* Header (`.site-header`, transparent over dark heroes when `<body data-header="on-dark">`, solid paper after scrolling) and footer (`.site-footer`, dark, with the giant "Flow State" wordmark).
* Reveal hooks (handled by core.js): `data-reveal` on any element: `fade-up` (default), `fade`, `lines` (SplitText lines rise in, masked), `words` (words go from 15% to 100% opacity, scrubbed with scroll), `stagger` (direct children fade-up in sequence), `draw` (left-to-right clip wipe of an SVG, safe with `vector-effect: non-scaling-stroke`), `draw-path` (stroke drawing for shapes with `pathLength="1"`; never combine with non-scaling-stroke, the dash math breaks). Optional `data-reveal-delay="0.1"`.
* Living reference: `site/_components.html` (served at http://localhost:4321/_components.html) shows the shared components with correct markup: dark hero type, buttons in every state, link-arrow, tags, readout with status dot, signal divider, form fields with error, select, FAQ, CTA band, header and footer. Copy markup patterns from there.
* Header behaviour (core.js): it detects what is under it. Any section with class `theme-ink` (or attribute `data-header-dark`) makes the header switch to light-on-dark while it is underneath. It turns solid after 8px of scroll and hides on scroll down. `<body data-header="on-dark">` only sets the correct colors for the first paint on pages that start with a dark hero.
* Canonical signal divider path (viewBox `0 0 1200 24`, `preserveAspectRatio="none"`): see `docs/_signal_path.txt`. Use it with `class="signal-divider"` and `data-reveal="draw"`.

`core.js` exports (ES module):
```js
export const reducedMotion   // boolean
export const lenis           // Lenis instance or null (reduced motion)
export const gsap, ScrollTrigger, SplitText // the globals, re-exported for convenience
export function onReady(fn)  // runs after fonts are loaded and core is initialised
export function isDesktop()  // matchMedia('(min-width: 960px)').matches
```
Page modules: `import { gsap, ScrollTrigger, reducedMotion, onReady } from './core.js';`
Use `gsap.matchMedia()` for breakpoint/reduced-motion specific timelines. Never create a second Lenis or ScrollTrigger setup.


## 6. The 3D signal field (`assets/js/signal-field.js`)

One dependency-free WebGL2 particle engine used on several pages, each with its own *mode*. All motion happens in the vertex shader; per-frame work on the CPU is only uniforms. One draw call (`gl.POINTS`) per frame, additive or premultiplied-alpha blending, round soft point sprites drawn in the fragment shader.

### API (contract, other builders code against this)

```js
import { createSignalField } from './signal-field.js';

const field = createSignalField(containerEl, {
  mode: 'tune',          // 'tune' | 'stream' | 'calm' | 'noise'
  progress: 0,           // 0..1 starting value (meaning depends on mode)
  interactive: true,     // pointer parallax / local disturbance
  density: 'auto',       // 'auto' | 'low' | 'high'
});

field.setProgress(p);    // 0..1; engine eases toward it (critically damped, ~0.35s)
field.pause(); field.resume();
field.destroy();         // removes canvas, listeners, GL resources
field.supported;         // true = WebGL2, false = 2D canvas fallback is running
```
* The engine creates its own `<canvas aria-hidden="true">` absolutely filling `containerEl` (container must be `position: relative` or absolute and sized by CSS).
* Colors come from CSS custom properties read on `containerEl`: `--scope-bg`, `--scope-noise`, `--scope-signal`, `--scope-text` (hex). Never hardcode brand colors in JS beyond fallbacks.
* Handles DPR (cap 2; cap 1.5 when `density` resolves low), ResizeObserver, IntersectionObserver (pause offscreen), `visibilitychange`, WebGL context loss/restore, and `prefers-reduced-motion` (render a single beautiful static frame at the current progress, re-render on resize; no loop).
* `density: 'auto'`: about 26k particles at ≥1280px wide on a capable device, about 14k on tablets, about 8k on phones (≤480px) or when `navigator.hardwareConcurrency <= 4`.
* Fallback without WebGL2: a 2D canvas that draws layered lines with the same idea (noise → sine) at 30fps.

### Modes (visual direction)

* `tune` (home hero). `progress` 0 = *ruis*: particles form a wide, shallow, volumetric cloud of static: jittering at high frequency, static-gray (`--scope-noise`) at low alpha with a few brighter sparks, readable as "TV static in depth". `progress` 1 = *signaal*: the same particles are arranged as a smooth, flowing wave sheet: a grid in x/z, displaced `y = A·sin(k·x − ω·t + φ(z))·envelope(z)`, receding into depth, phase flowing to the right, colored vermilion (`--scope-signal`) with brighter front rows and a soft glow, a few paper-white glints on crests. The morph is not uniform: each particle gets a delay tied to its x position (left locks in first) plus a little randomness, so scrolling visibly *tunes in* the signal from left to right. Camera: perspective, slightly above the sheet looking down ~15°, sheet wider than the viewport, centred around 58% of the canvas height so a headline on the left/top stays readable. Pointer: subtle camera parallax (±3°) and, near the pointer, a soft local ripple. Even at progress 1 a sparse residue of gray static remains at the far edges.
* `stream` (over ons hero). Particles flow continuously along a smooth 3D spline channel that sweeps through the frame (a river of light, the *flow channel*). Inside the channel: vermilion core, paper-white highlights, moving steadily. Outside the channel: sparse gray particles jittering (stress above, boredom below). `progress` 0 = wide, loose, turbulent channel; 1 = tight, coherent, fast-flowing channel.
* `calm` (contact hero). One clean, slow wave ribbon (few thousand particles), breathing gently, plus three particle rings expanding slowly from a point on the ribbon like a broadcast pulse and fading out. Tuned, quiet, inviting. `progress` unused (or controls ring speed).
* `noise` (404). Pure agitated static cloud filling the frame. Interactive: around the pointer the static locally calms into a small clean wave fragment (you can "tune" a spot). `progress` unused.

### Lab page for development

`site/_lab/signal-field.html` (never linked, removed before delivery): full-screen field with a small control panel (mode select, progress slider, density, auto-tune toggle) and an FPS readout. It must support URL params for deterministic screenshots: `?mode=tune&progress=0.5&t=3&frozen=1` (`frozen=1` stops time at `t` seconds, `t` sets the shader time).


## 7. Pages

All pages: header (from template), `<main id="main">`, footer (from template). Animations via core.js reveal hooks plus page modules. Section order below is the intended story; layout ideas are direction, not pixels. Every page needs at least one memorable moment, but keep everything else calm, editorial and readable.

### 7.1 Home (`index.html`, `home.css`, `home.js`). Body tag: `<body data-header="on-dark">`

1. **Hero (dark, full viewport, pinned while tuning).** Full-bleed 3D `tune` field. H1 left-aligned, large Newsreader: "Verkopen zonder *ruis*." Lead paragraph and two buttons (primary to contact, secondary to #werkwijze). Instrument readouts in mono at the top right (kanaal, S/R in dB, status), a `RUIS` label at the left edge and `SIGNAAL` at the right edge of the wave band. Scroll pins the hero for about one extra viewport (desktop) while `progress` goes 0 → 1; S/R counts from +3 dB to +38 dB and status goes from `AFSTEMMEN` (blinking dot) to `AFGESTEMD` (steady vermilion dot). On load, progress auto-eases from 0 to about 0.18 so the page never starts dead. Mobile: no pin; progress tied to hero scroll-out, lighter density. Reduced motion: static frame at progress 1, readouts at final values.
2. **Statement (paper).** Large Newsreader statement paragraph, words reveal from 15% to 100% opacity as you scroll (`data-reveal="words"`). The word *ruis* in italic accent.
3. **Zo klinkt ruis.** The six noise patterns. Desktop: a pinned horizontal scroll track of six panels (quote in large Newsreader italic as overheard on the floor, then the pattern name, then the explanation, plus a tiny jagged line icon that straightens when the panel reaches centre). Below 960px: vertical stack. Index labels `01` to `06` in mono.
4. **Diensten (teaser).** Four services as an editorial list or 2×2 with index, title, one line, link to `diensten.html#<slug>`. Hover: row shifts subtly, arrow moves, a thin vermilion underline draws.
5. **Telecom (dark, `theme-ink`).** Statement title, short paragraph, the five channels as a structured list (channel name, one sentence), the topic tags row, and the "en daarbuiten" line. A thin signal divider at the top of the section.
6. **Werkwijze (`id="werkwijze"`).** Four steps: Meten, Afstemmen, Trainen, Borgen. One long SVG signal line runs under the four steps; it is jagged under step 1 and becomes progressively cleaner until a pure sine under step 4. It draws itself as you scroll (scrubbed; use a clip wipe or pathLength dash without non-scaling-stroke); each step activates (index turns vermilion) as the line reaches it. Mobile: vertical, with the line running down the left.
7. **Waarom Flow State (teaser).** Two columns: short text about flow and a small flow-channel diagram (SVG: axes Vaardigheid / Uitdaging, zones Stress, Verveling, Flow) with a dot that moves through the channel as you scroll. Link to `over-ons.html`.
8. **CTA band.** "Zullen we afstemmen?" with primary button to `contact.html`.

### 7.2 Diensten (`diensten.html`, `diensten.css`, `diensten.js`). The page that shows what trainings are given. `<body data-header="on-paper">`

1. **Page hero (paper).** Mono label, H1, intro, and a horizontal 2D signal line (SVG) drawing in under the title. Quick-jump links to the four services.
2. **Four services in depth**, ids `training`, `coaching`, `gespreksanalyse`, `teamleiders`. Desktop layout: a sticky left column with the service index list (active item highlights as you scroll, with a small vertical progress line) and the content on the right: what it is, for whom, what you get (list), practical format (vorm, duur, groepsgrootte, locatie as a small definition list). Mobile: plain stacked sections.
3. **Trainingsmodules.** A filterable catalogue of the training modules from COPY.md. Filter buttons by channel (Alle, Outbound, Inbound en retentie, Retail, Deur-aan-deur, Zakelijk) implemented as a real toolbar of toggle buttons with `aria-pressed`; modules animate in/out with GSAP Flip-like transform transitions (or simple fades if Flip is unavailable; Flip is not shipped, do it manually or with fades). Each module card: title, one sentence, duration hint, channel tags. Card border, no shadow.
4. **Zo ziet een traject eruit.** A compact horizontal timeline (week labels) that illustrates a typical sequence: kennismaking, meten, trainen, coachen op de vloer, evalueren. Clearly framed as an example ("bijvoorbeeld").
5. **CTA band** to contact.

### 7.3 Over ons (`over-ons.html`, `over-ons.css`, `over-ons.js`). Body tag: `<body data-header="on-dark">`

1. **Hero (dark).** 3D `stream` field full-bleed. H1 "Waarom Flow State?" style title from COPY.md and a short intro. `progress` follows scroll out of the hero (loose → tight channel).
2. **Het verhaal achter de naam.** Flow explained (Csikszentmihalyi), with the large interactive flow diagram: SVG with axes Vaardigheid (x) and Uitdaging (y), zones Stress (top-left), Verveling (bottom-right), Flow (diagonal channel, vermilion tint). A pinned, scrubbed sequence moves a dot: A1 start (low skill, low challenge, in flow) → A2 verveling (skill grew, challenge didn't) → A3 stress (challenge jumped) → A4 back in flow at a higher level, each step with a caption from COPY.md. Mobile: not pinned; the four states shown as a static diagram with numbered points plus a list.
3. **Waar we voor staan.** Four principles as an editorial numbered list (large index numbers, title, paragraph). Subtle line reveals.
4. **Waarom telecom.** Statement and paragraph about why the specialisation, and how it transfers to other markets.
5. **Hoe we samenwerken.** Short paragraph block about working style (op locatie, bij jullie op de vloer, eigen gesprekken), from COPY.md.
6. **CTA band.**

### 7.4 Contact (`contact.html`, `contact.css`, `contact.js`). Body tag: `<body data-header="on-paper">`

1. **Hero split.** Left: H1 "Zullen we afstemmen?", intro, direct e-mail line with a copy-to-clipboard button (toast "Gekopieerd"). Right: a dark instrument panel (`--scope-bg`, radius-md) holding the 3D `calm` field, with mono readouts ("KANAAL OPEN", "REACTIE: PER MAIL").
2. **Contact form** (single column, labels above fields): naam, bedrijf, e-mail, telefoon (optioneel), onderwerp (select: Training, Coaching, Gespreksanalyse, Teamleiders, Iets anders), bericht, and a privacy note linking to privacy.html. No backend: on submit, validate (on blur, then on change; errors below field with icon and fix-it text; focus first error), then compose a `mailto:` with subject and body and open it; show an inline status message explaining that the mail app opens with the message ready to send, plus the plain address as fallback. Keep the submit button enabled; give it a brief loading state while composing.
3. **Wat er na je bericht gebeurt.** Three steps (from COPY.md).
4. **Veelgestelde vragen.** FAQ accordion (`.faq`, details/summary) with the questions from COPY.md.
5. **Bedrijfsgegevens.** Small definition list with the placeholders (handelsnaam, KvK, btw-id, adres, e-mail).

### 7.5 Privacy (`privacy.html`, `legal.css`). Body tag: `<body data-header="on-paper">`

Readable legal page: narrow container, table of contents, sections from COPY.md, "Laatst bijgewerkt: 14 november 2026".

### 7.6 404 (`404.html`, uses `legal.css` or inline-free page css). Body tag: `<body data-header="on-dark">`

Full-viewport dark page with the 3D `noise` field, H1 "Geen signaal.", one sentence, and buttons back to home and contact. Same header/footer as template is optional here (header yes, footer may be omitted). Use absolute-root links (`/index.html` style is NOT used; relative links are fine because 404 is served at the site root).


## 8. Motion principles

* Motion explains the signal story; it is not decoration. Every page: one signature moment, everything else quiet.
* UI transitions 150 to 240ms with `--ease-flow`. Scroll-scrubbed sequences use `scrub: 0.6 to 1` (smoothing) and never fight Lenis.
* Reveals: short distances (16 to 24px), 0.6 to 0.9s, `power3.out`/`expo.out`; stagger 0.06 to 0.08s. Do not fade every paragraph; reveal headings and groups.
* No custom cursor, no scroll-jacking beyond the specified pins, no parallax on body text.
* Reduced motion: everything visible immediately in its final state.


## 9. QA: how to verify your work (definition of done)

A static server runs at `http://localhost:4321/` serving `site/`. If it is not running, start one in the background on another port: `python3 -m http.server 4400 --bind 127.0.0.1 --directory site` and pass `--base http://localhost:4400/`.

1. Screenshots + errors + overflow + accessibility:
   `node dev/qa/shoot.mjs --page diensten.html --widths 375,768,1440 --axe --out dev/qa/out/<your-name>`
   Look at the PNGs (use the Read tool on them). Fix anything ugly, cut off, overlapping, unreadable, or broken. Also run once with `--reduced` and check that all content is visible.
2. Static checks: `node dev/qa/check-site.mjs --pages <your-page>.html` (links/anchors, header/footer identical to template, page basics, CSS token lint). Zero PROBLEMS; fix token-lint warnings in your own CSS.
3. Copy check: `python3 ~/.claude/skills/menselijke-nl-copy/scripts/check_copy.py --lang nl site/<your-page>.html` (exit 0).
4. Zero console errors and zero 404s in the shoot report.
5. Report back: what you built, what you verified (with screenshot file paths), anything you could not fix, and any change you need in a shared file.
