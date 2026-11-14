#!/usr/bin/env node
// QA harness: screenshots a page at several widths and scroll positions,
// collects console errors, failed requests, horizontal overflow and (optionally) axe violations.
//
// Usage:
//   node dev/qa/shoot.mjs --page index.html [--widths 375,768,1440] [--out dev/qa/out/home]
//                         [--step 0.9] [--settle 700] [--max 14] [--reduced] [--axe] [--full] [--base http://localhost:4321/]
//
// Output: <out>/<width>-<nn>.png screenshots + <out>/report.json
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

const base = opt('base', 'http://localhost:4321/');
const page = opt('page', 'index.html');
const widths = String(opt('widths', '375,768,1440')).split(',').map(Number);
const out = path.resolve(opt('out', path.join('dev/qa/out', page.replace(/\.html$/, '').replace(/[\/]/g, '_') || 'index')));
const step = Number(opt('step', 0.9));
const settle = Number(opt('settle', 700));
const maxShots = Number(opt('max', 14));
const reduced = !!opt('reduced', false);
const runAxe = !!opt('axe', false);
const full = !!opt('full', false);

const heights = { 375: 812, 390: 844, 768: 1024, 1024: 768, 1280: 800, 1440: 900, 1920: 1080 };
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check'],
});

const report = { page, base, reduced, widths: {} };

try {
  for (const width of widths) {
    const height = heights[width] || 900;
    const tab = await browser.newPage();
    const log = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], badResponses: [] };
    tab.on('console', (m) => {
      const t = m.type();
      if (t === 'error') log.consoleErrors.push(m.text());
      else if (t === 'warn' || t === 'warning') log.consoleWarnings.push(m.text());
    });
    tab.on('pageerror', (e) => log.pageErrors.push(String(e && e.message ? e.message : e)));
    tab.on('requestfailed', (r) => log.failedRequests.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
    tab.on('response', (r) => { if (r.status() >= 400) log.badResponses.push(r.status() + ' ' + r.url()); });

    await tab.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768 });
    if (reduced) await tab.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

    const url = new URL(page, base).toString();
    await tab.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
    await tab.evaluate(() => document.fonts && document.fonts.ready);
    await new Promise((r) => setTimeout(r, 1600));

    const info = await tab.evaluate(() => {
      const c = document.createElement('canvas');
      const gl2 = !!c.getContext('webgl2');
      return {
        title: document.title,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        webgl2: gl2,
        lenis: !!window.__lenis,
      };
    });

    const shots = [];
    const total = info.scrollHeight - info.innerHeight;
    const stepPx = Math.max(200, Math.round(height * step));
    const positions = [];
    for (let y = 0; y <= total + 1 && positions.length < maxShots; y += stepPx) positions.push(Math.min(y, total));
    if (positions[positions.length - 1] !== total && positions.length < maxShots + 1) positions.push(total);

    for (let i = 0; i < positions.length; i++) {
      const y = positions[i];
      await tab.evaluate((y) => {
        if (window.__lenis) window.__lenis.scrollTo(y, { immediate: true, force: true });
        else window.scrollTo(0, y);
        if (window.ScrollTrigger) window.ScrollTrigger.update();
      }, y);
      await new Promise((r) => setTimeout(r, settle));
      const file = path.join(out, `${width}-${String(i).padStart(2, '0')}.png`);
      await tab.screenshot({ path: file });
      shots.push({ y, file: path.relative(process.cwd(), file) });
    }

    const overflow = await tab.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const offenders = [];
      if (document.documentElement.scrollWidth > vw + 1) {
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > vw + 1 || r.left < -1)) {
            const cs = getComputedStyle(el);
            if (cs.position === 'fixed' && cs.visibility === 'hidden') continue;
            offenders.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} [${Math.round(r.left)}..${Math.round(r.right)}]`);
            if (offenders.length > 15) break;
          }
        }
      }
      return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, offenders };
    });

    if (full) {
      const file = path.join(out, `${width}-full.png`);
      await tab.screenshot({ path: file, fullPage: true });
      shots.push({ full: true, file: path.relative(process.cwd(), file) });
    }

    let axe = null;
    if (runAxe) {
      const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
      await tab.evaluate(axeSrc);
      axe = await tab.evaluate(async () => {
        // eslint-disable-next-line no-undef
        const res = await axe.run(document, { resultTypes: ['violations'] });
        return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary })) }));
      });
    }

    report.widths[width] = { ...info, shots, overflow, axe, ...log };
    await tab.close();
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
// Compact summary on stdout
for (const [w, r] of Object.entries(report.widths)) {
  const issues = [];
  if (r.pageErrors.length) issues.push(`${r.pageErrors.length} page errors`);
  if (r.consoleErrors.length) issues.push(`${r.consoleErrors.length} console errors`);
  if (r.badResponses.length) issues.push(`${r.badResponses.length} bad responses`);
  if (r.failedRequests.length) issues.push(`${r.failedRequests.length} failed requests`);
  if (r.overflow.scrollWidth > r.overflow.clientWidth + 1) issues.push(`horizontal overflow ${r.overflow.scrollWidth}>${r.overflow.clientWidth}`);
  if (r.axe && r.axe.length) issues.push(`${r.axe.length} axe violations`);
  console.log(`[${w}px] "${r.title}" webgl2=${r.webgl2} lenis=${r.lenis} shots=${r.shots.length} ${issues.length ? 'ISSUES: ' + issues.join(', ') : 'no issues'}`);
  for (const e of [...r.pageErrors, ...r.consoleErrors].slice(0, 5)) console.log('   ! ' + e.slice(0, 300));
  for (const e of r.badResponses.slice(0, 5)) console.log('   ! ' + e);
  for (const o of r.overflow.offenders.slice(0, 5)) console.log('   > overflow: ' + o);
  if (r.axe) for (const v of r.axe.slice(0, 8)) console.log(`   a11y [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`);
}
console.log('report: ' + path.relative(process.cwd(), path.join(out, 'report.json')));
