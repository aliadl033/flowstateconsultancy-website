#!/usr/bin/env node
// One-off integration pass after the page builders finish.
// 1. Replaces the header and footer of every static page with the canonical blocks from site/_template.html
//    and re-applies aria-current per page.
// 2. Fills in the company details and contact e-mail.
// 3. Converts relative href/src values to root-absolute URLs ("/diensten.html", "/" for home).
// 4. Adds the "latest blog posts" markers to the homepage (before the CTA band) if missing.
// Usage: node dev/integrate.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '../site');
const dry = process.argv.includes('--dry');

const DETAILS = {
  '[KVK-NUMMER]': '98730185',
  '[STRAAT HUISNUMMER]': 'Bredesteeg 6',
  '[POSTCODE PLAATS]': '3811 WS Amersfoort',
  'info@flowstateconsultancy.nl': 'ali@flowstateconsultancy.nl',
};
const BTW_ID = process.env.BTW_ID || null; // when unknown, lines with [BTW-ID] are removed

const pageFiles = fs.readdirSync(SITE).filter((f) => f.endsWith('.html'));
const template = fs.readFileSync(path.join(SITE, '_template.html'), 'utf8');
const block = (html, tag, cls) => {
  const re = new RegExp(`<${tag}[^>]*class="${cls}[^"]*"[\\s\\S]*?<\\/${tag}>`);
  const m = html.match(re);
  return m ? m[0] : null;
};

const urlFor = (file) => (file === 'index.html' ? '/' : '/' + file);

function toRootAbsolute(html) {
  return html.replace(/(\s(?:href|src))="([^"]*)"/g, (all, attr, val) => {
    if (!val || /^(\/|#|[a-z][a-z0-9+.-]*:)/i.test(val)) return all;
    let v = val;
    if (v === 'index.html') v = '/';
    else if (v.startsWith('index.html#')) v = '/' + v.slice('index.html'.length);
    else v = '/' + v.replace(/^\.\//, '');
    return `${attr}="${v}"`;
  });
}

function applyCurrent(html, file) {
  const current = urlFor(file);
  // remove existing aria-current, then set it on links that point exactly to this page
  let out = html.replace(/\saria-current="page"/g, '');
  out = out.replace(/<a([^>]*?)\shref="([^"]+)"([^>]*)>/g, (all, pre, href, post) => {
    const inChrome = true;
    if (!inChrome) return all;
    if (/class="brand"/.test(pre + post)) return all;
    return href === current ? `<a${pre} href="${href}"${post} aria-current="page">` : all;
  });
  return out;
}

function fillDetails(html) {
  let out = html;
  for (const [from, to] of Object.entries(DETAILS)) out = out.split(from).join(to);
  if (BTW_ID) out = out.split('[BTW-ID]').join(BTW_ID);
  else {
    // drop list items / definition rows / sentences that only carry the btw placeholder
    out = out.replace(/\s*<li>[^<]*(?:<span>)?Btw-id \[BTW-ID\](?:<\/span>)?<\/li>/g, '');
    out = out.replace(/\s*<div[^>]*>\s*<dt[^>]*>\s*Btw-id\s*<\/dt>\s*<dd[^>]*>\s*\[BTW-ID\]\s*<\/dd>\s*<\/div>/g, '');
    out = out.replace(/\s*<dt[^>]*>\s*Btw-id\s*<\/dt>\s*<dd[^>]*>\s*\[BTW-ID\]\s*<\/dd>/g, '');
  }
  return out;
}

const report = [];
const tplHeader = toRootAbsolute(fillDetails(block(template, 'header', 'site-header')));
const tplFooter = toRootAbsolute(fillDetails(block(template, 'footer', 'site-footer')));

for (const file of pageFiles) {
  const p = path.join(SITE, file);
  let html = fs.readFileSync(p, 'utf8');
  const before = html;
  if (!file.startsWith('_')) {
    const h = block(html, 'header', 'site-header');
    if (h) html = html.replace(h, tplHeader);
    const f = block(html, 'footer', 'site-footer');
    if (f) html = html.replace(f, tplFooter);
  }
  html = fillDetails(html);
  html = toRootAbsolute(html);
  if (!file.startsWith('_')) {
    // aria-current only inside header and footer chrome
    const h2 = block(html, 'header', 'site-header');
    if (h2) html = html.replace(h2, applyCurrent(h2, file));
  }
  if (file === 'index.html' && !html.includes('<!-- blog:latest:start -->')) {
    const marker = '\n    <!-- blog:latest:start -->\n    <!-- blog:latest:end -->\n';
    const idx = html.search(/<section[^>]*class="[^"]*cta-band/);
    if (idx !== -1) html = html.slice(0, idx) + marker.trimStart() + '    ' + html.slice(idx);
    else report.push('index.html: no cta-band found for blog markers');
  }
  const leftovers = (html.match(/\[(KVK-NUMMER|BTW-ID|STRAAT HUISNUMMER|POSTCODE PLAATS)\]/g) || []);
  if (leftovers.length) report.push(`${file}: leftover placeholders ${[...new Set(leftovers)].join(', ')}`);
  if (html !== before) {
    report.push(`${file}: updated`);
    if (!dry) fs.writeFileSync(p, html);
  }
}
console.log(report.join('\n'));
