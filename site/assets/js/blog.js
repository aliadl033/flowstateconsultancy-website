/* Flow State Consultancy · blog.js
   Blog index and posts. core.js handles smooth scroll, header, menu, anchors and the data-reveal hooks.
   This module adds the table of contents state: the section you are reading is highlighted and the
   vertical rail fills as you read. Reads layout first, then writes, once per animation frame. */
import { lenis } from './core.js';

function initToc() {
  const toc = document.querySelector('[data-toc]');
  const article = document.querySelector('[data-article]');
  if (!toc || !article) return;

  const links = [...toc.querySelectorAll('a[href^="#"]')];
  const sections = links
    .map((link) => ({ link, target: document.getElementById(decodeURIComponent(link.hash.slice(1))) }))
    .filter((s) => s.target);
  if (!sections.length) return;

  const progress = toc.querySelector('[data-toc-progress]');
  const body = article.querySelector('.post-content') || article;
  const header = document.querySelector('[data-site-header]');
  let active = -1;
  let queued = false;

  const update = () => {
    queued = false;
    if (!toc.offsetParent) return; // hidden below 960px
    const top = (header ? header.offsetHeight : 72) + 48;
    // A section counts as "being read" once its heading passes the upper third of the screen.
    const line = Math.max(top, window.innerHeight * 0.3);
    let current = -1;
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].target.getBoundingClientRect().top - line <= 0) current = i;
      else break;
    }
    const box = body.getBoundingClientRect();
    const span = Math.max(1, box.height - window.innerHeight + top);
    const ratio = Math.min(1, Math.max(0, (top - box.top) / span));

    // When the contents list is taller than the window it scrolls on its own; keep the active entry in view.
    let shift = 0;
    if (current !== active && current > -1 && toc.scrollHeight > toc.clientHeight + 1) {
      const frame = toc.getBoundingClientRect();
      const item = sections[current].link.getBoundingClientRect();
      const margin = 48;
      if (item.top < frame.top + margin) shift = item.top - frame.top - margin;
      else if (item.bottom > frame.bottom - margin) shift = item.bottom - frame.bottom + margin;
    }

    if (progress) progress.style.transform = `scaleY(${ratio.toFixed(4)})`;
    if (current !== active) {
      if (active > -1) sections[active].link.removeAttribute('aria-current');
      if (current > -1) sections[current].link.setAttribute('aria-current', 'true');
      active = current;
    }
    if (shift) toc.scrollTop += shift;
  };

  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  if (lenis) lenis.on('scroll', queue);
  if (document.fonts) document.fonts.ready.then(queue);
  update();
}

initToc();
