/* Flow State Consultancy · contact.js
   Contact page module: the calm signal field in the instrument panel, the contact form
   (custom validation, then a mailto hand-off), the line through the next steps and a smooth FAQ.
   All copy (messages, mail address, subject) lives in contact.html, so a search and replace
   over the HTML files is enough to change it. The readout intro of the panel is pure CSS. */

import { gsap, ScrollTrigger, lenis, reducedMotion, onReady } from './core.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LOADING_MS = 600;
const STILL_AFTER_MS = 2500;

/* ---------- 3D field (calm mode), loaded on demand so the page works without it ---------- */
// The panel opens with its grid and readout and the field fades in over them: the instrument powers on.
// The static wave in the markup only shows when the engine cannot start (is-static), or meanwhile
// when it is still not there after a few seconds. Live and static never show at the same time.
async function initField() {
  const host = document.querySelector('[data-signal-field]');
  if (!host) return;
  const panel = host.closest('.contact-scope') || host;
  const stillTimer = window.setTimeout(() => panel.classList.add('is-static'), STILL_AFTER_MS);
  try {
    const { createSignalField } = await import('./signal-field.js');
    createSignalField(host, { mode: 'calm', progress: 0, interactive: true, density: 'auto' });
    panel.classList.remove('is-static');
    panel.classList.add('is-live');
  } catch (err) {
    // No engine: the panel keeps the static wave, the grid and the readout.
    panel.classList.add('is-static');
  } finally {
    window.clearTimeout(stillTimer);
  }
}

/* ---------- Contact form ---------- */
function initForm(form) {
  // Custom validation takes over from the browser only when this module runs.
  form.setAttribute('novalidate', '');

  const address = form.dataset.mailto || '';
  const subjectPrefix = form.dataset.mailSubject || '';
  const submit = form.querySelector('[type="submit"]');
  const statusRegion = form.querySelector('[data-form-status]');
  const statusTemplate = document.getElementById('contact-status-template');
  const header = document.querySelector('[data-site-header]');
  let busy = false;

  const fields = [...form.querySelectorAll('[data-validate]')].map((input) => {
    const error = document.getElementById(`${input.id}-error`);
    return {
      input,
      error,
      errorText: error ? error.querySelector('[data-error-text]') : null,
      describedBy: input.getAttribute('aria-describedby') || '',
      dirty: false,
      errored: false,
    };
  });

  const messageFor = ({ input }) => {
    const value = input.value.trim();
    if (!value) return input.dataset.msgRequired || '';
    if (input.dataset.validate === 'email' && !EMAIL_PATTERN.test(value)) return input.dataset.msgInvalid || '';
    return '';
  };

  // Shows or clears the error below a field and keeps aria-invalid and aria-describedby in sync.
  const render = (field, message) => {
    const { input, error, errorText } = field;
    if (message) {
      field.errored = true;
      if (errorText) errorText.textContent = message;
      if (error) error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', [field.describedBy, error ? error.id : ''].filter(Boolean).join(' '));
    } else {
      if (error) error.hidden = true;
      input.removeAttribute('aria-invalid');
      if (field.describedBy) input.setAttribute('aria-describedby', field.describedBy);
      else input.removeAttribute('aria-describedby');
    }
    return !message;
  };

  fields.forEach((field) => {
    field.input.addEventListener('input', () => {
      field.dirty = true;
      // Once a field has shown an error, it re-checks while typing so the error clears as soon as it is fixed.
      if (field.errored) render(field, messageFor(field));
    });
    field.input.addEventListener('blur', () => {
      if (field.dirty || field.errored) render(field, messageFor(field));
    });
  });

  // Focus the field and, if needed, bring it (label included) into view below the fixed header.
  // The target is measured from the real scroll position, so it is right even mid-scroll.
  const focusField = (input) => {
    const wrap = input.closest('.field') || input;
    const rect = wrap.getBoundingClientRect();
    const offset = (header ? header.offsetHeight : 0) + 24;
    const inView = rect.top >= offset && rect.bottom <= window.innerHeight;
    input.focus({ preventScroll: true });
    if (inView) return;
    const y = Math.max(0, rect.top + window.scrollY - offset);
    if (lenis) lenis.scrollTo(y, { duration: 0.9 });
    else window.scrollTo({ top: y, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const valueOf = (name) => {
    const el = form.elements.namedItem(name);
    return el && 'value' in el ? String(el.value).trim() : '';
  };

  // The select starts on its first option. The topic only goes into the mail once the visitor has
  // picked one (or the browser restored another option), so nobody is filed under the first topic
  // just because they skipped the field.
  const topic = form.elements.namedItem('onderwerp');
  let topicPicked = false;
  if (topic && topic.options) topic.addEventListener('change', () => { topicPicked = true; });
  const topicValue = () => {
    if (!topic || !topic.options || !topic.options.length) return '';
    const initial = [...topic.options].find((option) => option.defaultSelected) || topic.options[0];
    return topicPicked || topic.value !== initial.value ? String(topic.value).trim() : '';
  };

  // The label text without the required marker, so the mail uses the same words as the form.
  const labelOf = (name) => {
    const el = form.elements.namedItem(name);
    const label = el && el.id ? form.querySelector(`label[for="${el.id}"]`) : null;
    if (!label) return name;
    return [...label.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join('')
      .trim();
  };

  const buildMailto = () => {
    const chosenTopic = topicValue();
    const lines = [];
    ['naam', 'bedrijf', 'email', 'telefoon', 'onderwerp'].forEach((name) => {
      const value = name === 'onderwerp' ? chosenTopic : valueOf(name);
      if (value) lines.push(`${labelOf(name)}: ${value}`);
    });
    lines.push('', ...valueOf('bericht').split(/\r\n|\r|\n/));
    const body = lines.map((line) => encodeURIComponent(line)).join('%0D%0A');
    // "Kennismaking via de website: Gespreksanalyse", or the prefix on its own when no topic was picked.
    const subject = chosenTopic ? subjectPrefix + chosenTopic : subjectPrefix.replace(/[\s:]+$/, '');
    return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${body}`;
  };

  const showStatus = () => {
    if (!statusRegion || !statusTemplate) return;
    // Empty first, then fill: a repeated message is announced again.
    statusRegion.textContent = '';
    window.setTimeout(() => {
      statusRegion.appendChild(statusTemplate.content.cloneNode(true));
      const box = statusRegion.firstElementChild;
      if (box && gsap && !reducedMotion) {
        gsap.from(box, { opacity: 0, y: 8, duration: 0.5, ease: 'power3.out', clearProps: 'transform,opacity' });
      }
    }, 60);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;

    let firstInvalid = null;
    fields.forEach((field) => {
      field.dirty = true;
      if (!render(field, messageFor(field)) && !firstInvalid) firstInvalid = field;
    });
    if (firstInvalid) {
      focusField(firstInvalid.input);
      return;
    }

    busy = true;
    if (submit) submit.classList.add('is-loading');
    window.setTimeout(() => {
      const href = buildMailto();
      if (submit) submit.classList.remove('is-loading');
      busy = false;
      window.location.href = href;
      // The status message replaces the explanation under the button (see contact.css).
      form.classList.add('is-sent');
      showStatus();
    }, LOADING_MS);
  });
}

/* ---------- Next steps: the line draws from number to number ---------- */
function initSteps() {
  const list = document.querySelector('.contact-steps__list');
  if (!list || reducedMotion || !gsap || !ScrollTrigger) return;
  const lines = list.querySelectorAll('.contact-steps__line');
  if (!lines.length) return;
  // Same trigger as the stagger reveal of the steps in core.js, so each line grows out of its number
  // while the steps arrive, instead of a beat after they have landed.
  const draw = (prop) => () => {
    gsap.fromTo(lines, { [prop]: 0 }, {
      [prop]: 1,
      duration: 1.2,
      ease: 'power2.inOut',
      delay: 0.15,
      stagger: 0.35,
      scrollTrigger: { trigger: list, start: 'top 88%', once: true },
    });
  };
  const mm = gsap.matchMedia();
  mm.add('(min-width: 960px)', draw('scaleX'));
  mm.add('(max-width: 959.98px)', draw('scaleY'));
}

/* ---------- FAQ: details/summary that open and close smoothly ---------- */
function initFaq() {
  if (reducedMotion || !gsap) return;
  document.querySelectorAll('.faq__item').forEach((item) => {
    const summary = item.querySelector('.faq__q');
    const answer = item.querySelector('.faq__a');
    if (!summary || !answer) return;
    const pad = getComputedStyle(answer).paddingBottom;
    let open = item.open;
    let tween = null;

    const settle = () => {
      tween = null;
      gsap.set(answer, { clearProps: 'height,paddingBottom,opacity,overflow' });
      if (ScrollTrigger) ScrollTrigger.refresh();
    };

    summary.addEventListener('click', (event) => {
      event.preventDefault();
      open = !open;
      if (tween) tween.kill();

      if (open) {
        // Start from where it is now (closed, or halfway through closing), end at its natural height.
        const from = item.open
          ? { height: answer.offsetHeight, paddingBottom: getComputedStyle(answer).paddingBottom, opacity: getComputedStyle(answer).opacity }
          : { height: 0, paddingBottom: 0, opacity: 0 };
        item.open = true;
        gsap.set(answer, { clearProps: 'height,paddingBottom,opacity,overflow' });
        const to = answer.offsetHeight;
        tween = gsap.fromTo(answer, { ...from, overflow: 'hidden' }, {
          height: to, paddingBottom: pad, opacity: 1, duration: 0.24, ease: 'power3.out', onComplete: settle,
        });
      } else {
        gsap.set(answer, { overflow: 'hidden' });
        tween = gsap.to(answer, {
          height: 0, paddingBottom: 0, opacity: 0, duration: 0.2, ease: 'power2.in',
          onComplete: () => { item.open = false; settle(); },
        });
      }
    });

    // Keep in sync when the browser opens it by itself (find in page).
    item.addEventListener('toggle', () => { if (!tween) open = item.open; });
  });
}

/* ---------- Boot ---------- */
initField();
const contactForm = document.querySelector('[data-contact-form]');
if (contactForm) initForm(contactForm);
onReady(() => {
  initSteps();
  initFaq();
});
