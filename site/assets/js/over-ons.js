/* Flow State Consultancy · over-ons.js
   Over ons: the stream field in the hero tightens as the hero scrolls out, and the flow channel
   diagram tells its four steps in a pinned, scrubbed sequence on desktop. Below 960px there is no pin:
   the complete diagram draws its arrows once. Without JS or with reduced motion everything shows as is.
*/
import { gsap, ScrollTrigger, reducedMotion, onReady } from './core.js';

/* ---------- Hero: stream field (loose channel at the top, tight and fast while scrolling out) ---------- */
async function initHero() {
  const hero = document.querySelector('[data-hero]');
  const host = hero ? hero.querySelector('[data-hero-field]') : null;
  if (!host) return;

  let field = null;
  try {
    const { createSignalField } = await import('./signal-field.js');
    field = createSignalField(host, { mode: 'stream', progress: reducedMotion ? 1 : 0 });
  } catch (err) {
    // No 3D engine available: the hero stays a calm dark section and the text still reads.
    return;
  }
  if (!field) return;
  // The figure caption only shows once there is a figure to caption.
  hero.classList.add('has-field');
  if (reducedMotion || !ScrollTrigger) return;

  // The channel locks into its tight, fast state while the headline is still in view.
  ScrollTrigger.create({
    trigger: hero,
    start: 'top top',
    end: 'bottom 60%',
    onUpdate: (self) => field.setProgress(self.progress),
    onRefresh: (self) => field.setProgress(self.progress),
  });
}

/* ---------- De naam: the flow channel in four steps ---------- */
// Point positions in the SVG's own units (viewBox 0 0 600 600), mirrored in the markup.
const PT = { a1: [170, 430], a2: [370, 430], a3: [170, 230], a4: [370, 230] };
// Timeline times where the caption switches: halfway through each transition.
const SWITCH = [1.6, 4.1, 6.5];
const stepAt = (t) => (t < SWITCH[0] ? 1 : t < SWITCH[1] ? 2 : t < SWITCH[2] ? 3 : 4);
// Timeline time where both dots meet on A4.
const LAND = 7.05;
// The paths have pathLength="1", so the dash offset runs from 1 to 0. GSAP rounds px values to whole
// pixels by default, which would make every line pop in at once halfway: autoRound stays off.
const DRAWN = { strokeDashoffset: 0, autoRound: false };

function buildSequence(flow) {
  const one = (sel) => flow.querySelector(sel);
  const all = (sel) => [...flow.querySelectorAll(sel)];
  const stage = one('[data-flow-stage]');
  const steps = all('.flow__step');
  const line = (id) => one(`[data-line="${id}"]`);
  const head = (id) => one(`[data-head="${id}"]`);
  const mark = (id) => one(`[data-mark="${id}"]`);
  const pt = (id) => one(`[data-pt="${id}"]`);
  const zone = (id) => one(`[data-zone="${id}"]`);
  const dotA = one('[data-dot="a"]');
  const dotB = one('[data-dot="b"]');
  const burst = one('.flow__dot-burst');
  const pulse = one('.flow__dot-pulse');
  const homeA = dotA.getAttribute('transform');
  const homeB = dotB.getAttribute('transform');

  // A short searching ping on the dot while it is not yet in the channel at the higher level: two rings,
  // about three seconds, only while the pinned sequence is on screen. From step 3 the dot rests (in step 3
  // it is hidden at A2, at step 4 it is tuned). The landing on A4 gets one burst, played in real time
  // rather than scrubbed, so a tuned dot never keeps a half-finished ring when the reader stops scrolling.
  let st = null;
  let ping = null;
  const quiet = () => {
    if (ping) ping.kill();
    ping = null;
    gsap.set(pulse, { opacity: 0 });
  };
  const pingNow = () => {
    quiet();
    ping = gsap.fromTo(pulse, { scale: 1, opacity: 0.7 }, {
      scale: 2.3, opacity: 0, duration: 1.4, ease: 'power2.out', repeat: 1, repeatDelay: 0.2, delay: 0.2,
    });
  };
  const arrive = () => gsap.fromTo(burst, { scale: 1, opacity: 0.8 }, { scale: 2.8, opacity: 0, duration: 0.9, ease: 'power2.out', overwrite: true });
  let landed = false;

  let current = 0;
  const show = (n) => {
    if (n === current) return;
    current = n;
    flow.dataset.step = String(n);
    steps.forEach((li, i) => li.classList.toggle('is-active', i === n - 1));
    if (n >= 3) quiet();
    else if (st && st.isActive) pingNow();
  };

  // Each dot pulls its lines: a line's drawn length follows the dot's position along it, so the tip
  // never runs ahead of the dot, in either scroll direction. Lines run 20 units clear of each point.
  const along = (v, from, to) => gsap.utils.clamp(0, 1, (v - from) / (to - from));
  const pulls = [
    [line(12), () => along(gsap.getProperty(dotA, 'x'), 190, 350)],
    [line(24), () => along(gsap.getProperty(dotA, 'y'), 410, 250)],
    [line(13), () => along(gsap.getProperty(dotB, 'y'), 410, 250)],
    [line(34), () => along(gsap.getProperty(dotB, 'x'), 190, 350)],
  ];
  // quickSetter writes the exact value every frame (no tween, no rounding).
  const offsets = pulls.map(([el]) => gsap.quickSetter(el, 'strokeDashoffset', 'px'));
  const pullLines = () => pulls.forEach(([, drawn], i) => offsets[i](1 - drawn()));

  // Starting state: one dot at the start of the channel, nothing drawn yet.
  gsap.set(all('[data-line]'), { strokeDasharray: 1, strokeDashoffset: 1 });
  gsap.set([...all('[data-head]'), ...all('[data-mark]'), pt(2), pt(3), pt(4)], { opacity: 0 });
  gsap.set(dotA, { x: PT.a1[0], y: PT.a1[1], opacity: 1 });
  gsap.set(dotB, { x: PT.a1[0], y: PT.a1[1], opacity: 0 });
  gsap.set([burst, pulse], { transformOrigin: '50% 50%', opacity: 0 });
  show(1);

  const move = { duration: 1.2, ease: 'power1.inOut' };
  const tl = gsap.timeline({
    paused: true,
    defaults: { ease: 'none' },
    onUpdate() {
      const t = this.time();
      pullLines();
      show(stepAt(t));
      if ((t >= LAND) !== landed) {
        landed = t >= LAND;
        if (landed && st && st.isActive) arrive();
      }
    },
  });

  // Step 1 holds until 1. Then skill grows while the calls stay the same: the dot drifts into boredom.
  tl.to(mark(1), { opacity: 1, duration: 0.2 }, 1)
    .to(dotA, { x: PT.a2[0], ...move }, 1)
    .to(zone('boredom'), { opacity: 1, duration: 0.8 }, 1.5)
    .to([head(12), pt(2)], { opacity: 1, duration: 0.25 }, 2);

  // Step 2 holds until 3.2. Back at the start, the bar goes up instead: a ghost dot climbs into stress.
  // The dot at A2 steps aside, so A2 shows the same hollow mark as A1.
  tl.to(zone('boredom'), { opacity: 0, duration: 0.6 }, 3.2)
    .to(dotA, { opacity: 0, duration: 0.5 }, 3.2)
    .to(mark(2), { opacity: 1, duration: 0.2 }, 3.2)
    .to(dotB, { opacity: 0.4, duration: 0.3 }, 3.3)
    .to(dotB, { y: PT.a3[1], ...move }, 3.5)
    .to(dotB, { opacity: 1, duration: 0.6 }, 3.9)
    .to(zone('stress'), { opacity: 1, duration: 0.8 }, 4)
    .to([head(13), pt(3)], { opacity: 1, duration: 0.25 }, 4.5);

  // Step 3 holds until 5.7. Training and coaching close the gap from both sides: back in the channel, higher up.
  tl.to(zone('stress'), { opacity: 0, duration: 0.6 }, 5.7)
    .to(dotA, { opacity: 1, duration: 0.4 }, 5.7)
    .to(mark(3), { opacity: 1, duration: 0.2 }, 5.9)
    .to(dotA, { y: PT.a4[1], ...move }, 5.9)
    .to(dotB, { x: PT.a4[0], ...move }, 5.9)
    .to([head(24), head(34), pt(4)], { opacity: 1, duration: 0.25 }, 6.9)
    .to(dotB, { opacity: 0, duration: 0.2 }, LAND)
    // Hold the last step for a moment before the pin lets go.
    .to({}, { duration: 1.3 }, 7.1);

  st = ScrollTrigger.create({
    trigger: stage,
    start: 'center center',
    end: '+=250%',
    pin: true,
    scrub: 0.8,
    anticipatePin: 1,
    refreshPriority: 1,
    animation: tl,
    onToggle: (self) => { if (self.isActive && current <= 2) pingNow(); },
  });

  return () => {
    quiet();
    gsap.killTweensOf(burst);
    steps.forEach((li) => li.classList.remove('is-active'));
    delete flow.dataset.step;
    if (homeA) dotA.setAttribute('transform', homeA);
    if (homeB) dotB.setAttribute('transform', homeB);
  };
}

// Below 960px there is no pin: once the whole figure is in view, the arrows draw in story order
// (1 to 2, 1 to 3, then 2 and 3 to 4) and the dot lands on point 4 last.
function buildDrawIn(flow) {
  const one = (sel) => flow.querySelector(sel);
  const ids = ['12', '13', '24', '34'];
  const lines = ids.map((id) => one(`[data-line="${id}"]`));
  const heads = ids.map((id) => one(`[data-head="${id}"]`));
  const dotA = one('[data-dot="a"]');
  const burst = one('.flow__dot-burst');
  const draw = { ...DRAWN, duration: 0.9, ease: 'power2.inOut' };
  const fade = { opacity: 1, duration: 0.25 };

  gsap.set(lines, { strokeDasharray: 1, strokeDashoffset: 1 });
  gsap.set([...heads, dotA], { opacity: 0 });
  gsap.set(burst, { transformOrigin: '50% 50%', opacity: 0 });
  gsap.timeline({ scrollTrigger: { trigger: one('.flow__plot'), start: 'center 60%', once: true } })
    .to(lines[0], draw)
    .to(heads[0], fade, '-=0.15')
    .to(lines[1], draw, '+=0.1')
    .to(heads[1], fade, '-=0.15')
    .to([lines[2], lines[3]], draw, '+=0.1')
    .to([heads[2], heads[3]], fade, '-=0.15')
    .to(dotA, { opacity: 1, duration: 0.4 }, '-=0.05')
    .fromTo(burst, { scale: 1, opacity: 0.8 }, { scale: 2.8, opacity: 0, duration: 0.9, ease: 'power2.out' }, '<');
}

function initFlow() {
  const flow = document.querySelector('[data-flow]');
  if (!flow || !gsap || !ScrollTrigger) return;
  const mm = gsap.matchMedia();
  mm.add('(min-width: 960px) and (prefers-reduced-motion: no-preference)', () => {
    flow.classList.add('is-sequenced');
    const cleanup = buildSequence(flow);
    return () => {
      cleanup();
      flow.classList.remove('is-sequenced');
    };
  });
  mm.add('(max-width: 959.98px) and (prefers-reduced-motion: no-preference)', () => {
    buildDrawIn(flow);
  });
}

initHero();
onReady(initFlow);
