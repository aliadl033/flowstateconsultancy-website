#!/usr/bin/env node
// Static checks over site/: links & anchors, shared header/footer consistency, page basics,
// and a design-token lint for CSS (raw hex, off-token font sizes and spacing).
//
// Usage: node dev/qa/check-site.mjs [--pages index.html,diensten.html] [--css-only] [--strict]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '../../site');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const only = opt('pages', null);
const strict = !!opt('strict', false);

const problems = [];
const warnings = [];
const P = (file, msg) => problems.push(`${file}: ${msg}`);
const W = (file, msg) => warnings.push(`${file}: ${msg}`);

const htmlFiles = fs.readdirSync(SITE).filter((f) => f.endsWith('.html') && !f.startsWith('_'));
const pages = only ? only.split(',') : htmlFiles;
const read = (f) => fs.readFileSync(path.join(SITE, f), 'utf8');
const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

// ---------- 1. Links, anchors, assets ----------
for (const file of pages) {
  if (!fs.existsSync(path.join(SITE, file))) { P(file, 'page does not exist'); continue; }
  const html = read(file);
  const ids = idsOf(html);
  const refs = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:|data:|javascript:)/.test(ref)) continue;
    const [p, hash] = ref.split('#');
    const target = p ? path.normalize(path.join(SITE, path.dirname(file), p)) : path.join(SITE, file);
    if (p && !fs.existsSync(target)) { P(file, `broken reference "${ref}"`); continue; }
    if (hash) {
      const targetIds = p ? (target.endsWith('.html') ? idsOf(fs.readFileSync(target, 'utf8')) : null) : ids;
      if (targetIds && !targetIds.has(hash)) P(file, `missing anchor "#${hash}" (in ${p || file})`);
    }
  }
  // CSS url() references
}

// ---------- 2. Page basics ----------
for (const file of pages) {
  if (!fs.existsSync(path.join(SITE, file))) continue;
  const html = read(file);
  if (!/<html[^>]*\slang="nl"/.test(html)) P(file, 'missing <html lang="nl">');
  if (!/<title>[^<]{10,}<\/title>/.test(html)) P(file, 'missing/short <title>');
  if (!/<meta name="description" content="[^"]{50,}"/.test(html)) P(file, 'missing/short meta description');
  if (!/<meta name="viewport"/.test(html)) P(file, 'missing viewport meta');
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) P(file, `expected exactly one <h1>, found ${h1}`);
  if (!/<main[^>]*id="main"/.test(html)) P(file, 'missing <main id="main">');
  if (!/class="skip-link"/.test(html)) P(file, 'missing skip link');
  if (/<img(?![^>]*\salt=)[^>]*>/.test(html)) P(file, '<img> without alt');
  if (/style="[^"]*#[0-9a-fA-F]{3,8}/.test(html)) W(file, 'inline style with raw hex color');
  if (/[—–]/.test(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''))) W(file, 'contains an em/en dash (copy rule: no dashes as punctuation)');
}

// ---------- 3. Shared header/footer consistency ----------
const extract = (html, tag, cls) => {
  const re = new RegExp(`<${tag}[^>]*class="${cls}[^"]*"[\\s\\S]*?<\\/${tag}>`);
  const m = html.match(re);
  return m ? m[0] : null;
};
const norm = (s) => s && s.replace(/\saria-current="page"/g, '').replace(/\sdata-current/g, '').replace(/\s+/g, ' ').trim();
const tplFile = fs.existsSync(path.join(SITE, '_template.html')) ? '_template.html' : null;
if (tplFile) {
  const tpl = read(tplFile);
  const tplHeader = norm(extract(tpl, 'header', 'site-header'));
  const tplFooter = norm(extract(tpl, 'footer', 'site-footer'));
  for (const file of pages) {
    if (!fs.existsSync(path.join(SITE, file)) || file === '404.html') continue;
    const html = read(file);
    const h = norm(extract(html, 'header', 'site-header'));
    const f = norm(extract(html, 'footer', 'site-footer'));
    if (!h) P(file, 'missing <header class="site-header">');
    else if (h !== tplHeader) P(file, 'header differs from _template.html (only aria-current may differ)');
    if (!f) P(file, 'missing <footer class="site-footer">');
    else if (f !== tplFooter) P(file, 'footer differs from _template.html');
  }
}

// ---------- 4. CSS token lint ----------
const cssDir = path.join(SITE, 'assets/css');
const cssFiles = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter((f) => f.endsWith('.css')) : [];
const spacingOk = /^(0|auto|inherit|initial|unset|none|100%|50%|1px|2px|-1px|-2px|3px|1em|0\.\d+em|-?0\.\d+em|calc\(.*var\(.*\).*\)|var\(--[\w-]+(?:,\s*var\(--[\w-]+\))?\)|-var\(--[\w-]+\)|calc\(-1 \* var\(--[\w-]+\)\)|max\(.*var.*\)|min\(.*var.*\)|clamp\(.*var.*\))$/;
for (const f of cssFiles) {
  if (f === 'tokens.css' || f === 'fonts.css') continue;
  const css = fs.readFileSync(path.join(cssDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = css.split('\n');
  lines.forEach((line, i) => {
    const ln = `assets/css/${f}:${i + 1}`;
    if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !/url\(/.test(line)) (strict ? P : W)(ln, `raw hex color: ${line.trim()}`);
    const fs_ = line.match(/font-size:\s*([^;]+);/);
    if (fs_ && !/var\(--text-|inherit|1em|100%/.test(fs_[1])) (strict ? P : W)(ln, `font-size not from --text-* tokens: ${fs_[1].trim()}`);
    const sp = line.match(/\b(padding|margin|gap|row-gap|column-gap|padding-(?:top|bottom|left|right|block|inline)(?:-start|-end)?|margin-(?:top|bottom|left|right|block|inline)(?:-start|-end)?)\s*:\s*([^;]+);/);
    if (sp) {
      // split on whitespace at parenthesis depth 0, so nested calc()/clamp() stay whole
      const parts = [];
      let depth = 0, cur = '';
      for (const ch of sp[2].trim()) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (/\s/.test(ch) && depth === 0) { if (cur) parts.push(cur); cur = ''; } else cur += ch;
      }
      if (cur) parts.push(cur);
      for (const part of parts) if (!spacingOk.test(part)) { (strict ? P : W)(ln, `${sp[1]} value "${part}" is off the spacing tokens`); break; }
    }
  });
}

// ---------- Report ----------
console.log(`Checked ${pages.length} page(s), ${cssFiles.length} CSS file(s).`);
if (warnings.length) { console.log(`\nWARNINGS (${warnings.length}):`); for (const w of warnings.slice(0, 80)) console.log('  - ' + w); if (warnings.length > 80) console.log(`  ... ${warnings.length - 80} more`); }
if (problems.length) { console.log(`\nPROBLEMS (${problems.length}):`); for (const p of problems) console.log('  x ' + p); process.exit(1); }
console.log('\nNo blocking problems.');
