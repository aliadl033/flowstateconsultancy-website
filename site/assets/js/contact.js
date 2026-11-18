/* Flow State Consultancy · contact.js
   Contact page module: the calm signal field in the instrument panel, the contact form
   (custom validation, then a JSON POST to Formspark with a mailto fallback when that fails), the line
   through the next steps and a smooth FAQ.
   All copy (messages, mail address, subject) lives in contact.html, so a search and replace
   over the HTML files is enough to change it. The readout intro of the panel is pure CSS. */

import { gsap, ScrollTrigger, lenis, reducedMotion, onReady } from './core.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Only a real Formspark form endpoint counts; npm run check blocks a deploy without one.
const FORMSPARK_ENDPOINT = /^https:\/\/submit-form\.com\/[A-Za-z0-9_-]+$/;
const MIN_BUSY_MS = 600; // the spinner shows at least this long, so a fast answer does not flicker
const TIMEOUT_MS = 15000;
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

  const action = form.getAttribute('action') || '';
  const endpoint = FORMSPARK_ENDPOINT.test(action) ? action : '';
  const address = form.dataset.mailto || '';
  const submit = form.querySelector('[type="submit"]');
  const statusRegion = form.querySelector('[data-form-status]');
  const statusTemplates = {
    sending: document.getElementById('contact-status-sending'),
    sent: document.getElementById('contact-status-sent'),
    failed: document.getElementById('contact-status-failed'),
  };
  const header = document.querySelector('[data-site-header]');
  let busy = false;
  let statusTimer = 0;

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

  const headerOffset = () => (header ? header.offsetHeight : 0) + 24;
  const scrollToY = (y) => {
    const top = Math.max(0, y);
    if (lenis) lenis.scrollTo(top, reducedMotion ? { immediate: true } : { duration: 0.9 });
    else window.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  // Focus the field and, if needed, bring it (label included) into view below the fixed header.
  // The target is measured from the real scroll position, so it is right even mid-scroll.
  const focusField = (input) => {
    const wrap = input.closest('.field') || input;
    const rect = wrap.getBoundingClientRect();
    const offset = headerOffset();
    input.focus({ preventScroll: true });
    if (rect.top >= offset && rect.bottom <= window.innerHeight) return;
    scrollToY(rect.top + window.scrollY - offset);
  };

  // A status message that lands outside the screen (on a phone the button sits low) scrolls into
  // view. Focus stays where it is; screen readers get the message through the live region.
  const reveal = (box) => {
    const rect = box.getBoundingClientRect();
    const offset = headerOffset();
    if (rect.bottom > window.innerHeight - 24) scrollToY(rect.bottom + window.scrollY - window.innerHeight + 24);
    else if (rect.top < offset) scrollToY(rect.top + window.scrollY - offset);
  };

  const valueOf = (name) => {
    const el = form.elements.namedItem(name);
    return el && 'value' in el ? String(el.value).trim() : '';
  };

  // The select opens on "Kies een onderwerp" with an empty value, so only a topic the visitor
  // actually picked ends up in the mail.
  const topicValue = () => valueOf('onderwerp');

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

  // The base subject sits in the hidden field _email.subject, which also serves the form without
  // JavaScript. With a topic: "Kennismaking via de website: Gespreksanalyse".
  const subjectBase = valueOf('_email.subject');
  const subjectFor = (chosenTopic) => [subjectBase, chosenTopic].filter(Boolean).join(': ');

  // The same message as a ready-made mail: the way out when the form cannot reach Formspark.
  const buildMailto = () => {
    const lines = [];
    ['naam', 'bedrijf', 'email', 'telefoon', 'onderwerp'].forEach((name) => {
      const value = valueOf(name);
      if (value) lines.push(`${labelOf(name)}: ${value}`);
    });
    lines.push('', ...valueOf('bericht').split(/\r\n|\r|\n/));
    const body = lines.map((line) => encodeURIComponent(line)).join('%0D%0A');
    return `mailto:${address}?subject=${encodeURIComponent(subjectFor(topicValue()))}&body=${body}`;
  };

  // What Formspark receives, as JSON: the trimmed fields in form order without the ones left empty,
  // the honeypot as it is (bots fill it, people never see it) and the settings of the notification
  // mail from the hidden _email.* fields. Formspark uses the field "email" as the reply-to address.
  const buildPayload = () => {
    const payload = {};
    ['naam', 'bedrijf', 'email', 'telefoon', 'onderwerp', 'bericht'].forEach((name) => {
      const value = valueOf(name);
      if (value) payload[name] = value;
    });
    const trap = form.elements.namedItem('_gotcha');
    payload._gotcha = trap && 'value' in trap ? String(trap.value) : '';
    form.querySelectorAll('input[type="hidden"][name^="_email."]').forEach((input) => {
      if (input.value) payload[input.name] = input.value;
    });
    payload['_email.subject'] = subjectFor(topicValue());
    return JSON.stringify(payload);
  };

  // Resolves to 'sent' or 'failed' and never throws. Failed covers offline, no answer within
  // TIMEOUT_MS, the spam filter (403) and a used-up submission bundle (402).
  const send = async (body) => {
    if (!endpoint || typeof window.fetch !== 'function') return 'failed';
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), TIMEOUT_MS) : 0;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: controller ? controller.signal : undefined,
      });
      return response.ok ? 'sent' : 'failed';
    } catch (err) {
      return 'failed';
    } finally {
      window.clearTimeout(timer);
    }
  };

  const showStatus = (kind, { mailto = '', email = '' } = {}) => {
    const template = statusTemplates[kind];
    if (!statusRegion || !template) return;
    window.clearTimeout(statusTimer);
    // A result replaces the explanation under the button (see contact.css). "Sending" is only
    // read out by screen readers; sighted visitors see the spinner in the button.
    if (kind !== 'sending') form.classList.add('has-status');
    // Empty first, then fill: a repeated message is announced again.
    statusRegion.textContent = '';
    statusTimer = window.setTimeout(() => {
      const content = template.content.cloneNode(true);
      if (mailto) content.querySelectorAll('[data-mailto-link]').forEach((link) => { link.href = mailto; });
      if (email) content.querySelectorAll('[data-status-email]').forEach((el) => { el.textContent = email; });
      statusRegion.appendChild(content);
      const box = statusRegion.firstElementChild;
      if (kind === 'sending' || !box) return;
      reveal(box);
      if (gsap && !reducedMotion) {
        gsap.from(box, { opacity: 0, y: 8, duration: 0.5, ease: 'power3.out', clearProps: 'transform,opacity' });
      }
    }, 60);
  };

  // While the message is on its way the text fields are read-only, so nothing typed in the meantime
  // is lost when the form empties after sending.
  let locked = [];
  const lockFields = (lock) => {
    if (lock) {
      locked = [...form.querySelectorAll('input:not([type="hidden"]), textarea')].filter((el) => !el.readOnly);
      locked.forEach((el) => { el.readOnly = true; });
    } else {
      locked.forEach((el) => { el.readOnly = false; });
      locked = [];
    }
  };

  const wait = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

  form.addEventListener('submit', async (event) => {
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
    const body = buildPayload();
    const sentTo = valueOf('email');
    lockFields(true);
    if (submit) submit.classList.add('is-loading');
    showStatus('sending');
    const [outcome] = await Promise.all([send(body), wait(MIN_BUSY_MS)]);
    if (submit) submit.classList.remove('is-loading');
    lockFields(false);
    busy = false;

    if (outcome === 'sent') {
      form.reset();
      fields.forEach((field) => {
        field.dirty = false;
        field.errored = false;
        render(field, '');
      });
      showStatus('sent', { email: sentTo });
    } else {
      // The message stays in the form, so trying again is one click; the link opens it as a mail.
      showStatus('failed', { mailto: buildMailto() });
    }
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
