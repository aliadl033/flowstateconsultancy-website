#!/usr/bin/env node
// Flow State blog checks (npm run check). Exits 1 when anything blocking is found.
//
//   node tools/check.mjs            blog pages, posts, sitemap, feed, robots.txt and IndexNow key are blocking;
//                                   problems in the static pages are reported as warnings
//   node tools/check.mjs --strict   static page problems are blocking too
//
// Never weaken these checks to get a post through. Fix the post instead.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BLOG_OUT_DIR,
  BODY_MARKERS,
  DASH_LOOKALIKES,
  HOME_MARKERS,
  ROOT,
  SITE_DIR,
  TOOLS_DIR,
  blogUrl,
  countWords,
  decodeEntities,
  feedUrl,
  fileForUrlPath,
  findDash,
  htmlToText,
  idsInHtml,
  loadConfig,
  readText,
  rel,
  sitemapUrl,
  slugify,
  urlForFile,
} from './lib/shared.mjs';
import { loadPosts } from './lib/content.mjs';
import { renderHomeLatest } from './lib/render.mjs';

const strict = process.argv.includes('--strict');
const problems = [];
const warnings = [];
const problem = (where, msg) => problems.push(`${where}: ${msg}`);
const warning = (where, msg) => warnings.push(`${where}: ${msg}`);

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const siteHost = new URL(config.siteUrl).host;

/* ---------- Content ---------- */

const { posts, errors } = loadPosts(config);
for (const e of errors) problems.push(e);
const postByFile = new Map(posts.map((p) => [p.file, p]));

/* ---------- HTML helpers ---------- */

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag);
  return m ? decodeEntities(m[2]) : null;
};
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
const metaContent = (html, key, value) => tags(html, 'meta').filter((t) => attr(t, key) === value).map((t) => attr(t, 'content'));

// Markup with script/style bodies and comments removed (attributes of <script src> are kept).
const markupOnly = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, '<script$1></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

function between(html, start, end) {
  const s = html.indexOf(start);
  const e = html.indexOf(end, s + start.length);
  return s === -1 || e === -1 ? null : html.slice(s + start.length, e);
}

const idCache = new Map();
function idsOfFile(relFile) {
  if (!idCache.has(relFile)) idCache.set(relFile, new Set(idsInHtml(readText(path.join(SITE_DIR, relFile)))));
  return idCache.get(relFile);
}

// Checks one href/src. Returns an error message or null.
function checkRef(ref, pageRel, pageIds, { rootAbsoluteOnly }) {
  if (/^(mailto:|tel:|data:)/i.test(ref)) return null;
  if (/^http:\/\//i.test(ref)) return `insecure http link "${ref}"`;
  if (ref.startsWith('//')) return `protocol-relative link "${ref}"`;
  if (/^javascript:/i.test(ref)) return `javascript link "${ref}"`;
  let target = ref;
  if (/^https:\/\//i.test(ref)) {
    let u;
    try {
      u = new URL(ref);
    } catch {
      return `invalid URL "${ref}"`;
    }
    if (u.host !== siteHost) return null;
    target = u.pathname + (u.hash || '');
  }
  if (target.startsWith('#')) {
    const id = decodeURIComponent(target.slice(1));
    return id === '' || pageIds.has(id) ? null : `anchor "${target}" does not exist on this page`;
  }
  if (!target.startsWith('/')) {
    if (rootAbsoluteOnly) return `relative URL "${ref}"; blog pages use root-absolute URLs ("/${ref}")`;
    target = `/${path.posix.normalize(path.posix.join(path.posix.dirname(pageRel), target))}`;
  }
  const [pathPart, hash] = target.split('#');
  const file = fileForUrlPath(pathPart);
  if (!file) return `broken link "${ref}"`;
  if (hash && file.endsWith('.html') && !idsOfFile(file).has(decodeURIComponent(hash))) return `anchor "#${hash}" does not exist in /${file}`;
  return null;
}

function visibleTextWithAttributes(html) {
  const parts = [htmlToText(html)];
  const body = markupOnly(html.replace(/<head\b[\s\S]*?<\/head>/i, ''));
  for (const m of body.matchAll(/\s(?:alt|title|aria-label|placeholder)\s*=\s*"([^"]*)"/gi)) parts.push(decodeEntities(m[1]));
  for (const key of ['description']) parts.push(...metaContent(html, 'name', key));
  for (const key of ['og:title', 'og:description', 'og:image:alt']) parts.push(...metaContent(html, 'property', key));
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (title) parts.push(decodeEntities(title[1]));
  return parts.join('\n');
}

/* ---------- Page checks ---------- */

function checkPage(pageRel, { report, kind }) {
  const html = readText(path.join(SITE_DIR, pageRel));
  const where = `site/${pageRel}`;
  const markup = markupOnly(html);
  const ids = idsInHtml(markup);
  const idSet = new Set(ids);

  if (!/<html\b[^>]*\slang="nl"/i.test(html)) report(where, 'missing <html lang="nl">');

  const titles = [...html.matchAll(/<title>([\s\S]*?)<\/title>/gi)].map((m) => decodeEntities(m[1]).trim());
  if (titles.length !== 1) report(where, `expected one <title>, found ${titles.length}`);
  else if (titles[0].length < 10 || titles[0].length > config.maxTitleLength) report(where, `<title> is ${titles[0].length} characters, must be 10 to ${config.maxTitleLength}: "${titles[0]}"`);

  const descriptions = metaContent(html, 'name', 'description');
  if (descriptions.length !== 1) report(where, `expected one meta description, found ${descriptions.length}`);
  else if (descriptions[0].length < 50 || descriptions[0].length > 160) report(where, `meta description is ${descriptions[0].length} characters, must be 50 to 160`);

  // The 404 page is served for every unknown URL: no canonical, and noindex is correct there.
  const notFound = pageRel === '404.html';
  const canonicals = tags(html, 'link').filter((t) => (attr(t, 'rel') || '').toLowerCase() === 'canonical').map((t) => attr(t, 'href'));
  const expected = urlForFile(config, pageRel);
  if (notFound) {
    if (canonicals.length) report(where, 'the 404 page should not have a canonical link');
  } else if (canonicals.length !== 1) report(where, `expected one <link rel="canonical">, found ${canonicals.length}`);
  else if (!canonicals[0].startsWith(`${config.siteUrl}/`)) report(where, `canonical must be an absolute ${config.siteUrl}/ URL, found "${canonicals[0]}"`);
  else if (kind !== 'static' && canonicals[0] !== expected) report(where, `canonical is "${canonicals[0]}", expected "${expected}"`);

  const robots = metaContent(html, 'name', 'robots').join(',').toLowerCase();
  if (!notFound && /noindex|none/.test(robots)) report(where, `meta robots blocks indexing ("${robots}")`);
  if (kind !== 'static' && !/index,\s*follow/.test(robots)) report(where, 'missing <meta name="robots" content="index,follow,...">');

  const h1 = (markup.match(/<h1[\s>]/gi) || []).length;
  if (h1 !== 1) report(where, `expected exactly one <h1>, found ${h1}`);

  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) report(where, `duplicate id(s): ${[...new Set(dupes)].join(', ')}`);

  for (const t of tags(markup, 'img')) if (attr(t, 'alt') === null) report(where, `<img> without alt: ${t.slice(0, 80)}`);

  const refs = [...markup.matchAll(/\s(?:href|src)\s*=\s*"([^"]*)"/gi)].map((m) => decodeEntities(m[1]));
  for (const ref of new Set(refs)) {
    const msg = checkRef(ref, pageRel, idSet, { rootAbsoluteOnly: kind !== 'static' });
    if (msg) report(where, msg);
  }

  const visible = visibleTextWithAttributes(html);
  const dash = findDash(visible);
  if (dash) report(where, `dash as punctuation in visible text (${dash.kind}): "...${visible.slice(Math.max(0, dash.index - 40), dash.index + 40).replace(/\s+/g, ' ')}..."`);

  if (kind !== 'static') {
    // One contact address everywhere: a stale template must not put a second address on the blog.
    const email = config.organization.email.toLowerCase();
    for (const ref of new Set(refs)) {
      if (!/^mailto:/i.test(ref)) continue;
      const address = ref.slice('mailto:'.length).split('?')[0].trim().toLowerCase();
      if (address !== email) report(where, `mailto address "${address}" differs from organization.email "${email}" in tools/site.config.json`);
    }
    for (const m of htmlToText(markup).matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
      if (m[0].toLowerCase() !== email) report(where, `visible e-mail address "${m[0]}" differs from organization.email "${email}"`);
    }
    // The homepage is "/", never "/index.html" (a duplicate of the canonical URL).
    for (const ref of new Set(refs)) if (/^\/index\.html(?:[#?]|$)/i.test(ref)) report(where, `link to "${ref}"; link to "/${ref.slice('/index.html'.length)}" instead`);
    // Typographic quotes in everything the build writes: titles, descriptions and the page content.
    const main = /<main\b[\s\S]*?<\/main>/i.exec(markup);
    const ownText = [main ? htmlToText(main[0]) : '', ...titles, ...descriptions, ...metaContent(html, 'property', 'og:title'), ...metaContent(html, 'property', 'og:description')].join('\n');
    const straight = ownText.indexOf('"');
    if (straight !== -1) report(where, `straight double quote in visible text: "...${ownText.slice(Math.max(0, straight - 40), straight + 40).replace(/\s+/g, ' ')}..." (the build converts quotes; rebuild with npm run build)`);
  }

  const ldBlocks = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const graphs = [];
  for (const block of ldBlocks) {
    try {
      graphs.push(JSON.parse(block));
    } catch (err) {
      report(where, `JSON-LD does not parse: ${err.message}`);
    }
  }
  if (kind !== 'static' && ldBlocks.length !== 1) report(where, `expected one JSON-LD block, found ${ldBlocks.length}`);
  return { html, markup, graphs, where };
}

const nodesOf = (graphs) => graphs.flatMap((g) => (Array.isArray(g['@graph']) ? g['@graph'] : [g]));
const typeOf = (nodes, type) => nodes.filter((n) => n['@type'] === type);

function checkStructuredData(where, graphs, kind, post) {
  const nodes = nodesOf(graphs);
  const org = nodes.find((n) => n['@id'] === `${config.siteUrl}/#organization`);
  if (!org) problem(where, 'JSON-LD: organisation node with @id .../#organization is missing');
  else if (org['@type'] !== config.organization.type) problem(where, `JSON-LD: the organisation must have @type ${config.organization.type}, the same as on the homepage`);
  else if (!org.logo || !org.name || !org.url) problem(where, 'JSON-LD: the organisation needs name, url and logo');
  const site = nodes.find((n) => n['@id'] === `${config.siteUrl}/#website`);
  if (!site || site['@type'] !== 'WebSite') problem(where, 'JSON-LD: WebSite node with @id .../#website is missing');
  if (!typeOf(nodes, 'BreadcrumbList').length) problem(where, 'JSON-LD: BreadcrumbList is missing');
  if (kind === 'index' && !typeOf(nodes, 'Blog').length) problem(where, 'JSON-LD: Blog is missing');
  if (kind !== 'post') return;
  const article = typeOf(nodes, 'BlogPosting')[0];
  if (!article) return problem(where, 'JSON-LD: BlogPosting is missing');
  for (const key of ['headline', 'description', 'datePublished', 'dateModified', 'inLanguage', 'author', 'publisher', 'mainEntityOfPage', 'image', 'keywords', 'articleSection']) {
    if (article[key] === undefined || article[key] === '') problem(where, `JSON-LD: BlogPosting.${key} is missing`);
  }
  if (article.headline && article.headline.length > 110) problem(where, 'JSON-LD: headline is longer than 110 characters');
  if (article.publisher && article.publisher['@id'] !== `${config.siteUrl}/#organization`) problem(where, 'JSON-LD: publisher must reference the Organization @id');
  const faqNodes = typeOf(nodes, 'FAQPage');
  const hasFaq = !!(post.meta.faq && post.meta.faq.length);
  if (hasFaq && faqNodes.length !== 1) problem(where, 'JSON-LD: FAQPage is missing while the post has FAQ entries');
  if (!hasFaq && faqNodes.length) problem(where, 'JSON-LD: FAQPage present but the post has no FAQ entries');
}

function checkPostBody(where, html, post) {
  const body = between(html, BODY_MARKERS.start, BODY_MARKERS.end);
  if (body === null) return problem(where, 'post body markers are missing (rebuild with npm run build)');
  const words = countWords(htmlToText(body));
  const { minWords, maxWords } = config.blog;
  if (words < minWords || words > maxWords) problem(where, `post has ${words} words, must be ${minWords} to ${maxWords}`);

  const hrefs = [...body.matchAll(/<a\b[^>]*\shref="([^"]*)"/gi)].map((m) => decodeEntities(m[1]));
  const servicePaths = config.blog.servicePaths;
  if (!hrefs.some((h) => servicePaths.includes(h.split('#')[0]))) problem(where, `post has no internal link to a service page (${servicePaths.join(', ')})`);
  for (const h of hrefs) if (/^http:\/\//i.test(h)) problem(where, `post links to a non-https URL: ${h}`);

  // Every source is linked in the text, and every external link is one of the sources: the agents read
  // untrusted web pages, so a link that nobody listed (spam, affiliate, injected) never gets published.
  const linked = new Set(hrefs.map(normUrl));
  const sourceUrls = new Set(post.meta.sources.map((s) => normUrl(s.url)));
  for (const s of post.meta.sources) {
    if (!/^https:\/\//i.test(s.url)) problem(where, `source is not https: ${s.url}`);
    if (!linked.has(normUrl(s.url))) problem(where, `source "${s.title}" (${s.url}) is listed in meta.json but not linked in the text`);
  }
  for (const h of new Set(hrefs)) {
    if (!/^https:\/\//i.test(h)) continue;
    let host = '';
    try {
      host = new URL(h).host;
    } catch {
      continue; // reported by the link check
    }
    if (host !== siteHost && !sourceUrls.has(normUrl(h))) problem(where, `external link ${h} is not one of the sources in meta.json; link only to listed sources`);
  }
  for (const link of post.meta.internalLinks) {
    const msg = checkRef(link, post.file, new Set(), { rootAbsoluteOnly: true });
    if (msg) problem(`content/blog/${post.slug}/meta.json`, `internalLinks: ${msg}`);
  }
}

function normUrl(url) {
  let u = String(url).trim();
  try {
    u = encodeURI(decodeURI(u));
  } catch {
    // keep as is
  }
  return u.replace(/\/$/, '');
}

// Link texts that say nothing about the target (bad for search engines and screen reader users).
const GENERIC_ANCHORS = new Set([
  'hier', 'klik hier', 'klik', 'hierzo', 'zie hier', 'bekijk hier', 'bekijk', 'via deze link', 'deze link', 'link',
  'lees meer', 'lees verder', 'meer', 'meer info', 'meer informatie', 'info', 'informatie', 'deze pagina', 'pagina',
  'website', 'deze website', 'bron', 'deze bron', 'dit artikel', 'artikel', 'download', 'nu lezen',
  'here', 'click here', 'read more', 'learn more', 'more', 'this', 'this link', 'link here',
]);

// SEO assertions the review used to cover by hand: the primary keyword (or all its words) in the title,
// seoTitle, description, slug, the first 100 words and at least one H2; descriptive link texts.
function checkPostSeo(post) {
  const where = `content/blog/${post.slug}`;
  const words = post.meta.primaryKeyword.toLowerCase().split(/\s+/).filter(Boolean);
  const hasAll = (text) => {
    const t = String(text).toLowerCase();
    return words.every((w) => t.includes(w));
  };
  const kw = `"${post.meta.primaryKeyword}"`;
  if (!hasAll(post.meta.title)) problem(where, `primary keyword ${kw} (or all its words) is missing from the title`);
  if (!hasAll(post.meta.seoTitle)) problem(where, `primary keyword ${kw} (or all its words) is missing from the seoTitle`);
  if (!hasAll(post.meta.description)) problem(where, `primary keyword ${kw} (or all its words) is missing from the description`);
  if (!words.every((w) => post.slug.includes(slugify(w)))) problem(where, `primary keyword ${kw} is missing from the slug`);
  if (!hasAll(post.intro)) problem(where, `primary keyword ${kw} (or all its words) is missing from the first 100 words of post.md`);
  if (!post.headings.some((h) => h.depth === 2 && hasAll(h.text))) problem(where, `primary keyword ${kw} (or all its words) is in no ## heading`);
  for (const link of post.links) {
    const text = link.text.toLowerCase().replace(/[.,:;!?()"'\u2018\u2019\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim();
    if (GENERIC_ANCHORS.has(text)) problem(where, `link text "${link.text}" says nothing about the target (${link.href}); describe where the link goes`);
    if (!text) problem(where, `link without text: ${link.href}`);
  }
  // Dash look-alikes the copy checker does not know (minus sign, Unicode hyphens with spaces, fullwidth dashes).
  post.markdown.split('\n').forEach((line, i) => {
    const m = DASH_LOOKALIKES.exec(line);
    if (m) problem(`${where}/post.md:${i + 1}`, `dash as punctuation (U+${m[0].trim().codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}): "${line.slice(Math.max(0, m.index - 30), m.index + 30)}"`);
  });
}

/* ---------- Blog pages ---------- */

for (const post of posts) checkPostSeo(post);

const expectedBlogFiles = new Set(['blog/index.html', ...posts.map((p) => p.file)]);
const actualBlogFiles = fs.existsSync(BLOG_OUT_DIR)
  ? fs.readdirSync(BLOG_OUT_DIR).filter((f) => f.endsWith('.html')).map((f) => `blog/${f}`).sort()
  : [];
for (const f of expectedBlogFiles) if (!actualBlogFiles.includes(f)) problem(`site/${f}`, 'is missing; run npm run build');
for (const f of actualBlogFiles) if (!expectedBlogFiles.has(f)) problem(`site/${f}`, 'has no post in content/blog; run npm run build');

let blogPagesChecked = 0;
for (const f of actualBlogFiles.filter((x) => expectedBlogFiles.has(x))) {
  const post = postByFile.get(f);
  const kind = post ? 'post' : 'index';
  const { html, where, graphs } = checkPage(f, { report: problem, kind });
  checkStructuredData(where, graphs, kind, post);
  if (post) checkPostBody(where, html, post);
  blogPagesChecked += 1;
}

/* ---------- Static pages (warnings unless --strict) ---------- */

const staticFiles = fs
  .readdirSync(SITE_DIR)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .sort();
for (const f of staticFiles) {
  const report = strict ? problem : warning;
  const { where } = checkPage(f, { report, kind: 'static' });
  const page = config.staticPages.find((p) => p.file === f);
  const html = readText(path.join(SITE_DIR, f));
  const canonical = tags(html, 'link').find((t) => (attr(t, 'rel') || '').toLowerCase() === 'canonical');
  if (page && canonical && attr(canonical, 'href') !== config.siteUrl + page.path) {
    report(where, `canonical "${attr(canonical, 'href')}" differs from the sitemap URL "${config.siteUrl + page.path}" (tools/site.config.json)`);
  }
}

/* ---------- Homepage teaser ---------- */

const homeFile = path.join(SITE_DIR, 'index.html');
if (fs.existsSync(homeFile)) {
  const html = readText(homeFile);
  const inner = between(html, HOME_MARKERS.start, HOME_MARKERS.end);
  if (inner !== null) {
    const head = html.slice(0, Math.max(0, html.search(/<\/head>/i)));
    const expectedBlock = renderHomeLatest(posts, config, !/href="\/?assets\/css\/blog\.css"/.test(head));
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    if (norm(inner) !== norm(expectedBlock)) problem('site/index.html', 'the latest posts between the blog:latest markers are out of date; run npm run build');
  }
}

/* ---------- sitemap.xml, feed.xml, robots.txt, IndexNow key ---------- */

const sitemapFile = path.join(SITE_DIR, 'sitemap.xml');
const feedFile = path.join(SITE_DIR, 'feed.xml');
const xmlFiles = [sitemapFile, feedFile].filter((f) => {
  if (fs.existsSync(f)) return true;
  problem(rel(f), 'is missing; run npm run build');
  return false;
});
if (xmlFiles.length) {
  const code = [
    'import sys',
    'from xml.dom import minidom',
    'bad = 0',
    'for f in sys.argv[1:]:',
    '    try:',
    '        minidom.parse(f)',
    '    except Exception as e:',
    '        print(f + ": " + str(e))',
    '        bad = 1',
    'sys.exit(bad)',
  ].join('\n');
  const r = spawnSync('python3', ['-I', '-c', code, ...xmlFiles], { encoding: 'utf8' });
  if (r.error) problem('xml', `python3 is needed for the XML check: ${r.error.message}`);
  else if (r.status !== 0) problem('xml', `not well-formed XML: ${(r.stdout + r.stderr).trim()}`);
}

let sitemapCount = 0;
if (fs.existsSync(sitemapFile)) {
  const xml = readText(sitemapFile);
  if (!xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')) problem('site/sitemap.xml', 'missing <urlset> with the sitemap namespace');
  const entries = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?\s*<\/url>/g)].map((m) => ({ loc: decodeEntities(m[1]), lastmod: m[2] }));
  sitemapCount = entries.length;
  const locs = new Set();
  for (const { loc, lastmod } of entries) {
    if (locs.has(loc)) problem('site/sitemap.xml', `duplicate URL ${loc}`);
    locs.add(loc);
    if (!loc.startsWith(`${config.siteUrl}/`)) problem('site/sitemap.xml', `URL outside ${config.siteUrl}: ${loc}`);
    else if (!fileForUrlPath(new URL(loc).pathname)) problem('site/sitemap.xml', `URL has no page: ${loc}`);
    if (!lastmod || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/.test(lastmod)) problem('site/sitemap.xml', `missing or invalid lastmod for ${loc}`);
  }
  for (const f of expectedBlogFiles) if (!locs.has(urlForFile(config, f))) problem('site/sitemap.xml', `missing ${urlForFile(config, f)}`);
  for (const p of config.staticPages) if (fs.existsSync(path.join(SITE_DIR, p.file)) && !locs.has(config.siteUrl + p.path)) problem('site/sitemap.xml', `missing ${config.siteUrl + p.path}`);
}

let feedCount = 0;
if (fs.existsSync(feedFile)) {
  const xml = readText(feedFile);
  if (!/<rss version="2\.0"[^>]*xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom"/.test(xml)) problem('site/feed.xml', 'must be RSS 2.0 with the Atom namespace');
  if (!xml.includes(`<atom:link href="${feedUrl(config)}" rel="self" type="application/rss+xml"/>`)) problem('site/feed.xml', 'missing atom:link rel="self"');
  if (!xml.includes(`<link>${blogUrl(config)}</link>`)) problem('site/feed.xml', 'channel link must be the blog URL');
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  feedCount = items.length;
  const expectedCount = Math.min(config.blog.feedItems || 20, posts.length);
  if (items.length !== expectedCount) problem('site/feed.xml', `has ${items.length} items, expected ${expectedCount}; run npm run build`);
  const postUrls = new Set(posts.map((p) => p.url));
  for (const item of items) {
    const link = /<link>([^<]+)<\/link>/.exec(item);
    if (!link || !postUrls.has(decodeEntities(link[1]))) problem('site/feed.xml', `item link is not a post URL: ${link ? link[1] : '(none)'}`);
    if (!/<guid isPermaLink="true">https:\/\/[^<]+<\/guid>/.test(item)) problem('site/feed.xml', 'item without a permalink guid');
    if (!/<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}<\/pubDate>/.test(item)) problem('site/feed.xml', 'item without a valid RFC 822 pubDate');
  }
}

const robotsFile = path.join(SITE_DIR, 'robots.txt');
if (!fs.existsSync(robotsFile)) problem('site/robots.txt', 'is missing');
else {
  const robots = readText(robotsFile);
  if (!robots.split(/\r?\n/).some((l) => l.trim() === `Sitemap: ${sitemapUrl(config)}`)) problem('site/robots.txt', `missing "Sitemap: ${sitemapUrl(config)}"`);
  if (/^\s*disallow:\s*\/\s*$/im.test(robots)) problem('site/robots.txt', 'blocks the whole site (Disallow: /)');
  if (/^\s*disallow:\s*\/blog/im.test(robots)) problem('site/robots.txt', 'blocks /blog');
}

const keyFile = path.join(SITE_DIR, `${config.indexNow.key}.txt`);
if (!fs.existsSync(keyFile)) problem(rel(keyFile), 'IndexNow key file is missing; run npm run build');
else if (readText(keyFile).trim() !== config.indexNow.key) problem(rel(keyFile), 'IndexNow key file does not contain the key from tools/site.config.json');

/* ---------- Dutch copy rules (tools/check_copy.py) ---------- */

const checker = path.join(TOOLS_DIR, 'check_copy.py');
if (posts.length) {
  const mdFiles = posts.map((p) => rel(path.join(p.dir, 'post.md')));
  const r = spawnSync('python3', ['-I', checker, '--lang', 'nl', ...mdFiles], { encoding: 'utf8', cwd: ROOT });
  if (r.error) problem('copy', `python3 is needed for the copy check: ${r.error.message}`);
  else if (r.status !== 0) for (const line of r.stdout.trim().split('\n').filter(Boolean)) problems.push(`copy: ${line}`);

  // The visible fields of meta.json follow the same rules.
  const fields = [];
  for (const p of posts) {
    fields.push([`content/blog/${p.slug}/meta.json title`, p.meta.title]);
    fields.push([`content/blog/${p.slug}/meta.json description`, p.meta.description]);
    (p.meta.faq || []).forEach((f, i) => {
      fields.push([`content/blog/${p.slug}/meta.json faq[${i}].q`, f.q]);
      fields.push([`content/blog/${p.slug}/meta.json faq[${i}].a`, f.a]);
    });
  }
  const input = fields.map(([, text]) => text.replace(/\s+/g, ' ')).join('\n');
  const m = spawnSync('python3', ['-I', checker, '--lang', 'nl'], { encoding: 'utf8', input });
  if (!m.error && m.status !== 0) {
    for (const line of m.stdout.trim().split('\n').filter(Boolean)) {
      const hit = /^stdin:(\d+): (.*)$/.exec(line);
      problems.push(`copy: ${hit ? `${fields[Number(hit[1]) - 1][0]}: ${hit[2]}` : line}`);
    }
  }
}

/* ---------- Report ---------- */

console.log(`Checked ${blogPagesChecked} blog page(s), ${posts.length} post(s), ${staticFiles.length} static page(s), sitemap (${sitemapCount} URLs), feed (${feedCount} items).`);
if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}), not blocking${strict ? '' : ' (use --strict to make them blocking)'}:`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):`);
  for (const p of problems) console.log(`  x ${p}`);
  console.log('\nCheck failed.');
  process.exit(1);
}
console.log('\nAll blog checks passed.');
