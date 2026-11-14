// Flow State blog tooling: shared helpers for build.mjs, check.mjs, indexnow.mjs and serve.mjs.
// No dependencies. Everything here is deterministic: same input, same output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SITE_DIR = path.join(ROOT, 'site');
export const BLOG_OUT_DIR = path.join(SITE_DIR, 'blog');
export const CONTENT_DIR = path.join(ROOT, 'content', 'blog');
export const TOOLS_DIR = path.join(ROOT, 'tools');
export const TEMPLATE_DIR = path.join(TOOLS_DIR, 'templates');
export const CONFIG_FILE = path.join(TOOLS_DIR, 'site.config.json');
export const SITE_TEMPLATE_FILE = path.join(SITE_DIR, '_template.html');

export const HOME_MARKERS = { start: '<!-- blog:latest:start -->', end: '<!-- blog:latest:end -->' };
export const BODY_MARKERS = { start: '<!-- post-body:start -->', end: '<!-- post-body:end -->' };

// Typographic dashes and their look-alikes, written as escapes on purpose: figure dash, en dash, em dash,
// horizontal bar, minus sign, two- and three-em dash, small em dash, small hyphen-minus, fullwidth hyphen-minus.
const DASH_CLASS = '\\u2012\\u2013\\u2014\\u2015\\u2212\\u2e3a\\u2e3b\\ufe58\\ufe63\\uff0d';
export const DASH_CHARS = new RegExp(`[${DASH_CLASS}]`);
export const DASH_CHARS_G = new RegExp(`[${DASH_CLASS}]`, 'g');
// A hyphen used as punctuation between two words ("snel - en goed"): the plain hyphen-minus,
// the Unicode hyphen (U+2010) and the non-breaking hyphen (U+2011).
export const SPACED_HYPHEN = /(?<=[\p{L}\p{N}])\s+[-\u2010\u2011]\s+(?=[\p{L}\p{N}])/u;

// The part of these rules that tools/check_copy.py does not cover (it knows em and en dashes and a spaced
// hyphen-minus); check.mjs runs it over post.md, so the vendored checker stays identical to the original.
export const DASH_LOOKALIKES = /[\u2012\u2015\u2212\u2e3a\u2e3b\ufe58\ufe63\uff0d]|(?<=[\p{L}\p{N}])\s+[\u2010\u2011]\s+(?=[\p{L}\p{N}])/u;

// First dash rule broken in a piece of visible text, as { index, kind }, or null.
export function findDash(text) {
  const s = String(text);
  const a = DASH_CHARS.exec(s);
  const b = SPACED_HYPHEN.exec(s);
  if (!a && !b) return null;
  if (a && (!b || a.index <= b.index)) return { index: a.index, kind: `dash character U+${a[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` };
  return { index: b.index, kind: 'hyphen with spaces around it' };
}

export const toPosix = (p) => p.split(path.sep).join('/');
export const rel = (abs) => toPosix(path.relative(ROOT, abs));

/* ---------- Config ---------- */

export function loadConfig() {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read ${rel(CONFIG_FILE)}: ${err.message}`);
  }
  const problems = [];
  if (!/^https:\/\/[a-z0-9.-]+$/.test(config.siteUrl || '')) problems.push('siteUrl must look like https://example.nl (https, no path, no trailing slash)');
  const org = config.organization || {};
  if (!org.name) problems.push('organization.name is required');
  if (!org.type) problems.push('organization.type is required (a schema.org Organization type, for example ProfessionalService)');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(org.email || '')) problems.push('organization.email must be an e-mail address');
  if (!org.logo || !/^\/[^/]/.test(org.logo.path || '')) problems.push('organization.logo.path must be a root-absolute path such as /assets/img/logo.png');
  if (!config.blog || !Array.isArray(config.blog.categories) || !config.blog.categories.length) problems.push('blog.categories must be a non-empty list');
  if (!config.blog || !Array.isArray(config.blog.servicePaths) || !config.blog.servicePaths.length) problems.push('blog.servicePaths must be a non-empty list');
  if (!Array.isArray(config.staticPages)) problems.push('staticPages must be a list');
  if (!config.indexNow || !/^[a-zA-Z0-9-]{8,128}$/.test(config.indexNow.key || '')) problems.push('indexNow.key must be 8 to 128 characters of a-z, A-Z, 0-9 or hyphen');
  if (!config.defaultImage || !config.defaultImage.path) problems.push('defaultImage.path is required');
  if (problems.length) throw new Error(`Invalid ${rel(CONFIG_FILE)}:\n  * ${problems.join('\n  * ')}`);
  return config;
}

export const absoluteUrl = (config, rootPath) => config.siteUrl + rootPath;
export const blogUrl = (config) => config.siteUrl + config.blog.path;
export const postPath = (slug) => `/blog/${slug}.html`;
export const feedUrl = (config) => `${config.siteUrl}/feed.xml`;
export const sitemapUrl = (config) => `${config.siteUrl}/sitemap.xml`;
export const organizationId = (config) => `${config.siteUrl}/#organization`;
export const websiteId = (config) => `${config.siteUrl}/#website`;
export const pageTitle = (config, seoTitle) => `${seoTitle}${config.titleSuffix}`;
export const maxSeoTitleLength = (config) => Math.min(52, config.maxTitleLength - config.titleSuffix.length);

// Placeholders such as [KVK-NUMMER] are filled in later; never publish them as structured data.
export const isPlaceholder = (value) => typeof value !== 'string' || !value.trim() || /^\[[^\]]*\]$/.test(value.trim());

/* ---------- Dates (Europe/Amsterdam, no ICU dependency) ---------- */

const MONTHS_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const MONTHS_NL_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value : '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null;
  return { y, m: mo, d, utc };
}

export function formatDateNl(iso) {
  const p = parseIsoDate(iso);
  return p ? `${p.d} ${MONTHS_NL[p.m - 1]} ${p.y}` : iso;
}

export function formatDateNlShort(iso) {
  const p = parseIsoDate(iso);
  return p ? `${p.d} ${MONTHS_NL_SHORT[p.m - 1]} ${p.y}` : iso;
}

function lastSundayOf(year, monthIndex) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

// UTC offset in hours for 00:00 local time in Amsterdam on that date (CET +1, CEST +2).
// Summer time starts at 02:00 on the last Sunday of March and ends at 03:00 on the last Sunday of October,
// so at midnight on both switch days the previous offset still applies.
export function amsterdamOffsetHours(iso) {
  const p = parseIsoDate(iso);
  const marchSwitch = lastSundayOf(p.y, 2);
  const octoberSwitch = lastSundayOf(p.y, 9);
  const summer = (p.m === 3 && p.d > marchSwitch) || (p.m > 3 && p.m < 10) || (p.m === 10 && p.d <= octoberSwitch);
  return summer ? 2 : 1;
}

// Publication moments are stored as dates; they are published as 00:00 Amsterdam time on that date.
export const isoDateTime = (iso) => `${iso}T00:00:00+0${amsterdamOffsetHours(iso)}:00`;

export function rfc822(iso) {
  const p = parseIsoDate(iso);
  return `${DAYS_EN[p.utc.getUTCDay()]}, ${String(p.d).padStart(2, '0')} ${MONTHS_EN[p.m - 1]} ${p.y} 00:00:00 +0${amsterdamOffsetHours(iso)}00`;
}

export function todayInAmsterdam(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/* ---------- Escaping and text ---------- */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '\u2026', middot: '\u00b7', copy: '\u00a9', euro: '\u20ac', mdash: '\u2014', ndash: '\u2013', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', bdquo: '\u201e', eacute: '\u00e9', euml: '\u00eb', iuml: '\u00ef' };

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const v = NAMED_ENTITIES[ent.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// Removes everything a visitor never sees as text: head, comments, scripts, styles, templates.
export function stripInvisible(html) {
  return String(html)
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
}

export function htmlToText(html) {
  return decodeEntities(stripInvisible(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function countWords(text) {
  return String(text).split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function firstWords(text, n) {
  return String(text).split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).slice(0, n).join(' ');
}

/* ---------- Typographic quotes ---------- */
// Straight quotes become curly ones, like the quotes on the homepage. Never touches dashes.

const WORD_CHAR = /[\p{L}\p{N}]/u;
const OPENS_AFTER = /[\s([{\u00a0\u2018\u201c]/;
const ELISION = /^(?:[stn](?![\p{L}\p{N}])|\d)/u; // Dutch 's, 't, 'n and years such as '26

function curlyQuote(ch, prev, rest) {
  const opening = prev === '' || OPENS_AFTER.test(prev);
  if (ch === '"') return opening ? '\u201c' : '\u201d';
  if (WORD_CHAR.test(prev)) return '\u2019'; // auto's, or a closing single quote
  if (ELISION.test(rest)) return '\u2019';
  return opening ? '\u2018' : '\u2019';
}

export function smartQuotes(text) {
  const s = String(text);
  let prev = '';
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      const q = curlyQuote(ch, prev, s.slice(i + 1, i + 4));
      out += q;
      prev = q;
    } else {
      out += ch;
      prev = ch;
    }
  }
  return out;
}

// The same for rendered HTML: only text between tags changes (never attributes), code and pre stay
// as they are, and a block-level tag starts a new sentence context.
const QUOTE_BLOCK_TAG = /^<\/?(?:p|li|h[1-6]|blockquote|td|th|tr|table|thead|tbody|ul|ol|div|section|br|hr|figure|figcaption|dt|dd|dl|summary|details)\b/i;
const HTML_UNIT = /&(?:#\d+|#x[0-9a-f]+|[a-z]+);|[\s\S]/gi;

export function smartQuotesHtml(html) {
  let prev = '';
  let raw = 0;
  return String(html).replace(/<[^>]*>|[^<]+/g, (part) => {
    if (part[0] === '<') {
      if (/^<(?:code|pre|script|style)\b/i.test(part)) raw += 1;
      else if (/^<\/(?:code|pre|script|style)\s*>/i.test(part)) raw = Math.max(0, raw - 1);
      if (QUOTE_BLOCK_TAG.test(part)) prev = '';
      return part;
    }
    const units = part.match(HTML_UNIT) || [];
    const plain = (u) => (u.length > 1 ? decodeEntities(u) : u);
    let out = '';
    for (let i = 0; i < units.length; i++) {
      const ch = plain(units[i]);
      if (!raw && (ch === '"' || ch === "'")) {
        const q = curlyQuote(ch, prev, units.slice(i + 1, i + 4).map(plain).join(''));
        out += q;
        prev = q;
      } else {
        out += units[i];
        if (ch) prev = ch.slice(-1);
      }
    }
    return out;
  });
}

export function slugify(text) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' en ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug || 'sectie';
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* ---------- Files ---------- */

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

export function writeIfChanged(file, content) {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return false;
  } catch {
    // file does not exist yet
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

export function gitLastCommitDate(absFile) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', rel(absFile)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

// Last modification as W3C datetime: last git commit touching the file, file mtime as fallback.
export function lastModified(absFile) {
  const fromGit = gitLastCommitDate(absFile);
  if (fromGit) return fromGit;
  const stat = fs.statSync(absFile);
  return new Date(Math.floor(stat.mtimeMs / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

/* ---------- URLs and site files ---------- */

// site-relative file (posix) to its public URL
export function urlForFile(config, relFile) {
  if (relFile === 'index.html') return `${config.siteUrl}/`;
  if (relFile.endsWith('/index.html')) return `${config.siteUrl}/${relFile.slice(0, -'index.html'.length)}`;
  return `${config.siteUrl}/${relFile}`;
}

// Root-absolute URL path to the site file that GitHub Pages would serve for it, or null.
export function fileForUrlPath(urlPath) {
  let p = String(urlPath).split('#')[0].split('?')[0];
  if (!p.startsWith('/') || p.startsWith('//')) return null;
  try {
    p = decodeURIComponent(p);
  } catch {
    return null;
  }
  p = p.replace(/^\/+/, '');
  if (p.split('/').some((seg) => seg === '..')) return null;
  const candidates = p === '' || p.endsWith('/') ? [`${p}index.html`] : [p, `${p}.html`, `${p}/index.html`];
  for (const c of candidates) {
    const abs = path.join(SITE_DIR, c);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return c;
  }
  return null;
}

export function idsInHtml(html) {
  return [...String(html).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
}

/* ---------- Templates ---------- */

// {{ key }} is HTML-escaped, {{{ key }}} is inserted as is. Unknown keys are an error.
// A {{{ key }}} alone on its line is indented like that line; an empty value removes the line
// together with one blank line after it.
// One pass over the template only: inserted values (a post body, the footer) are never scanned again,
// so "{{voornaam}}" written in a post stays text and can never pull in another value.
const PLACEHOLDER = /^([ \t]*)\{\{\{\s*(\w+)\s*\}\}\}[ \t]*\n((?:[ \t]*\n)?)|\{\{\{\s*(\w+)\s*\}\}\}|\{\{\s*(\w+)\s*\}\}/gm;

export function fillTemplate(template, data, name) {
  const missing = new Set();
  const lookup = (key) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      missing.add(key);
      return null;
    }
    return data[key] == null ? '' : String(data[key]);
  };
  const out = template.replace(PLACEHOLDER, (match, pad, lineKey, blank, rawKey, escapedKey) => {
    if (lineKey !== undefined) {
      const value = lookup(lineKey);
      if (value === null) return match;
      const trimmed = value.replace(/\s+$/, '');
      if (!trimmed) return '';
      return `${trimmed.split('\n').map((line) => (line ? pad + line : line)).join('\n')}\n${blank}`;
    }
    const value = lookup(rawKey || escapedKey);
    if (value === null) return match;
    return rawKey ? value : escapeHtml(value);
  });
  if (missing.size) throw new Error(`Template ${name} uses unknown placeholder(s): ${[...missing].join(', ')}`);
  return out;
}

// JSON for inside <script type="application/ld+json">: never lets "</script>" through.
export const jsonForScript = (value) => JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
