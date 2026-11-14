/* Flow State Consultancy · diensten.js
   Page module for diensten.html:
   1. Sticky service index (desktop): marks the service in view and fills a thin progress line.
   2. Training module catalogue: channel filter (toggle buttons) with a manual FLIP transition.
   3. Example route: the line draws with the scroll and each node lights up when the line reaches it.
   Without JS everything is visible: all modules, a fully drawn route, a plain list of services. */
import { gsap, ScrollTrigger, reducedMotion, onReady } from './core.js';

const hasGsap = Boolean(gsap && ScrollTrigger);
const animate = hasGsap && !reducedMotion;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* ---------- 1. Sticky service index ---------- */
function initServiceIndex() {
  const index = document.querySelector('[data-svc-index]');
  const list = document.querySelector('[data-services]');
  const services = [...document.querySelectorAll('[data-service]')];
  if (!index || !list || !services.length || !hasGsap) return;

  const links = [...index.querySelectorAll('[data-svc-link]')];
  const fill = index.querySelector('[data-svc-fill]');
  const indexList = index.querySelector('.svc-index__list');
  let active = -1; // nothing is current until the first service reaches the middle of the screen

  // The line runs along the index list; each service owns the stretch of its own item,
  // so the tip stays next to the active name even when a long name wraps.
  let heights = [];
  let trackHeight = 1;
  const measure = () => {
    heights = links.map((link) => link.parentElement.getBoundingClientRect().height);
    trackHeight = Math.max(1, indexList ? indexList.getBoundingClientRect().height : 1);
  };

  const setActive = (i) => {
    if (i === active) return;
    active = i;
    links.forEach((link, k) => {
      link.classList.toggle('is-active', k === i);
      if (k === i) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  };

  // Ranges only: the active service follows from the scroll position, never from toggle events,
  // so a jump that skips past several services still ends with the right one marked.
  const triggers = services.map((service) => ScrollTrigger.create({ trigger: service, start: 'top 50%', end: 'bottom 50%' }));
  const indexAt = (y) => triggers.reduce((current, t, i) => (y >= t.start ? i : current), -1);
  const fillTo = animate && fill ? gsap.quickTo(fill, 'scaleY', { duration: 0.6, ease: 'power3.out' }) : null;

  const update = (self) => {
    const y = self.scroll();
    setActive(indexAt(y));
    if (!fill) return;
    let px = 0;
    if (fillTo) {
      // Filled while each service passes the middle of the screen.
      triggers.forEach((t, k) => { px += clamp01((y - t.start) / Math.max(1, t.end - t.start)) * (heights[k] || 0); });
      fillTo(Math.min(1, px / trackHeight));
    } else {
      // Reduced motion: the line steps along with the active service instead of following the scroll.
      px = heights.slice(0, active + 1).reduce((a, b) => a + b, 0);
      gsap.set(fill, { scaleY: Math.min(1, px / trackHeight) });
    }
  };

  ScrollTrigger.create({
    trigger: list,
    start: 'top 50%',
    end: 'bottom 50%',
    onUpdate: update,
    onRefresh: (self) => { measure(); update(self); },
  });
}

/* ---------- 2. Module catalogue filter ---------- */
function initModuleFilter() {
  const filter = document.querySelector('[data-module-filter]');
  const grid = document.querySelector('[data-module-grid]');
  const status = document.querySelector('[data-module-count]');
  if (!filter || !grid) return;

  const buttons = [...filter.querySelectorAll('[data-filter]')];
  const items = [...grid.children];
  const tags = [...grid.querySelectorAll('.tag[data-channel]')];
  const cardOf = (item) => item.firstElementChild;
  const state = new Map(items.map((item) => [item, 'shown'])); // shown | leaving | hidden
  const PIN = ['position', 'left', 'top', 'width', 'height', 'z-index', 'pointer-events'];
  let current = 'alle';
  let refreshQueued = false;

  filter.hidden = false; // the toolbar only exists when it can work

  const matches = (item, value) => {
    if (value === 'alle') return true;
    const channels = (item.dataset.channels || '').split(/\s+/);
    return channels.includes('alle') || channels.includes(value);
  };

  // Inside each card, outline the tag that explains the match ("Alle kanalen" counts for every channel).
  const markTags = (value) => {
    tags.forEach((tag) => {
      const channel = tag.dataset.channel;
      tag.classList.toggle('is-match', value !== 'alle' && (channel === value || channel === 'alle'));
    });
  };

  const queueRefresh = () => {
    if (!ScrollTrigger || refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      ScrollTrigger.refresh();
    });
  };

  // Only touch the properties set here: core.js keeps reveal styles inline on the same items.
  const pin = (item, box) => {
    item.style.position = 'absolute';
    item.style.left = `${box.left}px`;
    item.style.top = `${box.top}px`;
    item.style.width = `${box.width}px`;
    item.style.height = `${box.height}px`;
    item.style.zIndex = '0';
    item.style.pointerEvents = 'none';
  };
  const unpin = (item) => PIN.forEach((prop) => item.style.removeProperty(prop));

  const finishLeave = (item) => {
    if (state.get(item) !== 'leaving') return;
    item.hidden = true;
    item.removeAttribute('aria-hidden');
    unpin(item);
    gsap.set(cardOf(item), { clearProps: 'opacity,transform' });
    state.set(item, 'hidden');
  };

  function jump(next) {
    items.forEach((item) => {
      const show = next.has(item);
      item.hidden = !show;
      state.set(item, show ? 'shown' : 'hidden');
    });
    queueRefresh();
  }

  function flip(next) {
    // FIRST, all reads before any write: grid height (mid-animation if interrupted), where every
    // visible card is on screen (transforms included) and the layout box of every item in the flow.
    const before = grid.offsetHeight;
    const gridRect = grid.getBoundingClientRect();
    const first = new Map();
    const boxes = new Map();
    items.forEach((item) => {
      const s = state.get(item);
      if (s === 'hidden') return;
      first.set(item, cardOf(item).getBoundingClientRect());
      if (s === 'shown') {
        const r = item.getBoundingClientRect();
        const lift = Number(gsap.getProperty(item, 'y')) || 0; // reveal offset that core.js may still have on the item
        boxes.set(item, { left: r.left - gridRect.left, top: r.top - lift - gridRect.top, width: r.width, height: r.height });
      }
    });

    const leaving = [];
    const entering = [];
    const staying = [];
    items.forEach((item) => {
      const s = state.get(item);
      if (next.has(item)) (s === 'hidden' ? entering : staying).push(item);
      else if (s === 'shown') leaving.push(item);
    });

    // Writes. The grid takes its natural new height; leaving cards step out of the flow where they are
    // (keeping whatever transform they have), so the rest can move right away.
    gsap.killTweensOf(grid);
    grid.style.removeProperty('height');
    leaving.forEach((item) => {
      gsap.killTweensOf(cardOf(item));
      pin(item, boxes.get(item));
      item.setAttribute('aria-hidden', 'true');
      state.set(item, 'leaving');
    });
    // Cards that were on their way out but match again rejoin the flow.
    staying.forEach((item) => {
      if (state.get(item) === 'leaving') {
        unpin(item);
        item.removeAttribute('aria-hidden');
        state.set(item, 'shown');
      }
    });
    entering.forEach((item) => {
      item.hidden = false;
      state.set(item, 'shown');
    });
    const stayCards = staying.map(cardOf);
    gsap.killTweensOf(stayCards);
    gsap.set(stayCards, { x: 0, y: 0 });

    // LAST, again reads only: the new grid height and the new card positions.
    const after = grid.offsetHeight;
    const last = stayCards.map((card) => card.getBoundingClientRect());

    // INVERT and PLAY. The grid height glides too, so the section below moves instead of jumping;
    // ScrollTrigger measures again once the layout has settled.
    if (after !== before) {
      gsap.fromTo(grid, { height: before }, {
        height: after,
        duration: 0.6,
        ease: 'expo.out',
        clearProps: 'height',
        onComplete: () => ScrollTrigger.refresh(),
      });
    } else {
      queueRefresh(); // an interrupted height tween may have left the triggers measuring an older layout
    }

    // Leaving cards are nearly gone before the others glide past them.
    leaving.forEach((item) => {
      gsap.to(cardOf(item), {
        opacity: 0,
        scale: 0.94,
        duration: 0.18,
        ease: 'power2.out',
        onComplete: () => finishLeave(item),
      });
    });

    stayCards.forEach((card, k) => {
      const from = first.get(staying[k]);
      const to = last[k];
      gsap.fromTo(card,
        { x: from.left - to.left, y: from.top - to.top },
        { x: 0, y: 0, opacity: 1, scale: 1, duration: 0.8, ease: 'expo.out', delay: 0.06, clearProps: 'transform,opacity' });
    });

    const enterCards = entering.map(cardOf);
    if (enterCards.length) {
      gsap.killTweensOf(enterCards);
      gsap.fromTo(enterCards,
        { opacity: 0, scale: 0.94, x: 0, y: 0 },
        { opacity: 1, scale: 1, duration: 0.55, ease: 'power3.out', delay: 0.16, stagger: 0.05, clearProps: 'transform,opacity' });
    }
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.filter;
      if (value === current) return;
      current = value;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));

      const next = new Set(items.filter((item) => matches(item, value)));
      if (status) {
        status.textContent = value === 'alle'
          ? `${next.size} modules`
          : `${next.size} modules voor ${button.textContent.trim()}`;
      }

      markTags(value);
      if (animate) flip(next);
      else jump(next);
    });
  });
}

/* ---------- 3. Example route ---------- */
function initRoute() {
  const route = document.querySelector('[data-route]');
  if (!route) return;
  const track = route.querySelector('.route__track');
  const fill = route.querySelector('[data-route-fill]');
  const steps = [...route.querySelectorAll('[data-route-step]')];
  const nodes = steps.map((step) => step.querySelector('.route__node'));
  if (!track || !fill || !steps.length || nodes.some((node) => !node)) return;

  const WIDE = '(min-width: 1200px)';
  const wide = window.matchMedia(WIDE);

  // Vertical layouts: the CSS runs the line to the bottom of the list; end it at the centre of the
  // last node instead. The horizontal line already ends under the last node in CSS.
  const trimTrack = () => {
    if (wide.matches) { track.style.removeProperty('bottom'); return; }
    const box = route.getBoundingClientRect();
    const end = nodes[nodes.length - 1].getBoundingClientRect();
    track.style.bottom = `${Math.max(0, box.bottom - (end.top + end.height / 2))}px`;
  };
  trimTrack();
  if ('ResizeObserver' in window) new ResizeObserver(trimTrack).observe(route);
  if (hasGsap) ScrollTrigger.addEventListener('refreshInit', trimTrack);

  if (!animate) return; // reduced motion or no GSAP: the CSS default is the finished, fully lit route

  const mm = gsap.matchMedia();
  // The two conditions meet without a gap (fractional widths from zoom included). At any width
  // where neither applies, the route simply keeps its finished CSS state.
  mm.add({ wide: WIDE, narrow: '(max-width: 1199.98px)' }, (ctx) => {
    const horizontal = ctx.conditions.wide;
    const prop = horizontal ? 'scaleX' : 'scaleY';
    let thresholds = [];

    route.classList.add('is-animated');
    trimTrack();

    const measure = () => {
      const t = track.getBoundingClientRect();
      thresholds = nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return horizontal
          ? (r.left + r.width / 2 - t.left) / Math.max(1, t.width)
          : (r.top + r.height / 2 - t.top) / Math.max(1, t.height);
      });
    };
    // A node lights once the line has actually started and reached it.
    const light = (p) => {
      steps.forEach((step, i) => step.classList.toggle('is-lit', p > 0.001 && p >= thresholds[i] - 0.002));
    };

    measure();
    gsap.fromTo(fill, { [prop]: 0 }, {
      [prop]: 1,
      ease: 'none',
      scrollTrigger: {
        // Horizontal: draw while the route crosses the lower half of the screen.
        // Vertical: the tip of the line follows the middle of the screen, from the first node to the last.
        trigger: horizontal ? route : track,
        start: horizontal ? 'top 80%' : 'top 50%',
        end: horizontal ? 'bottom 45%' : 'bottom 50%',
        scrub: 0.8,
        onRefresh: measure,
      },
      onUpdate() { light(this.progress()); },
    });

    return () => {
      route.classList.remove('is-animated');
      steps.forEach((step) => step.classList.remove('is-lit'));
      gsap.set(fill, { clearProps: 'transform' });
    };
  });
}

initModuleFilter();
onReady(() => {
  initServiceIndex();
  initRoute();
});
