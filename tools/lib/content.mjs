// Flow State blog tooling: reads content/blog/<slug>/{meta.json,post.md}, validates it and renders the Markdown.
import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';
import {
  CONTENT_DIR,
  SLUG_RE,
  countWords,
  escapeHtml,
  findDash,
  firstWords,
  htmlToText,
  maxSeoTitleLength,
  parseIsoDate,
  postPath,
  rel,
  slugify,
  smartQuotes,
  smartQuotesHtml,
  todayInAmsterdam,
} from './shared.mjs';

const META_KEYS = ['title', 'seoTitle', 'description', 'slug', 'date', 'updated', 'category', 'primaryKeyword', 'keywords', 'sources', 'faq', 'internalLinks'];
const REQUIRED_KEYS = ['title', 'seoTitle', 'description', 'slug', 'date', 'updated', 'category', 'primaryKeyword', 'keywords', 'sources', 'internalLinks'];

// Ids used by the page templates; headings in post.md never get these.
export const RESERVED_IDS = ['main', 'site-menu', 'toc-title', 'bronnen', 'veelgestelde-vragen', 'cta-title', 'related-title', 'post-title'];

const isString = (v) => typeof v === 'string' && v.trim().length > 0;
const hasDash = (s) => findDash(s) !== null;

function isHttpsUrl(value) {
  if (!isString(value)) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !!u.hostname && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/* ---------- meta.json ---------- */

export function validateMeta(meta, folderSlug, config) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return ['meta.json must contain one JSON object'];

  for (const key of Object.keys(meta)) if (!META_KEYS.includes(key)) err(`unknown field "${key}" (allowed: ${META_KEYS.join(', ')})`);
  for (const key of REQUIRED_KEYS) if (!(key in meta)) err(`missing required field "${key}"`);

  const text = (key, min, max) => {
    const v = meta[key];
    if (!(key in meta)) return;
    if (!isString(v)) return err(`"${key}" must be a non-empty string`);
    if (v !== v.trim()) err(`"${key}" has leading or trailing spaces`);
    if (v.length < min || v.length > max) err(`"${key}" is ${v.length} characters; it must be ${min} to ${max}`);
    if (hasDash(v)) err(`"${key}" contains a dash used as punctuation; use a comma, colon or period`);
  };
  text('title', 20, 70);
  text('seoTitle', 15, maxSeoTitleLength(config));
  text('description', 120, 155);
  text('primaryKeyword', 3, 60);

  if ('slug' in meta) {
    if (!isString(meta.slug) || !SLUG_RE.test(meta.slug)) err('"slug" must be lowercase kebab-case: letters, digits and single hyphens');
    else if (meta.slug.length > 70) err(`"slug" is ${meta.slug.length} characters; keep it at 70 or fewer`);
    if (meta.slug !== folderSlug) err(`"slug" ("${meta.slug}") must equal the folder name ("${folderSlug}")`);
  }

  // A date in the future would publish a wrong datePublished, dateModified and sitemap lastmod.
  const today = todayInAmsterdam();
  const notFuture = (label, value) => {
    if (value > today) err(`${label} (${value}) lies in the future; today in Amsterdam is ${today}`);
  };
  const date = parseIsoDate(meta.date);
  const updated = parseIsoDate(meta.updated);
  if ('date' in meta && !date) err('"date" must be a real date written as YYYY-MM-DD');
  if ('updated' in meta && !updated) err('"updated" must be a real date written as YYYY-MM-DD');
  if (date && updated && meta.updated < meta.date) err('"updated" cannot be earlier than "date"');
  if (date) notFuture('"date"', meta.date);
  if (updated) notFuture('"updated"', meta.updated);

  if ('category' in meta && !config.blog.categories.includes(meta.category)) err(`"category" must be one of: ${config.blog.categories.join(', ')}`);

  if ('keywords' in meta) {
    const kw = meta.keywords;
    if (!Array.isArray(kw) || !kw.length || kw.length > 10 || !kw.every(isString)) err('"keywords" must be a list of 1 to 10 non-empty strings');
    else {
      const seen = new Set();
      for (const k of kw) {
        const n = k.trim().toLowerCase();
        if (seen.has(n)) err(`"keywords" lists "${k}" twice`);
        seen.add(n);
      }
    }
  }

  if ('sources' in meta) {
    const src = meta.sources;
    if (!Array.isArray(src) || !src.length) err('"sources" must be a list with at least one source');
    else {
      const urls = new Set();
      src.forEach((s, i) => {
        const at = `sources[${i}]`;
        if (!s || typeof s !== 'object') return err(`${at} must be an object with title, publisher, url and date`);
        for (const k of Object.keys(s)) if (!['title', 'publisher', 'url', 'date'].includes(k)) err(`${at} has unknown field "${k}"`);
        if (!isString(s.title)) err(`${at}.title is required`);
        else if (hasDash(s.title)) err(`${at}.title contains a dash used as punctuation; replace it with a colon or comma`);
        if (!isString(s.publisher)) err(`${at}.publisher is required`);
        else if (hasDash(s.publisher)) err(`${at}.publisher contains a dash used as punctuation`);
        if (!isHttpsUrl(s.url)) err(`${at}.url must be a full https:// URL`);
        else if (urls.has(s.url)) err(`${at}.url is listed twice`);
        else urls.add(s.url);
        if (!parseIsoDate(s.date)) err(`${at}.date must be a real date written as YYYY-MM-DD`);
        else notFuture(`${at}.date`, s.date);
      });
    }
  }

  if ('faq' in meta) {
    const faq = meta.faq;
    if (!Array.isArray(faq) || faq.length > 8) err('"faq" must be a list with at most 8 entries');
    else
      faq.forEach((f, i) => {
        const at = `faq[${i}]`;
        if (!f || typeof f !== 'object') return err(`${at} must be an object with q and a`);
        for (const k of Object.keys(f)) if (!['q', 'a'].includes(k)) err(`${at} has unknown field "${k}"`);
        if (!isString(f.q) || !f.q.trim().endsWith('?')) err(`${at}.q must be a question ending with "?"`);
        else if (hasDash(f.q)) err(`${at}.q contains a dash used as punctuation`);
        if (!isString(f.a) || f.a.length < 20 || f.a.length > 600) err(`${at}.a must be an answer of 20 to 600 characters`);
        else if (hasDash(f.a)) err(`${at}.a contains a dash used as punctuation`);
      });
  }

  if ('internalLinks' in meta) {
    const il = meta.internalLinks;
    if (!Array.isArray(il) || !il.every((l) => isString(l) && l.startsWith('/') && !l.startsWith('//') && !/\s/.test(l))) {
      err('"internalLinks" must be a list of root-absolute paths such as "/diensten.html#training"');
    }
  }
  return errors;
}

/* ---------- post.md ---------- */

function cleanUrl(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

function classifyHref(href) {
  if (/^https:\/\//i.test(href)) return 'external';
  if (/^http:\/\//i.test(href)) return 'insecure';
  if (href.startsWith('#')) return 'anchor';
  if (href.startsWith('//')) return 'protocol-relative';
  if (href.startsWith('/')) return 'internal';
  if (/^mailto:/i.test(href)) return 'mailto';
  return 'relative';
}

export function renderMarkdown(markdown) {
  const toc = [];
  const headings = [];
  const links = [];
  const images = [];
  const errors = [];
  const used = new Set(RESERVED_IDS);
  let tables = 0;
  const md = new Marked({ gfm: true, breaks: false, async: false });

  md.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        if (depth !== 2 && depth !== 3) return `<h${depth}>${inner}</h${depth}>\n`;
        const text = htmlToText(inner);
        const base = slugify(text);
        let id = base;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
        headings.push({ depth, id, text });
        if (depth === 2) toc.push({ id, text: smartQuotes(text) });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const clean = cleanUrl(href);
        if (clean === null) return inner;
        links.push({ href, text: htmlToText(inner) });
        return `<a href="${escapeHtml(clean)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${inner}</a>`;
      },
      image({ href, title, text, tokens }) {
        const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
        const clean = cleanUrl(href);
        images.push({ src: href, alt });
        if (clean === null) return escapeHtml(alt);
        return `<img src="${escapeHtml(clean)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
      },
      html({ text }) {
        // Raw HTML is rejected by validation; escaping keeps it inert if it ever gets this far.
        return escapeHtml(text);
      },
      table(token) {
        tables += 1;
        let head = '';
        for (const cell of token.header) head += this.tablecell(cell);
        let body = '';
        for (const row of token.rows) {
          let cells = '';
          for (const cell of row) cells += this.tablecell(cell);
          body += this.tablerow({ text: cells });
        }
        return `<div class="table-scroll" role="region" aria-label="Tabel ${tables}" tabindex="0"><table>\n<thead>\n${this.tablerow({ text: head })}</thead>\n${body ? `<tbody>\n${body}</tbody>\n` : ''}</table></div>\n`;
      },
    },
  });

  const tokens = md.lexer(markdown);

  // Structure rules
  const blocks = tokens.filter((t) => t.type !== 'space');
  if (!blocks.length) errors.push('post.md is empty');
  else if (blocks[0].type !== 'paragraph') errors.push('post.md must start with an intro paragraph (not a heading, list or quote)');
  let seenH2 = false;
  md.walkTokens(tokens, (t) => {
    if (t.type === 'heading') {
      if (t.depth === 1) errors.push(`no H1 in post.md (the template renders the title): "${t.raw.trim()}"`);
      if (t.depth >= 4) errors.push(`use only ## and ### headings, found: "${t.raw.trim()}"`);
      if (t.depth === 2) seenH2 = true;
      if (t.depth === 3 && !seenH2) errors.push(`a ### heading needs a ## section above it: "${t.raw.trim()}"`);
    }
    if (t.type === 'html') errors.push(`raw HTML is not allowed in post.md, use Markdown: "${t.raw.trim().slice(0, 60)}"`);
  });

  // Straight quotes become curly ones in the text (never in code or attributes).
  const html = smartQuotesHtml(md.parser(tokens));

  for (const { href } of links) {
    const kind = classifyHref(href);
    if (kind === 'insecure') errors.push(`link uses http instead of https: ${href}`);
    if (kind === 'relative') errors.push(`internal links must be root-absolute (start with "/"): ${href}`);
    if (kind === 'protocol-relative') errors.push(`protocol-relative links are not allowed: ${href}`);
    if (/^javascript:/i.test(href)) errors.push(`javascript: links are not allowed: ${href}`);
  }
  // Images come from this site only: a third-party image would make every visitor's browser
  // contact that party, and the site promises it talks to no one else.
  for (const { src, alt } of images) {
    if (!alt || !alt.trim()) errors.push(`image without alt text: ${src}`);
    if (!/^\/(?!\/)/.test(src)) errors.push(`image source must be a root-absolute path on this site (such as /assets/img/x.png), not "${src}"`);
  }

  return { html, toc, headings, links, images, errors };
}

/* ---------- All posts ---------- */

export function listPostFolders(contentDir = CONTENT_DIR) {
  if (!fs.existsSync(contentDir)) return [];
  return fs
    .readdirSync(contentDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();
}

// What readers see of meta.json: the same text with typographic quotes.
function viewOf(meta) {
  return {
    title: smartQuotes(meta.title),
    seoTitle: smartQuotes(meta.seoTitle),
    description: smartQuotes(meta.description),
    faq: (meta.faq || []).map((f) => ({ q: smartQuotes(f.q), a: smartQuotes(f.a) })),
    sources: meta.sources.map((s) => ({ ...s, title: smartQuotes(s.title), publisher: smartQuotes(s.publisher) })),
  };
}

export function loadPosts(config, contentDir = CONTENT_DIR) {
  const posts = [];
  const errors = [];
  const metas = []; // every readable meta.json, also of posts with other errors, for the rules across posts
  for (const folder of listPostFolders(contentDir)) {
    const dir = path.join(contentDir, folder);
    const where = rel(dir);
    const metaFile = path.join(dir, 'meta.json');
    const mdFile = path.join(dir, 'post.md');
    const local = [];
    let meta = null;
    let markdown = null;
    if (!fs.existsSync(metaFile)) local.push('meta.json is missing');
    else {
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      } catch (e) {
        local.push(`meta.json is not valid JSON: ${e.message}`);
      }
    }
    if (!fs.existsSync(mdFile)) local.push('post.md is missing');
    else markdown = fs.readFileSync(mdFile, 'utf8');
    for (const f of fs.readdirSync(dir)) if (!['meta.json', 'post.md'].includes(f) && !f.startsWith('.')) local.push(`unexpected file "${f}" (a post folder holds only meta.json and post.md)`);

    if (meta) local.push(...validateMeta(meta, folder, config));
    if (meta && typeof meta === 'object') metas.push({ slug: folder, meta });
    let rendered = null;
    if (markdown !== null) {
      // An empty or whitespace-only post.md (for example after an interrupted write) is reported by renderMarkdown.
      if (/^---\s*$/.test(markdown.split('\n')[0] || '')) local.push('post.md starts with front matter; put all metadata in meta.json');
      rendered = renderMarkdown(markdown);
      local.push(...rendered.errors);
    }
    if (local.length || !rendered) {
      errors.push(...(local.length ? local : ['post.md could not be read']).map((e) => `${where}: ${e}`));
      continue;
    }

    const text = htmlToText(rendered.html);
    const words = countWords(text);
    posts.push({
      slug: folder,
      dir,
      meta,
      view: viewOf(meta),
      markdown,
      html: rendered.html,
      toc: rendered.toc,
      headings: rendered.headings,
      links: rendered.links,
      intro: firstWords(text, 100),
      words,
      readingMinutes: Math.max(2, Math.ceil(words / (config.blog.wordsPerMinute || 220))),
      path: postPath(folder),
      url: config.siteUrl + postPath(folder),
      file: `blog/${folder}.html`,
    });
  }

  // Rules across posts: unique titles and one primary keyword per post (prevents keyword cannibalisation).
  const seen = { title: new Map(), seoTitle: new Map(), primaryKeyword: new Map() };
  for (const { slug, meta } of metas) {
    for (const key of Object.keys(seen)) {
      if (typeof meta[key] !== 'string') continue;
      const v = meta[key].trim().toLowerCase();
      if (seen[key].has(v)) errors.push(`content/blog/${slug}: "${key}" is the same as in content/blog/${seen[key].get(v)}; every post needs its own`);
      else seen[key].set(v, slug);
    }
  }

  posts.sort((a, b) => (a.meta.date === b.meta.date ? (a.slug < b.slug ? -1 : 1) : a.meta.date < b.meta.date ? 1 : -1));
  return { posts, errors };
}

// Up to n other posts: same category and shared keywords first, then newest. Deterministic.
export function relatedPosts(post, posts, n) {
  const words = (p) => new Set([p.meta.primaryKeyword, ...p.meta.keywords].map((k) => k.trim().toLowerCase()));
  const mine = words(post);
  return posts
    .filter((p) => p.slug !== post.slug)
    .map((p) => {
      let score = p.meta.category === post.meta.category ? 2 : 0;
      for (const k of words(p)) if (mine.has(k)) score += 1;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score || (a.p.meta.date === b.p.meta.date ? (a.p.slug < b.p.slug ? -1 : 1) : a.p.meta.date < b.p.meta.date ? 1 : -1))
    .slice(0, n)
    .map((x) => x.p);
}
