#!/usr/bin/env node
// Adds the btw-identificatienummer everywhere it belongs, once it is known.
// Usage: node dev/set-btw.mjs NL123456789B01
// Then run: node dev/seo-heads.mjs && npm run build && npm run check, and push to main.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const SITE = path.join(ROOT, 'site');
const btw = (process.argv[2] || '').replace(/\s+/g, '').toUpperCase();
if (!/^NL\d{9}B\d{2}$/.test(btw)) {
  console.error('Give a Dutch btw-id like NL123456789B01');
  process.exit(1);
}

const report = [];
// 1. Config (used by the blog build and dev/seo-heads.mjs for structured data)
const cfgPath = path.join(ROOT, 'tools/site.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.organization.btwId = btw;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
report.push('tools/site.config.json: btwId set');

// 2. Footer of the template and every static page, plus the company card on contact.html
const files = fs.readdirSync(SITE).filter((f) => f.endsWith('.html'));
for (const f of files) {
  const p = path.join(SITE, f);
  let html = fs.readFileSync(p, 'utf8');
  const before = html;
  html = html.replace(/\s*<li><span>Btw-id [^<]*<\/span><\/li>/g, '');
  html = html.replace(/(\n(\s*)<li><span>KvK [^<]*<\/span><\/li>)/, `$1\n$2<li><span>Btw-id ${btw}</span></li>`);
  html = html.replace(/\s*<div class="contact-company__row"><dt>Btw-id<\/dt><dd>[^<]*<\/dd><\/div>/g, '');
  html = html.replace(/(\n(\s*)<div class="contact-company__row"><dt>KvK-nummer<\/dt><dd>[^<]*<\/dd><\/div>)/, `$1\n$2<div class="contact-company__row"><dt>Btw-id</dt><dd>${btw}</dd></div>`);
  if (html !== before) {
    fs.writeFileSync(p, html);
    report.push(`site/${f}: updated`);
  }
}
console.log(report.join('\n'));
console.log('Next: node dev/seo-heads.mjs && npm run build && npm run check, then commit and push.');
