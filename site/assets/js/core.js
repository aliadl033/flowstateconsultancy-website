/* Flow State Consultancy · core.js
   Shared behaviour for every page: smooth scroll (Lenis) wired to GSAP ScrollTrigger,
   adaptive header, mobile menu, generic reveal animations, in-page anchors, copy buttons, year.
   Page modules import from here:  import { gsap, ScrollTrigger, reducedMotion, onReady } from './core.js';
*/

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const SplitText = window.SplitText;
export { gsap, ScrollTrigger, SplitText };

const root = document.documentElement;
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isDesktop = () => window.matchMedia('(min-width: 960px)').matches;

if (gsap && ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger);
  if (SplitText) gsap.registerPlugin(SplitText);
  ScrollTrigger.config({ ignoreMobileResize: true });
}

/* ---------- Smooth scroll ---------- */
export let lenis = null;
if (!reducedMotion && window.Lenis && gsap && ScrollTrigger) {
  lenis = new window.Lenis({ lerp: 0.11, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.2 });
  lenis.on('scroll', ScrollTrigger.update);
  // Pinned sections change the page height; let Lenis re-measure whenever ScrollTrigger does.
  ScrollTrigger.addEventListener('refresh', () => lenis.resize());
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  window.__lenis = lenis;
}
window.__fsCore = true;

const header = document.querySelector('[data-site-header]');
const headerOffset = () => (header ? header.offsetHeight : 72) + 16;

/* ---------- Ready queue ---------- */
const readyQueue = [];
let isReady = false;
export function onReady(fn) {
  if (isReady) fn();
  else readyQueue.push(fn);
}

/* ---------- Toast ---------- */
let toastEl = null;
let toastTimer = 0;
function ensureToast() {
  if (toastEl) return toastEl;
  toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  toastEl.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span></span>';
  document.body.appendChild(toastEl);
  return toastEl;
}
export function showToast(message) {
  const el = ensureToast();
  el.querySelector('span').textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
}

/* ---------- Scrolling helpers ---------- */
// Absolute target position, honouring html scroll-padding-top (header + 16px) and the
// target's own scroll-margin-top. Measured from the live layout, so it is never stale.
const px = (v) => parseFloat(v) || 0;
function targetY(target) {
  const pad = px(getComputedStyle(root).scrollPaddingTop) || headerOffset();
  const margin = px(getComputedStyle(target).scrollMarginTop);
  return Math.max(0, Math.round(target.getBoundingClientRect().top + window.scrollY - pad - margin));
}
export function scrollToTarget(target, { immediate = false } = {}) {
  if (!target) return;
  if (lenis) {
    lenis.resize();
    lenis.scrollTo(targetY(target), { immediate, duration: 1.2, force: true });
  } else {
    window.scrollTo({ top: targetY(target), behavior: immediate || reducedMotion ? 'auto' : 'smooth' });
  }
}

const samePage = (url) => {
  const norm = (p) => p.replace(/index\.html$/, '').replace(/\/$/, '') || '/';
  return url.origin === location.origin && norm(url.pathname) === norm(location.pathname);
};

function initAnchors() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(a.getAttribute('href'), location.href);
    if (!url.hash || !samePage(url)) return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    e.preventDefault();
    scrollToTarget(target);
    history.pushState(null, '', location.pathname + location.search + url.hash);
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}

function handleInitialHash() {
  if (!location.hash) return;
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) scrollToTarget(target, { immediate: true });
}

/* ---------- Header: adapts to the section under it, hides on scroll down ---------- */
let updateHeader = () => {};
function initHeader() {
  if (!header) return;
  header.classList.add('is-ready');
  const darkZones = [...document.querySelectorAll('.theme-ink, [data-header-dark]')].filter((el) => !header.contains(el));
  let lastY = lenis ? lenis.scroll : window.scrollY;

  updateHeader = () => {
    const y = lenis ? lenis.scroll : window.scrollY;
    const probe = header.offsetHeight / 2;
    let onDark = root.classList.contains('menu-open');
    if (!onDark) {
      for (const zone of darkZones) {
        const r = zone.getBoundingClientRect();
        if (r.top <= probe && r.bottom >= probe) { onDark = true; break; }
      }
    }
    header.classList.toggle('on-dark', onDark);
    header.classList.toggle('is-solid', y > 8);
    const delta = y - lastY;
    if (Math.abs(delta) > 6) {
      const hide = delta > 0 && y > window.innerHeight * 0.6 && !root.classList.contains('menu-open') && !header.contains(document.activeElement);
      header.classList.toggle('is-hidden', hide);
      lastY = y;
    }
  };

  updateHeader();
  if (lenis) lenis.on('scroll', updateHeader);
  else window.addEventListener('scroll', updateHeader, { passive: true });
  window.addEventListener('resize', updateHeader);
  header.addEventListener('focusin', () => header.classList.remove('is-hidden'));
}

/* ---------- Mobile menu ---------- */
function initMenu() {
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.getElementById('site-menu');
  if (!toggle || !menu) return;
  const label = toggle.querySelector('.visually-hidden');
  const focusables = () => [toggle, ...menu.querySelectorAll('a[href], button:not([disabled])')];
  let open = false;

  const setOpen = (state, { returnFocus = true } = {}) => {
    if (state === open) return;
    open = state;
    toggle.setAttribute('aria-expanded', String(state));
    if (label) label.textContent = state ? 'Menu sluiten' : 'Menu openen';
    if (state) {
      menu.hidden = false;
      root.classList.add('menu-open');
      if (lenis) lenis.stop();
      else document.body.style.overflow = 'hidden';
      updateHeader();
      if (gsap && !reducedMotion) {
        gsap.fromTo(menu, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' });
        gsap.fromTo(menu.querySelectorAll('.site-menu__link, .site-menu__foot'), { y: 32, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.05, delay: 0.05 });
      }
      const first = menu.querySelector('a[href]');
      if (first) first.focus();
    } else {
      root.classList.remove('menu-open');
      if (lenis) lenis.start();
      else document.body.style.overflow = '';
      const done = () => { if (!open) menu.hidden = true; updateHeader(); };
      if (gsap && !reducedMotion) gsap.to(menu, { opacity: 0, duration: 0.2, ease: 'power2.in', onComplete: done });
      else done();
      if (returnFocus) toggle.focus();
    }
  };

  toggle.addEventListener('click', () => setOpen(!open));
  menu.addEventListener('click', (e) => { if (e.target.closest('a[href]')) setOpen(false, { returnFocus: false }); });
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key !== 'Tab') return;
    const items = focusables();
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  window.matchMedia('(min-width: 960px)').addEventListener('change', (e) => { if (e.matches) setOpen(false, { returnFocus: false }); });
}

/* ---------- Copy to clipboard ---------- */
function initCopy() {
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy');
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
      }
      showToast(ok ? (btn.getAttribute('data-copy-message') || 'Gekopieerd') : 'Kopiëren lukte niet. Selecteer het adres en kopieer het zelf.');
    });
  });
}

/* ---------- Reveal animations (data-reveal) ---------- */
function initReveals() {
  const els = document.querySelectorAll('[data-reveal]');
  if (!els.length) return;
  if (!gsap || !ScrollTrigger) { root.classList.add('no-anim'); return; }
  if (reducedMotion) {
    els.forEach((el) => { el.style.visibility = 'visible'; });
    return;
  }

  const hero = document.querySelector('main > :first-child');
  // On a slow load the hero has been readable for a while; a late rise would only look like a twitch.
  const lateStart = performance.now() > 900;
  els.forEach((el) => {
    const type = el.dataset.reveal || 'fade-up';
    const delay = parseFloat(el.dataset.revealDelay || '0') || 0;
    const st = { trigger: el, start: 'top 88%', once: true };

    // Hero content is visible from the first paint (fast LCP); it only gets a short rise.
    if (hero && hero.contains(el) && type !== 'draw' && type !== 'draw-path') {
      el.style.visibility = 'visible';
      if (lateStart) return;
      const targets = type === 'stagger' ? el.children : el;
      gsap.from(targets, { y: 14, duration: 1, ease: 'expo.out', delay: Math.min(delay, 0.3), stagger: type === 'stagger' ? 0.06 : 0, clearProps: 'transform' });
      return;
    }

    if (type === 'fade') {
      gsap.to(el, { opacity: 1, duration: 1, ease: 'power2.out', delay, scrollTrigger: st });
    } else if (type === 'stagger') {
      gsap.to(el.children, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.07, delay, scrollTrigger: st });
    } else if (type === 'lines') {
      if (!SplitText) { el.style.visibility = 'visible'; return; }
      SplitText.create(el, {
        type: 'lines',
        mask: 'lines',
        aria: 'none',
        linesClass: 'fs-line',
        autoSplit: true,
        onSplit(self) {
          el.style.visibility = 'visible';
          (self.masks || []).forEach((m) => m.classList.add('fs-line-mask'));
          return gsap.from(self.lines, { yPercent: 105, duration: 1.1, ease: 'expo.out', stagger: 0.08, delay, scrollTrigger: st });
        },
      });
    } else if (type === 'words') {
      if (!SplitText) { el.style.visibility = 'visible'; return; }
      SplitText.create(el, {
        type: 'words',
        tag: 'span',
        aria: 'none',
        wordsClass: 'fs-word',
        autoSplit: true,
        onSplit(self) {
          el.style.visibility = 'visible';
          // Words go from the muted (still accessible, 4.6:1+) text color to their final color,
          // so the effect never drops below WCAG contrast while scrolling.
          const muted = getComputedStyle(el).getPropertyValue('--text-subtle').trim();
          const finals = self.words.map((w) => getComputedStyle(w).color);
          if (!muted) return null;
          return gsap.fromTo(self.words, { color: muted }, {
            color: (i) => finals[i],
            ease: 'none',
            stagger: 0.1,
            scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 55%', scrub: 0.6 },
          });
        },
      });
    } else if (type === 'draw') {
      // Left-to-right wipe. Works for any SVG, including non-scaling strokes.
      gsap.fromTo(el, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1.6, ease: 'power2.inOut', delay, scrollTrigger: st });
    } else if (type === 'draw-path') {
      // Stroke drawing for paths that have pathLength="1" (do not combine with vector-effect: non-scaling-stroke).
      const shapes = el.matches('path, line, polyline, circle') ? [el] : el.querySelectorAll('path, line, polyline, circle');
      gsap.fromTo(shapes, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, autoRound: false, duration: 1.6, ease: 'power2.inOut', delay, scrollTrigger: st });
    } else {
      gsap.to(el, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', delay, scrollTrigger: st });
    }
  });
}

/* ---------- Footer wordmark: letters rise in ---------- */
function initFooterWordmark() {
  const wm = document.querySelector('.site-footer__wordmark');
  if (!wm || reducedMotion || !SplitText || !gsap) return;
  SplitText.create(wm, {
    type: 'chars',
    mask: 'chars',
    aria: 'none',
    charsClass: 'fs-char',
    autoSplit: true,
    onSplit(self) {
      (self.masks || []).forEach((m) => m.classList.add('fs-char-mask'));
      return gsap.from(self.chars, {
        yPercent: 100,
        duration: 1.2,
        ease: 'expo.out',
        stagger: 0.04,
        scrollTrigger: { trigger: wm, start: 'top 98%', once: true },
      });
    },
  });
}

function initYear() {
  const year = String(new Date().getFullYear());
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = year; });
}

/* ---------- Boot ---------- */
async function boot() {
  ensureToast();
  initHeader();
  initMenu();
  initAnchors();
  initCopy();
  initYear();
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  await Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]);
  initReveals();
  initFooterWordmark();
  isReady = true;
  root.classList.add('fs-ready');
  for (const fn of readyQueue.splice(0)) {
    try { fn(); } catch (err) { console.error(err); }
  }
  requestAnimationFrame(() => {
    if (ScrollTrigger) ScrollTrigger.refresh();
    handleInitialHash();
    updateHeader();
  });
}

boot();
