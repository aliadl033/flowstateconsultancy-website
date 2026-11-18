#!/usr/bin/env node
// Browser test of the contact form against a mocked Formspark (no network, nothing is sent).
// Serves site/ with tools/serve.mjs, gives the page a test endpoint in memory, intercepts the POST
// and answers it per scenario: success, spam filter, used-up bundle, server error, network failure,
// timeout.
//
// Usage: node dev/qa/form-test.mjs [--slow] [--shots [folder]]
//   --slow   also runs the 15 second timeout scenario
//   --shots  saves screenshots of the sent and failed states (default folder dev/qa/out/form)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'dev/package.json'));
const puppeteer = require('puppeteer-core');
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const args = process.argv.slice(2);
const slow = args.includes('--slow');
const shotsArg = args[args.indexOf('--shots') + 1];
const shotsAt = args.includes('--shots') ? path.resolve(ROOT, shotsArg && !shotsArg.startsWith('--') ? shotsArg : 'dev/qa/out/form') : '';
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const ENDPOINT = 'https://submit-form.com/testform1';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
let browser;
let passed = 0;
const failures = [];

// The JSON body as [name, value] pairs, in order.
const parseJson = (body) => { try { return Object.entries(JSON.parse(body)); } catch { return [['(no JSON)', body]]; } };

async function openPage(scenario, { width = 1280, reduced = false } = {}) {
  const page = await browser.newPage();
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width, height: 900 });
  const state = { requests: [], preflights: 0, consoleErrors: [] };
  page.on('console', (msg) => { if (msg.type() === 'error') state.consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => state.consoleErrors.push(String(err)));
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = request.url();
    if (url === `${BASE}/contact.html`) {
      // The real page with a test endpoint; the file on disk is not touched.
      const html = fs.readFileSync(path.join(ROOT, 'site/contact.html'), 'utf8').replace(/action="https:\/\/submit-form\.com\/[^"]*"/, `action="${ENDPOINT}"`);
      return request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    if (url === ENDPOINT) {
      // The JSON content type makes the browser ask first (preflight), as it does with the real Formspark.
      if (request.method() === 'OPTIONS') {
        state.preflights += 1;
        return request.respond({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST' } });
      }
      const body = request.postData() ?? (await request.fetchPostData()) ?? '';
      state.requests.push({ method: request.method(), headers: request.headers(), fields: parseJson(body) });
      return scenario(request, state);
    }
    if (!url.startsWith(BASE)) return request.abort('blockedbyclient');
    return request.continue();
  });
  await page.goto(`${BASE}/contact.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.querySelector('[data-contact-form]').scrollIntoView());
  return { page, state };
}

async function fill(page, values) {
  for (const [selector, value] of Object.entries(values)) {
    await page.$eval(selector, (el) => { el.value = ''; });
    await page.type(selector, value);
  }
}

const json = (status, body) => (request) => request.respond({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
// Formspark answers a refusal with a short plain-text message.
const text = (status, body) => (request) => request.respond({ status, contentType: 'text/plain', headers: CORS, body });
const statusText = (page) => page.$eval('[data-form-status]', (el) => el.textContent.replace(/\s+/g, ' ').trim());
// The result box, not the "sending" line that screen readers get first.
const waitForStatus = (page) => page.waitForSelector('[data-form-status] .contact-form__status-box', { timeout: 20000 });
const boxInView = (page) => page.$eval('[data-form-status] .contact-form__status-box', (box) => {
  const r = box.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
});
const axe = async (page) => {
  await page.evaluate(axeSrc);
  return page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`));
};
const shoot = async (page, name) => {
  if (!shotsAt) return;
  fs.mkdirSync(shotsAt, { recursive: true });
  const box = await page.$('.contact-form__actions');
  await box.screenshot({ path: path.join(shotsAt, `${name}.png`) });
};

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${String(err.stack || err).split('\n').slice(0, 4).join('\n       ')}`);
  }
}

const VALID = { '#cf-naam': 'Test Persoon', '#cf-email': 'test@voorbeeld.nl', '#cf-bericht': 'Regel een\nRegel twee' };

try {
  // Wait for the local server.
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`${BASE}/contact.html`)).ok) break; } catch { /* not up yet */ }
    await sleep(100);
  }
  browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--hide-scrollbars'] });

  await test('empty form: three field errors, focus on the name, nothing sent', async () => {
    const { page, state } = await openPage(json(200, { ok: true }));
    await page.click('.contact-form__submit');
    await sleep(300);
    const shown = await page.$$eval('.field__error:not([hidden])', (els) => els.map((e) => e.id));
    assert.deepEqual(shown, ['cf-naam-error', 'cf-email-error', 'cf-bericht-error']);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cf-naam');
    assert.equal(state.requests.length, 0);
    await page.close();
  });

  await test('honeypot is in the form but hidden and not reachable with Tab', async () => {
    const { page } = await openPage(json(200, { ok: true }));
    const info = await page.$eval('#cf-gotcha', (el) => ({ name: el.name, visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length), inForm: !!el.form }));
    assert.deepEqual(info, { name: '_gotcha', visible: false, inForm: true });
    await page.focus('#cf-bericht');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('contact-form__submit')), true, 'Tab from the message should land on the button');
    await page.close();
  });

  await test('success: right request, form reset, status shown, no axe violations, no console errors', async () => {
    const { page, state } = await openPage(json(200, { naam: 'Test Persoon' }));
    await fill(page, VALID);
    await page.click('.contact-form__submit');
    await waitForStatus(page);
    assert.equal(state.requests.length, 1);
    assert.equal(state.preflights, 1);
    const [req] = state.requests;
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.accept, 'application/json');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.deepEqual(req.fields.map(([k]) => k), ['naam', 'email', 'bericht', '_gotcha', '_email.subject', '_email.from']);
    const fields = Object.fromEntries(req.fields);
    assert.equal(fields.naam, 'Test Persoon');
    assert.equal(fields.email, 'test@voorbeeld.nl');
    assert.equal(fields.bericht, 'Regel een\nRegel twee');
    assert.equal(fields._gotcha, '');
    assert.equal(fields['_email.subject'], 'Kennismaking via de website', 'no topic picked, so no topic in the subject');
    assert.equal(fields['_email.from'], 'Website Flow State Consultancy');
    assert.equal(await statusText(page), 'Je bericht is verstuurd. We mailen je zo snel mogelijk terug op test@voorbeeld.nl.');
    assert.equal(await page.$eval('[data-contact-form]', (f) => f.classList.contains('has-status')), true);
    assert.equal(await page.$eval('.contact-form__actions > .form-note', (n) => getComputedStyle(n).display), 'none');
    assert.equal(await page.$eval('#cf-naam', (el) => el.value), '');
    assert.equal(await page.$eval('#cf-bericht', (el) => el.value), '');
    assert.equal(await page.$eval('.contact-form__submit', (b) => b.classList.contains('is-loading')), false);
    assert.equal(await page.$eval('#cf-onderwerp', (el) => el.value), '', 'the topic is back on "Kies een onderwerp"');
    assert.equal(await page.$eval('#cf-naam', (el) => el.readOnly), false);
    await sleep(700);
    await shoot(page, 'sent-1280');
    assert.deepEqual(await axe(page), []);
    assert.deepEqual(state.consoleErrors, []);
    await page.close();
  });

  await test('a picked topic and optional fields go along, and set the subject', async () => {
    const { page, state } = await openPage(json(200, { ok: true }));
    await fill(page, { ...VALID, '#cf-bedrijf': 'Testbedrijf B.V.', '#cf-telefoon': '06 12345678' });
    await page.select('#cf-onderwerp', 'Gespreksanalyse');
    await page.click('.contact-form__submit');
    await waitForStatus(page);
    const fields = Object.fromEntries(state.requests[0].fields);
    assert.deepEqual(state.requests[0].fields.map(([k]) => k), ['naam', 'bedrijf', 'email', 'telefoon', 'onderwerp', 'bericht', '_gotcha', '_email.subject', '_email.from']);
    assert.equal(fields.onderwerp, 'Gespreksanalyse');
    assert.equal(fields['_email.subject'], 'Kennismaking via de website: Gespreksanalyse');
    assert.equal(fields.bedrijf, 'Testbedrijf B.V.');
    await page.close();
  });

  await test('the first real topic (Salestraining) is sent when picked', async () => {
    const { page, state } = await openPage(json(200, {}));
    await fill(page, VALID);
    await page.select('#cf-onderwerp', 'Salestraining');
    await page.click('.contact-form__submit');
    await waitForStatus(page);
    const fields = Object.fromEntries(state.requests[0].fields);
    assert.equal(fields.onderwerp, 'Salestraining');
    assert.equal(fields['_email.subject'], 'Kennismaking via de website: Salestraining');
    await page.close();
  });

  await test('long e-mail address on a phone: confirmation wraps and is in view', async () => {
    const { page } = await openPage(json(200, {}), { width: 375 });
    const long = 'voornaam.achternaam.met.een.lange.naam@een-heel-lang-bedrijfsdomein-voorbeeld.nl';
    await fill(page, { ...VALID, '#cf-email': long });
    await page.click('.contact-form__submit');
    await waitForStatus(page);
    await sleep(1200);
    assert.match(await statusText(page), new RegExp(long.replace(/\./g, '\\.')));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no horizontal scroll');
    assert.equal(await boxInView(page), true, 'the confirmation must be on screen');
    await shoot(page, 'sent-375');
    await page.close();
  });

  for (const [label, scenario] of [
    ['server error (500)', json(500, { error: 'Internal error' })],
    ['spam filter (403)', text(403, 'Rejected by spam protection.')],
    ['submissions used up (402)', text(402, 'Payment required.')],
    ['network failure', (request) => request.abort('failed')],
  ]) {
    await test(`${label}: failed status with a ready-made mail, the message stays`, async () => {
      const { page, state } = await openPage(scenario, { width: label === 'network failure' ? 375 : 1280 });
      await fill(page, VALID);
      await page.select('#cf-onderwerp', 'Salestraining');
      await page.click('.contact-form__submit');
      await waitForStatus(page);
      assert.match(await statusText(page), /^Je bericht is niet verstuurd\./);
      const href = await page.$eval('[data-form-status] [data-mailto-link]', (a) => a.getAttribute('href'));
      assert.match(href, /^mailto:ali@flowstateconsultancy\.nl\?subject=Kennismaking%20via%20de%20website%3A%20Salestraining&body=/);
      assert.match(decodeURIComponent(href), /Naam: Test Persoon/);
      assert.match(decodeURIComponent(href), /Regel een\r\nRegel twee/);
      assert.equal(await page.$eval('#cf-bericht', (el) => el.value), 'Regel een\nRegel twee');
      assert.equal(await page.$eval('.contact-form__submit', (b) => b.classList.contains('is-loading')), false);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(overflow, 0, 'no horizontal scroll');
      await sleep(1200);
      assert.equal(await boxInView(page), true, 'the failed message must be on screen');
      if (label === 'network failure') await shoot(page, 'failed-375');
      if (label === 'server error (500)') {
        await shoot(page, 'failed-1280');
        assert.deepEqual(await axe(page), []);
      }
      assert.deepEqual(state.consoleErrors.filter((e) => !/Failed to load resource|ERR_FAILED|status of (500|403|402)/.test(e)), []);
      await page.close();
    });
  }

  await test('while sending: spinner, spoken status, locked fields, and a second submit sends nothing', async () => {
    const { page, state } = await openPage(async (request) => { await sleep(1500); return json(200, {})(request); });
    await fill(page, VALID);
    await page.click('.contact-form__submit');
    await sleep(200);
    assert.equal(await page.$eval('.contact-form__submit', (b) => b.classList.contains('is-loading')), true);
    assert.equal(await statusText(page), 'Bezig met versturen.');
    assert.equal(await page.$eval('[data-form-status] p', (p) => p.classList.contains('visually-hidden')), true);
    assert.equal(await page.$eval('[data-contact-form]', (f) => f.hasAttribute('aria-busy')), false, 'aria-busy would silence the live region');
    assert.equal(await page.$eval('#cf-bericht', (el) => el.readOnly), true);
    await page.type('#cf-bericht', ' extra');
    assert.equal(await page.$eval('#cf-bericht', (el) => el.value), 'Regel een\nRegel twee', 'typing while sending is blocked');
    await page.$eval('[data-contact-form]', (f) => f.requestSubmit());
    await waitForStatus(page);
    assert.equal(state.requests.length, 1);
    assert.equal(await page.$eval('#cf-bericht', (el) => el.readOnly), false);
    await page.close();
  });

  await test('reduced motion: the loading ring pulses instead of standing still', async () => {
    const { page } = await openPage(async (request) => { await sleep(1200); return json(200, {})(request); }, { reduced: true });
    await fill(page, VALID);
    await page.click('.contact-form__submit');
    await sleep(200);
    const anim = await page.$eval('.contact-form__submit', (b) => {
      const st = getComputedStyle(b, '::after');
      return { name: st.animationName, count: st.animationIterationCount };
    });
    assert.deepEqual(anim, { name: 'fs-blink', count: 'infinite' });
    await waitForStatus(page);
    await page.close();
  });

  await test('after a failure a second try can succeed and replaces the message', async () => {
    let calls = 0;
    const { page, state } = await openPage((request) => { calls += 1; return calls === 1 ? json(500, {})(request) : json(200, {})(request); });
    await fill(page, VALID);
    await page.click('.contact-form__submit');
    await waitForStatus(page);
    assert.match(await statusText(page), /niet verstuurd/);
    await page.click('.contact-form__submit');
    await page.waitForFunction(() => /is verstuurd/.test(document.querySelector('[data-form-status]').textContent), { timeout: 5000 });
    assert.equal(state.requests.length, 2);
    await page.close();
  });

  if (slow) {
    await test('no answer within 15 seconds: failed status', async () => {
      const { page } = await openPage(() => { /* never answers */ });
      await fill(page, VALID);
      await page.click('.contact-form__submit');
      await waitForStatus(page);
      assert.match(await statusText(page), /niet verstuurd/);
      await page.close();
    });
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log(`\n${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exit(1);
