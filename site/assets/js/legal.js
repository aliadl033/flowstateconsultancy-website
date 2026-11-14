/* Flow State Consultancy · legal.js
   Page module for privacy.html. core.js does the shared work; this adds one small thing:
   The table of contents marks the section you are reading, and keeps that entry in view when the list scrolls.
   Without JS the page is a plain document with a working table of contents. */
import { ScrollTrigger, reducedMotion, onReady } from './core.js';

/* ---------- Table of contents: current section ---------- */
function initToc() {
  const toc = document.querySelector('[data-legal-toc]');
  const list = toc ? toc.querySelector('.legal-toc__list') : null;
  const body = document.querySelector('.legal-body');
  const sections = [...document.querySelectorAll('.legal-section[id]')];
  if (!toc || !list || !body || !sections.length || !ScrollTrigger) return;

  const linkFor = new Map([...toc.querySelectorAll('a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]));
  const links = sections.map((section) => linkFor.get(section.id) || null);
  let active = -1;

  // The list only scrolls on its own when the sticky layout caps it (legal.css). Only then does it take
  // the wheel from Lenis; when everything fits, scrolling over it keeps moving the page as usual.
  const overflowing = () => list.scrollHeight > list.clientHeight + 1;
  const syncOverflow = () => list.toggleAttribute('data-lenis-prevent', overflowing());

  const keepInView = (link) => {
    if (!link || !overflowing()) return;
    const box = list.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(list).paddingTop) || 0; // room for the focus ring
    const r = link.getBoundingClientRect();
    let delta = 0;
    if (r.top < box.top + pad) delta = r.top - (box.top + pad);
    else if (r.bottom > box.bottom - pad) delta = r.bottom - (box.bottom - pad);
    if (delta) list.scrollTo({ top: list.scrollTop + delta, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const setActive = (i) => {
    if (i === active) return;
    active = i;
    links.forEach((link, k) => {
      if (!link) return;
      link.classList.toggle('is-active', k === i);
      if (k === i) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    keepInView(links[i]);
  };

  // A section is current from the moment its top passes 40% of the screen until the next one does.
  // Worked out from the scroll position, so there is never a gap between two sections.
  const starts = sections.map((section) => ScrollTrigger.create({ trigger: section, start: 'top 40%' }));
  const indexAt = (y) => starts.reduce((current, t, i) => (y >= t.start ? i : current), -1);

  ScrollTrigger.create({
    trigger: body,
    start: 'top 40%',
    end: 'bottom 40%',
    onUpdate: (self) => setActive(indexAt(self.scroll())),
    onRefresh: (self) => {
      syncOverflow();
      setActive(indexAt(self.scroll()));
    },
  });
}

onReady(initToc);
