/* Flow State Consultancy · notfound.js
   404 page module: shared behaviour from core.js plus the noise field. Static fills the screen;
   around the pointer it calms into a small clean wave, so a visitor can tune in a spot. */

import './core.js';

// 404.html has <base href="/"> so it works at any depth. A bare "#main" would then point at the
// homepage, so the skip link moves focus here itself (core.js skips clicks that are already handled).
function initSkipLink() {
  const skip = document.querySelector('.skip-link');
  const main = document.getElementById('main');
  if (!skip || !main) return;
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
  });
}

async function initField() {
  const host = document.querySelector('[data-signal-field]');
  if (!host) return;
  try {
    const { createSignalField } = await import('./signal-field.js');
    // The clean wave fragment stays off the headline, the sentence and the buttons.
    const protect = ['.nf__title', '.nf__lead', '.nf__actions'].map((s) => document.querySelector(s)).filter(Boolean);
    createSignalField(host, { mode: 'noise', progress: 0, interactive: true, density: 'auto', protect });
  } catch (err) {
    // No engine: the section stays a plain dark surface and every link still works.
  }
}

initSkipLink();
initField();
