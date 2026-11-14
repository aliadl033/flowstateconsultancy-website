#!/usr/bin/env node
// Lighthouse runner: node dev/qa/lighthouse.mjs [--base http://localhost:4321/] [--pages index.html,diensten.html] [--form mobile,desktop]
// Prints category scores and every failing audit. Reports saved to dev/qa/out/lh/<page>-<form>.json
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const base = opt('base', 'http://localhost:4321/');
const pages = opt('pages', 'index.html,diensten.html,over-ons.html,contact.html,privacy.html').split(',');
const forms = opt('form', 'mobile,desktop').split(',');
const outDir = path.resolve('dev/qa/out/lh');
fs.mkdirSync(outDir, { recursive: true });

const chrome = await chromeLauncher.launch({
  chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  chromeFlags: ['--headless=new', '--no-first-run', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const summary = [];
try {
  for (const page of pages) {
    for (const form of forms) {
      const url = new URL(page, base).toString();
      const flags = { logLevel: 'error', output: 'json', port: chrome.port, onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] };
      const res = await lighthouse(url, flags, form === 'desktop' ? desktopConfig : undefined);
      const lhr = res.lhr;
      fs.writeFileSync(path.join(outDir, `${page.replace(/[\/]/g, '_')}-${form}.json`), JSON.stringify(lhr));
      const scores = Object.fromEntries(Object.entries(lhr.categories).map(([k, c]) => [k, Math.round(c.score * 100)]));
      const failing = [];
      for (const [catKey, cat] of Object.entries(lhr.categories)) {
        for (const ref of cat.auditRefs) {
          const a = lhr.audits[ref.id];
          if (!a || a.scoreDisplayMode === 'notApplicable' || a.scoreDisplayMode === 'informative' || a.scoreDisplayMode === 'manual') continue;
          if (a.score !== null && a.score < 1 && (ref.weight > 0 || catKey !== 'performance')) failing.push(`${catKey}: ${a.id} (${a.score}) ${a.displayValue || ''} ${a.title}`);
        }
      }
      const m = lhr.audits;
      const metrics = `LCP ${m['largest-contentful-paint']?.displayValue} · TBT ${m['total-blocking-time']?.displayValue} · CLS ${m['cumulative-layout-shift']?.displayValue} · FCP ${m['first-contentful-paint']?.displayValue} · SI ${m['speed-index']?.displayValue}`;
      summary.push({ page, form, scores, metrics, failing });
      console.log(`${page} [${form}] perf ${scores.performance} · a11y ${scores.accessibility} · bp ${scores['best-practices']} · seo ${scores.seo}   (${metrics})`);
      for (const f of failing.slice(0, 12)) console.log('   - ' + f);
    }
  }
} finally {
  await chrome.kill();
}
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
