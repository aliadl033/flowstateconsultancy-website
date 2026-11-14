#!/usr/bin/env node
// Flow State blog build (npm run build).
// content/blog/<slug>/{meta.json,post.md}  ->  site/blog/<slug>.html, site/blog/index.html,
// the homepage teaser between the blog:latest markers, site/sitemap.xml, site/feed.xml,
// the Sitemap line in site/robots.txt and the IndexNow key file. Same input, same output.
import fs from 'node:fs';
import path from 'node:path';
import {
  BLOG_OUT_DIR,
  HOME_MARKERS,
  SITE_DIR,
  TEMPLATE_DIR,
  blogUrl,
  escapeHtml,
  escapeXml,
  feedUrl,
  fillTemplate,
  isoDateTime,
  jsonForScript,
  lastModified,
  loadConfig,
  pageTitle,
  readText,
  rel,
  rfc822,
  sitemapUrl,
  writeIfChanged,
} from './lib/shared.mjs';
import { loadPosts, relatedPosts } from './lib/content.mjs';
import {
  indexJsonLd,
  loadChrome,
  postJsonLd,
  renderArchive,
  renderBreadcrumb,
  renderCta,
  renderEmptyState,
  renderFaq,
  renderFeatured,
  renderHeroFacts,
  renderHomeLatest,
  renderPostMeta,
  renderRelated,
  renderSources,
  renderToc,
  signalDivider,
  tocItems,
} from './lib/render.mjs';

const notes = [];
const changed = [];

function fail(lines) {
  console.error('\nBuild failed. Fix these and run npm run build again:\n');
  for (const line of lines) console.error(`  x ${line}`);
  console.error('');
  process.exit(1);
}

function write(absFile, content) {
  if (writeIfChanged(absFile, content)) changed.push(rel(absFile));
}

let config;
let chrome;
try {
  config = loadConfig();
  chrome = loadChrome();
} catch (err) {
  fail([err.message]);
}

const { posts, errors } = loadPosts(config);
if (errors.length) fail(errors);

const templates = {
  post: readText(path.join(TEMPLATE_DIR, 'post.html')),
  index: readText(path.join(TEMPLATE_DIR, 'blog-index.html')),
};

const shared = {
  header: chrome.header,
  footer: chrome.footer,
  siteName: config.siteName,
  locale: config.locale,
  feedTitle: config.blog.fullName,
  feedUrl: feedUrl(config),
  ogImage: config.siteUrl + config.defaultImage.path,
  ogImageWidth: config.defaultImage.width,
  ogImageHeight: config.defaultImage.height,
  ogImageAlt: config.defaultImage.alt,
  cta: renderCta(config),
};

/* ---------- Pages ---------- */

const pages = new Map();

for (const post of posts) {
  const m = post.meta;
  const v = post.view; // the same text with typographic quotes, as readers see it
  const tags = [...new Set([m.primaryKeyword, ...m.keywords].map((k) => k.trim()))];
  pages.set(
    post.file,
    fillTemplate(
      templates.post,
      {
        ...shared,
        pageTitle: pageTitle(config, v.seoTitle),
        description: v.description,
        canonical: post.url,
        ogTitle: v.title,
        publishedTime: isoDateTime(m.date),
        modifiedTime: isoDateTime(m.updated),
        section: m.category,
        articleTags: tags.map((k) => `<meta property="article:tag" content="${escapeHtml(k)}">`).join('\n'),
        jsonLd: jsonForScript(postJsonLd(post, config)),
        breadcrumb: renderBreadcrumb(v.title),
        category: m.category,
        title: v.title,
        postMeta: renderPostMeta(post),
        divider: signalDivider('post-head__line'),
        toc: renderToc(tocItems(post)),
        body: post.html.trim(),
        sources: renderSources(post),
        faq: renderFaq(post),
        related: renderRelated(relatedPosts(post, posts, config.blog.related || 3)),
      },
      'post.html',
    ),
  );
}

pages.set(
  'blog/index.html',
  fillTemplate(
    templates.index,
    {
      ...shared,
      pageTitle: pageTitle(config, config.blog.seoTitle),
      description: config.blog.description,
      canonical: blogUrl(config),
      ogTitle: config.blog.fullName,
      jsonLd: jsonForScript(indexJsonLd(posts, config)),
      lead: config.blog.lead,
      facts: renderHeroFacts(posts),
      featured: posts.length ? renderFeatured(posts[0]) : '',
      archive: renderArchive(posts.slice(1), config.blog.archiveRows || 12),
      empty: posts.length ? '' : renderEmptyState(),
    },
    'blog-index.html',
  ),
);

for (const [file, html] of pages) write(path.join(SITE_DIR, file), html);

// Remove pages of posts that no longer exist in content/blog.
if (fs.existsSync(BLOG_OUT_DIR)) {
  for (const f of fs.readdirSync(BLOG_OUT_DIR)) {
    if (f.endsWith('.html') && !pages.has(`blog/${f}`)) {
      fs.unlinkSync(path.join(BLOG_OUT_DIR, f));
      changed.push(`site/blog/${f} (removed)`);
    }
  }
}

/* ---------- Homepage teaser ---------- */

const homeFile = path.join(SITE_DIR, 'index.html');
let homeHasMarkers = false;
if (!fs.existsSync(homeFile)) {
  notes.push('site/index.html does not exist yet; homepage teaser skipped');
} else {
  const html = readText(homeFile);
  const s = html.indexOf(HOME_MARKERS.start);
  const end = html.indexOf(HOME_MARKERS.end);
  const count = (needle) => html.split(needle).length - 1;
  if (s === -1 && end === -1) {
    notes.push('site/index.html has no blog:latest markers; homepage teaser skipped');
  } else if (s === -1 || end === -1 || end < s || count(HOME_MARKERS.start) > 1 || count(HOME_MARKERS.end) > 1) {
    fail([`site/index.html: use ${HOME_MARKERS.start} and ${HOME_MARKERS.end} exactly once each, start before end`]);
  } else {
    homeHasMarkers = true;
    const lineStart = html.lastIndexOf('\n', s) + 1;
    const pad = /^[ \t]*/.exec(html.slice(lineStart, s))[0];
    const headEnd = html.search(/<\/head>/i);
    const head = headEnd === -1 ? '' : html.slice(0, headEnd);
    const cssInHead = /href="\/?assets\/css\/blog\.css"/.test(head);
    const block = renderHomeLatest(posts, config, !cssInHead);
    const inner = block ? `\n${block.split('\n').map((l) => (l ? pad + l : l)).join('\n')}\n${pad}` : `\n${pad}`;
    write(homeFile, html.slice(0, s + HOME_MARKERS.start.length) + inner + html.slice(end));
  }
}

/* ---------- sitemap.xml ---------- */

const later = (a, b) => (Date.parse(b) > Date.parse(a) ? b : a);
const newestUpdate = posts.length ? posts.map((p) => p.meta.updated).sort().pop() : null;
const urls = [];
for (const page of config.staticPages) {
  const abs = path.join(SITE_DIR, page.file);
  if (!fs.existsSync(abs)) {
    notes.push(`sitemap: site/${page.file} does not exist yet, left out`);
    continue;
  }
  let lastmod = lastModified(abs);
  if (page.file === 'index.html' && homeHasMarkers && newestUpdate) lastmod = later(lastmod, newestUpdate);
  urls.push({ loc: config.siteUrl + page.path, lastmod });
}
urls.push({ loc: blogUrl(config), lastmod: newestUpdate || lastModified(path.join(TEMPLATE_DIR, 'blog-index.html')) });
for (const p of posts) urls.push({ loc: p.url, lastmod: p.meta.updated });

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map((u) => `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>\n  </url>`),
  '</urlset>',
  '',
].join('\n');
write(path.join(SITE_DIR, 'sitemap.xml'), sitemap);

/* ---------- feed.xml (RSS 2.0) ---------- */

const feedPosts = posts.slice(0, config.blog.feedItems || 20);
const feed = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
  '  <channel>',
  `    <title>${escapeXml(config.blog.fullName)}</title>`,
  `    <link>${escapeXml(blogUrl(config))}</link>`,
  `    <description>${escapeXml(config.blog.lead)}</description>`,
  `    <language>${escapeXml(config.language.toLowerCase())}</language>`,
  `    <atom:link href="${escapeXml(feedUrl(config))}" rel="self" type="application/rss+xml"/>`,
  ...(newestUpdate ? [`    <lastBuildDate>${rfc822(newestUpdate)}</lastBuildDate>`] : []),
  ...feedPosts.map((p) =>
    [
      '    <item>',
      `      <title>${escapeXml(p.view.title)}</title>`,
      `      <link>${escapeXml(p.url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(p.url)}</guid>`,
      `      <pubDate>${rfc822(p.meta.date)}</pubDate>`,
      `      <category>${escapeXml(p.meta.category)}</category>`,
      `      <description>${escapeXml(p.view.description)}</description>`,
      '    </item>',
    ].join('\n'),
  ),
  '  </channel>',
  '</rss>',
  '',
].join('\n');
write(path.join(SITE_DIR, 'feed.xml'), feed);

/* ---------- robots.txt and IndexNow key ---------- */

const robotsFile = path.join(SITE_DIR, 'robots.txt');
const robotsIn = fs.existsSync(robotsFile) ? readText(robotsFile) : 'User-agent: *\nAllow: /\n';
const robotsBody = robotsIn
  .replace(/\r\n/g, '\n')
  .split('\n')
  .filter((line) => !/^\s*sitemap\s*:/i.test(line))
  .join('\n')
  .replace(/\n+$/, '');
write(robotsFile, `${robotsBody}\n\nSitemap: ${sitemapUrl(config)}\n`);

write(path.join(SITE_DIR, `${config.indexNow.key}.txt`), config.indexNow.key);

/* ---------- Report ---------- */

console.log(`Built ${posts.length} post${posts.length === 1 ? '' : 's'} and the blog index.`);
for (const p of posts) console.log(`  /blog/${p.slug}.html  ${p.words} words, ${p.readingMinutes} min, ${p.meta.date}`);
console.log(`Sitemap: ${urls.length} URLs. Feed: ${feedPosts.length} item${feedPosts.length === 1 ? '' : 's'}.`);
console.log(changed.length ? `Written: ${changed.join(', ')}` : 'No files changed.');
for (const n of notes) console.log(`Note: ${n}`);
