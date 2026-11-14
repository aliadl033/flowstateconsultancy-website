/* Flow State Consultancy · home.js
   Home page motion:
   1. Hero: the 3D field tunes from noise to signal (load ease, then scroll), with live readouts
      and band labels placed on the wave. Loops stop after a few seconds without input.
   2. Zo klinkt ruis: pinned stage with a horizontal track on desktop, icons go from jagged to clean.
   3. Werkwijze: one signal line from jagged to a pure sine, drawn with scroll.
   4. De naam: a dot travels through the flow channel.
   Without JS, without the 3D engine or with reduced motion, the page shows its finished state.
*/
import { gsap, ScrollTrigger, reducedMotion, onReady, lenis } from './core.js';

const motion = !reducedMotion && !!gsap && !!ScrollTrigger;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Breakpoints. The .98 upper bounds leave no gap at fractional widths (browser zoom).
// Pins need a desktop width and enough height to show the whole stage.
const PIN = '(min-width: 960px) and (min-height: 576px)';
const NO_PIN = '(max-width: 959.98px), (max-height: 575.98px)';
const STEPS_WIDE = '(min-width: 1100px)';
const STEPS_NARROW = '(max-width: 1099.98px)';

/* ==========================================================================
   1. Hero
   ========================================================================== */
const hero = document.querySelector('.hero');
const fieldEl = hero && hero.querySelector('[data-hero-field]');
const srEl = hero && hero.querySelector('[data-hero-sr]');
const statusEl = hero && hero.querySelector('[data-hero-status]');
const dotEl = hero && hero.querySelector('[data-hero-dot]');
const hintEl = hero && hero.querySelector('.hero__hint');
const readoutEl = hero && hero.querySelector('.hero__readout');
const titleEl = hero && hero.querySelector('.hero__title');
const deckEl = hero && hero.querySelector('.hero__deck');
const ruisBand = hero && hero.querySelector('.hero__band--ruis');
const signaalBand = hero && hero.querySelector('.hero__band--signaal');

const heroState = { intro: motion ? 0 : 1, scroll: motion ? 0 : 1 };
let field = null;
let fieldState = 'pending'; // 'pending' | 'live' | 'failed'
let lastSR = -1;
let lastTuned = null;
let lastTune = -1;

// Without a field the hero shows its finished state, like the static poster under it.
const heroProgress = () => (fieldState === 'failed' ? 1 : clamp(0.18 * heroState.intro + 0.82 * heroState.scroll, 0, 1));

function renderHero() {
  const p = heroProgress();
  if (field) field.setProgress(p);
  const sr = Math.round(3 + 35 * p);
  if (srEl && sr !== lastSR) {
    lastSR = sr;
    srEl.textContent = '+' + sr;
  }
  const tuned = p >= 0.98;
  if (tuned !== lastTuned) {
    lastTuned = tuned;
    if (statusEl) statusEl.textContent = tuned ? 'Afgestemd' : 'Afstemmen';
    if (dotEl) dotEl.classList.toggle('is-blinking', !tuned);
    if (signaalBand) signaalBand.classList.toggle('is-on', tuned);
  }
  // The labels read as the two ends of a scale: noise dims as the signal comes in.
  const tune = Math.round(p * 100) / 100;
  if (ruisBand && tune !== lastTune) {
    lastTune = tune;
    ruisBand.style.setProperty('--tune', String(tune));
  }
}

// The engine reports where the wave sits; the labels go on its two ends, kept clear of the
// readout and the scroll hint below (short screens). When there is no room between the copy
// and those (very short screens, enlarged text), the labels step aside. Px from the hero top.
const LABEL_CLEAR = 24; // half a label plus a gap
function placeBands() {
  if (!field || !fieldEl) return;
  const band = field.band;
  let fits = !!band;
  if (fits) {
    let floor = Infinity;
    for (const el of [readoutEl, hintEl]) {
      if (el && el.offsetParent) floor = Math.min(floor, el.offsetTop - LABEL_CLEAR);
    }
    let ceiling = 0;
    for (const el of [titleEl, deckEl]) {
      if (el) ceiling = Math.max(ceiling, el.offsetTop + el.offsetHeight + LABEL_CLEAR);
    }
    const ruisY = Math.round(Math.min(fieldEl.offsetTop + band.left, floor));
    const signaalY = Math.round(Math.min(fieldEl.offsetTop + band.right, floor));
    fits = Math.min(ruisY, signaalY) >= ceiling;
    if (fits) {
      hero.style.setProperty('--band-ruis-y', ruisY + 'px');
      hero.style.setProperty('--band-signaal-y', signaalY + 'px');
    }
  }
  hero.classList.toggle('has-band', fits);
  hero.classList.toggle('no-band', !fits);
}

function fail() {
  if (fieldState === 'failed') return;
  fieldState = 'failed';
  field = null;
  if (!hero) return;
  hero.classList.remove('has-field', 'has-band', 'no-band');
  hero.classList.add('no-field');
  renderHero();
  // Holding the page for a static hero makes no sense: drop the pin, unless the visitor
  // is already in or past it (removing it then would make the page jump).
  const pin = motion && ScrollTrigger.getById('hero-tune');
  if (pin) {
    const y = lenis ? lenis.scroll : window.scrollY;
    if (y <= pin.start + 1) {
      pin.kill();
      ScrollTrigger.refresh();
    }
  }
}

async function loadField() {
  if (!fieldEl) return fail();
  try {
    const mod = await import('./signal-field.js');
    const create = mod.createSignalField || mod.default;
    if (typeof create !== 'function') throw new Error('signal field missing');
    field = create(fieldEl, {
      mode: 'tune',
      progress: heroProgress(),
      interactive: true,
      density: 'auto',
      // The wave stays below the headline and the deck; particles behind the copy are dimmed.
      safeTop: [titleEl, deckEl].filter(Boolean),
      protect: [titleEl, deckEl, readoutEl].filter(Boolean),
    });
    fieldState = 'live';
    hero.classList.add('has-field');
    fieldEl.addEventListener('signalfield:band', placeBands);
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(placeBands);
      for (const el of [hero, titleEl, deckEl]) if (el) ro.observe(el);
    }
    placeBands();
    if (idle) field.pause();
    renderHero();
  } catch (err) {
    // The engine is optional: layout, copy and readouts work without it.
    if (field) {
      try { field.destroy(); } catch (e) { /* already gone */ }
    }
    fail();
  }
}

/* Stop the loops after a few seconds without input (WCAG 2.2.2): the field, the blinking
   status dot and the scroll hint. Any scroll, key, pointer or touch input starts them again. */
const IDLE_MS = 5000;
let idle = false;
let idleTimer = 0;
let lastInput = 0;

function checkIdle() {
  idleTimer = 0;
  const left = IDLE_MS - (performance.now() - lastInput);
  if (left > 50) {
    idleTimer = setTimeout(checkIdle, left);
    return;
  }
  idle = true;
  hero.classList.add('is-idle');
  if (field) field.pause();
}

function wake() {
  lastInput = performance.now();
  if (idle) {
    idle = false;
    hero.classList.remove('is-idle');
    if (field) field.resume();
  }
  if (!idleTimer) idleTimer = setTimeout(checkIdle, IDLE_MS);
}

if (hero) {
  renderHero();
  if (!reducedMotion) {
    for (const type of ['scroll', 'wheel', 'keydown', 'pointermove', 'pointerdown', 'touchstart']) {
      window.addEventListener(type, wake, { passive: true });
    }
    wake();
  }
  // Start the engine after the first paint so the headline is never held up by it.
  if ('requestIdleCallback' in window) window.requestIdleCallback(loadField, { timeout: 400 });
  else setTimeout(loadField, 120);
}

function initHeroMotion(mm) {
  if (!hero) return;
  gsap.to(heroState, { intro: 1, duration: 1.6, ease: 'power2.out', onUpdate: renderHero });

  const fadeHint = (t) => {
    if (hintEl) hintEl.style.opacity = String(1 - clamp(t, 0, 1));
  };

  // Desktop: pin the hero while the signal tunes in (not when the engine is unavailable).
  mm.add(PIN, () => {
    if (fieldState === 'failed') return undefined;
    ScrollTrigger.create({
      id: 'hero-tune',
      trigger: hero,
      start: 'top top',
      end: '+=110%',
      pin: true,
      refreshPriority: 1,
      onUpdate(self) {
        heroState.scroll = self.progress;
        renderHero();
        fadeHint(self.progress / 0.1);
      },
    });
    return () => fadeHint(0);
  });

  // Smaller or short screens: no pin, the signal tunes while the hero scrolls out
  // and is fully tuned while the wave is still in view.
  mm.add(NO_PIN, () => {
    ScrollTrigger.create({
      trigger: hero,
      start: 'top top',
      end: () => '+=' + Math.round(hero.offsetHeight * 0.5),
      invalidateOnRefresh: true,
      onUpdate(self) {
        heroState.scroll = self.progress;
        renderHero();
        fadeHint(self.progress / 0.2);
      },
    });
    return () => fadeHint(0);
  });
}

/* ==========================================================================
   2. Zo klinkt ruis: pinned stage with a horizontal track (desktop)
   ========================================================================== */
function initRuis(mm) {
  const section = document.querySelector('.ruis');
  if (!section) return;
  const stage = section.querySelector('.ruis__stage');
  const track = section.querySelector('.ruis__track');
  const fill = section.querySelector('.ruis__bar-fill');
  const counter = section.querySelector('[data-ruis-current]');
  const panels = track ? [...track.children] : [];
  const n = panels.length;
  if (!stage || !track || !fill || n < 2) return;

  mm.add(PIN, () => {
    section.classList.add('is-horizontal');

    // Timeline in units of 1: a short dwell at both ends, the track moves in between.
    const LEAD = 0.05;
    const MOVE = 0.9;
    const FADE = 0.05;
    const last = panels[n - 1];
    const distance = () => Math.max(0, last.offsetLeft + last.offsetWidth - track.clientWidth);

    // The current panel follows the geometry: a focus line runs from the first panel's centre
    // (start) to the last panel's centre (end position). The panels share one width, so the
    // panel nearest that line is round(q * (n - 1)), and panel i takes over at q = (i - 0.5) / (n - 1).
    const handover = (i) => LEAD + MOVE * ((i - 0.5) / (n - 1));
    let current = -1;
    const setCurrent = (p) => {
      const q = clamp((p - LEAD) / MOVE, 0, 1);
      const c = Math.round(q * (n - 1));
      if (c === current) return;
      current = c;
      if (counter) counter.textContent = String(c + 1).padStart(2, '0');
      panels.forEach((el, i) => el.classList.toggle('is-current', i === c));
    };

    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: stage,
        start: 'top top',
        end: () => '+=' + Math.round(distance() / MOVE),
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
        refreshPriority: 1,
      },
      onUpdate() {
        setCurrent(this.progress());
      },
    });
    tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: 1 }, 0);
    tl.fromTo(track, { x: 0 }, { x: () => -distance(), duration: MOVE }, LEAD);
    // Each icon tunes in as its panel becomes the current one (the first one right away).
    panels.forEach((el, i) => {
      const at = i === 0 ? 0 : handover(i) - FADE / 2;
      const noise = el.querySelector('.ruis__noise');
      const wave = el.querySelector('.ruis__wave');
      if (noise) tl.fromTo(noise, { opacity: 1 }, { opacity: 0, duration: FADE }, at);
      if (wave) tl.fromTo(wave, { opacity: 0 }, { opacity: 1, duration: FADE }, at);
    });
    setCurrent(0);

    return () => {
      section.classList.remove('is-horizontal');
      panels.forEach((el) => el.classList.remove('is-current'));
      if (counter) counter.textContent = '01';
    };
  });
}

/* ==========================================================================
   3. Werkwijze: procedural signal line (wide) and a rail with dots (narrower)
   ========================================================================== */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Noise per step: very jagged, less, slightly, a pure sine.
const NOISE_LEVELS = [1, 0.5, 0.2, 0];

// Builds a deterministic signal path in pixel units (viewBox equals the pixel size).
function buildSignal(width, height, columns, gap) {
  const rand = mulberry32(1114);
  const mid = height / 2;
  const sineAmp = height * 0.2;
  const noiseAmp = height * 0.42;
  const colW = (width - gap * (columns - 1)) / columns;
  const lambda = clamp(colW / 4, 56, 96);
  const k = (Math.PI * 2) / lambda;
  const ramp = colW * 0.3;
  const levels = NOISE_LEVELS.slice(0, columns);
  while (levels.length < columns) levels.push(0);

  const levelAt = (x) => {
    for (let i = 0; i < columns - 1; i++) {
      const next = (i + 1) * (colW + gap);
      const from = next - gap - ramp;
      if (x < from) return levels[i];
      if (x < next) {
        const t = (x - from) / (next - from);
        const s = t * t * (3 - 2 * t);
        return levels[i] + (levels[i + 1] - levels[i]) * s;
      }
    }
    return levels[columns - 1];
  };

  const xs = [];
  const ys = [];
  let x = 0;
  let sign = 1;
  while (x < width) {
    const lv = levelAt(x);
    if (rand() < 0.8) sign = -sign;
    const noise = sign * (0.25 + 0.75 * rand()) * noiseAmp * lv;
    xs.push(x);
    ys.push(clamp(mid - Math.sin(k * x) * sineAmp + noise, 1.5, height - 1.5));
    x += 3 + lv * (2.5 + rand() * 4.5);
  }
  xs.push(width);
  ys.push(mid - Math.sin(k * width) * sineAmp);

  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const r = (v) => Math.round(v * 10) / 10;
  let d = `M${r(xs[0])} ${r(ys[0])}`;
  for (let i = 1; i < xs.length; i++) d += `L${r(xs[i])} ${r(ys[i])}`;
  return { d, xs, cum, total: cum[cum.length - 1], width, height, colW, gap };
}

function initSteps(mm) {
  const root = document.querySelector('[data-steps]');
  if (!root) return;
  const svg = root.querySelector('.steps__line');
  const path = svg && svg.querySelector('.steps__path');
  const list = root.querySelector('.steps__list');
  const items = [...root.querySelectorAll('.step')];
  const railFill = root.querySelector('.steps__rail-fill');
  if (!svg || !path || !list || !items.length) return;

  let sig = null;
  let drawn = 1; // fraction of the width that is drawn; 1 is the finished state
  let armed = false;

  const lengthAt = (x) => {
    const { xs, cum } = sig;
    if (x <= 0) return 0;
    if (x >= sig.width) return sig.total;
    let lo = 0;
    let hi = xs.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (xs[m] <= x) lo = m;
      else hi = m;
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
    return cum[lo] + (cum[hi] - cum[lo]) * t;
  };

  const apply = () => {
    if (!sig || !armed) return;
    const x = drawn * sig.width;
    path.style.strokeDashoffset = String(1 - lengthAt(x) / sig.total);
    items.forEach((el, i) => {
      const reach = i * (sig.colW + sig.gap) + sig.colW * 0.08;
      el.classList.toggle('is-active', x >= reach);
    });
  };

  const regenerate = () => {
    const box = svg.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (w < 2 || h < 2) return;
    if (sig && sig.width === w && sig.height === h) return;
    const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
    sig = buildSignal(w, h, items.length, gap);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.removeAttribute('preserveAspectRatio');
    svg.classList.remove('is-static');
    path.setAttribute('d', sig.d);
    apply();
  };

  regenerate();
  if ('ResizeObserver' in window) new ResizeObserver(regenerate).observe(svg);
  else window.addEventListener('resize', regenerate, { passive: true });

  if (!mm) return;

  // Four columns: draw the line with scroll; a step lights up when the line reaches its column.
  mm.add(STEPS_WIDE, () => {
    armed = true;
    root.classList.add('is-armed');
    path.style.strokeDasharray = '1 1.01';
    const state = { p: 0 };
    drawn = 0;
    regenerate();
    apply();
    gsap.to(state, {
      p: 1,
      ease: 'none',
      scrollTrigger: { trigger: root, start: 'top 78%', end: 'bottom 55%', scrub: 0.6 },
      onUpdate: () => {
        drawn = state.p;
        apply();
      },
    });
    return () => {
      armed = false;
      drawn = 1;
      root.classList.remove('is-armed');
      path.style.strokeDasharray = '';
      path.style.strokeDashoffset = '';
      items.forEach((el) => el.classList.remove('is-active'));
    };
  });

  // Narrower screens: a rail that fills and dots that light up.
  mm.add(STEPS_NARROW, () => {
    root.classList.add('is-armed');
    if (railFill) {
      gsap.fromTo(railFill, { scaleY: 0 }, {
        scaleY: 1,
        ease: 'none',
        scrollTrigger: { trigger: list, start: 'top 70%', end: 'bottom 70%', scrub: 0.6 },
      });
    }
    items.forEach((el) => {
      ScrollTrigger.create({
        trigger: el,
        start: 'top 70%',
        onEnter: () => el.classList.add('is-active'),
        onLeaveBack: () => el.classList.remove('is-active'),
      });
    });
    return () => {
      root.classList.remove('is-armed');
      items.forEach((el) => el.classList.remove('is-active'));
    };
  });
}

/* ==========================================================================
   4. De naam: a dot travels through the flow channel
   ========================================================================== */
function initFlow() {
  const fig = document.querySelector('[data-flow]');
  if (!fig) return;
  const trail = fig.querySelector('.flow__trail');
  const dot = fig.querySelector('.flow__dot');
  if (!trail || !dot) return;
  const from = [96, 384];
  const to = [448, 88];
  const place = (p) => {
    const x = from[0] + (to[0] - from[0]) * p;
    const y = from[1] + (to[1] - from[1]) * p;
    dot.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    trail.style.strokeDashoffset = String(1 - p);
  };
  const state = { p: 0 };
  trail.style.strokeDasharray = '1 1.01';
  place(0);
  gsap.to(state, {
    p: 1,
    ease: 'none',
    scrollTrigger: { trigger: fig, start: 'top 80%', end: 'bottom 40%', scrub: 0.6 },
    onUpdate: () => place(state.p),
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */
// Deep links (index.html#werkwijze) rely on core.js: Lenis re-measures on every
// ScrollTrigger refresh, so the pin spacing added here is counted before the hash scroll.
onReady(() => {
  if (!motion) {
    heroState.intro = 1;
    heroState.scroll = 1;
    renderHero();
    initSteps(null);
    return;
  }
  const mm = gsap.matchMedia();
  initHeroMotion(mm);
  initRuis(mm);
  initSteps(mm);
  initFlow();
});
