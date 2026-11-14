// Flow State blog tooling: HTML fragments and JSON-LD for the blog pages and the homepage teaser.
// Visible text of a post comes from post.view (meta.json with typographic quotes).
import {
  SITE_TEMPLATE_FILE,
  blogUrl,
  escapeHtml,
  formatDateNl,
  formatDateNlShort,
  isPlaceholder,
  isoDateTime,
  organizationId,
  readText,
  websiteId,
} from './shared.mjs';

const e = escapeHtml;

/* ---------- Icons (Lucide, see docs/ICONS.md) ---------- */
const icon = (paths, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
export const ICON_ARROW = icon('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>');
export const ICON_ARROW_MOVE = icon('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', 'icon icon--move');
export const ICON_ARROW_UP_RIGHT = icon('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>');
const ICON_PLUS = '<svg class="faq__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';

// Canonical signal line (docs/_signal_path.txt): jagged noise on the left, a clean wave on the right.
const SIGNAL_PATH = 'M0 12 L5.8 15.4 L11.1 12.8 L17.9 2.1 L25.5 1.8 L32.7 2.7 L38.1 10.4 L47.2 4.0 L53.4 14.7 L63.1 13.6 L70.1 21.6 L75.3 19.2 L81.8 5.0 L87.3 8.3 L96.4 5.9 L104.3 14.6 L111.2 12.9 L116.5 3.9 L122.5 15.3 L129.7 8.7 L137.6 11.2 L144.1 17.0 L152.6 7.7 L160.5 12.4 L169.8 15.7 L176.3 19.6 L181.9 10.7 L190.7 6.7 L198.1 5.2 L206.4 15.8 L214.3 17.3 L220.9 14.7 L228.9 13.1 L236.1 16.5 L245.9 11.7 L254.2 6.6 L262.7 13.7 L272.7 15.7 L279.1 10.7 L287.4 6.9 L294.7 8.6 L300.3 7.6 L309.2 8.4 L315.4 11.0 L324.7 8.3 L332.0 12.4 L341.4 14.5 L350.7 10.4 L357.8 11.0 L367.2 15.0 L373.0 10.0 L379.1 10.5 L386.6 12.5 L392.9 9.5 L400.0 11.4 L407.8 13.8 L416.3 12.1 L424.3 12.5 L429.6 12.8 L430 12 C447.5 1.4 460.5 1.4 478.0 12 C495.5 22.6 508.5 22.6 526.0 12 C543.5 1.4 556.5 1.4 574.0 12 C591.5 22.6 604.5 22.6 622.0 12 C639.5 1.4 652.5 1.4 670.0 12 C687.5 22.6 700.5 22.6 718.0 12 C735.5 1.4 748.5 1.4 766.0 12 C783.5 22.6 796.5 22.6 814.0 12 C831.5 1.4 844.5 1.4 862.0 12 C879.5 22.6 892.5 22.6 910.0 12 C927.5 1.4 940.5 1.4 958.0 12 C975.5 22.6 988.5 22.6 1006.0 12 C1023.5 1.4 1036.5 1.4 1054.0 12 C1071.5 22.6 1084.5 22.6 1102.0 12 C1119.5 1.4 1132.5 1.4 1150.0 12 C1167.5 22.6 1180.5 22.6 1198.0 12';

export const signalDivider = (extraClass = '') =>
  `<svg class="signal-divider${extraClass ? ` ${extraClass}` : ''}" viewBox="0 0 1200 24" preserveAspectRatio="none" aria-hidden="true" focusable="false" data-reveal="draw"><path d="${SIGNAL_PATH}"/></svg>`;

const time = (iso, label = formatDateNl(iso)) => `<time datetime="${e(iso)}">${e(label)}</time>`;
const minutes = (post) => `${post.readingMinutes} min leestijd`;
const indent = (html, spaces) => html.split('\n').map((l) => (l ? ' '.repeat(spaces) + l : l)).join('\n');

/* ---------- Header and footer from site/_template.html ---------- */

const KEEP_URL = /^(\/|#|[a-z][a-z0-9+.-]*:)/i;

// A relative URL from the site root as a root-absolute one. index.html is the homepage "/", the same
// mapping dev/integrate.mjs uses, so the blog never links to a duplicate of the canonical URL.
export function toRootUrl(url) {
  if (url === '' || KEEP_URL.test(url)) return url;
  const clean = url.replace(/^\.\//, '');
  if (clean === 'index.html') return '/';
  if (clean.startsWith('index.html#') || clean.startsWith('index.html?')) return `/${clean.slice('index.html'.length)}`;
  return `/${clean}`;
}

// Relative URLs in href, src, action, xlink:href, poster, srcset and inline style url() become
// root-absolute, so the same markup works in /blog/.
export function rootAbsolute(html) {
  return html
    .replace(/(\s(?:href|src|action|xlink:href|poster)=)(["'])(.*?)\2/g, (m, attr, q, url) => `${attr}${q}${toRootUrl(url)}${q}`)
    .replace(/(\ssrcset=)(["'])(.*?)\2/g, (m, attr, q, list) => {
      const items = list.split(',').map((item) => item.trim().replace(/^(\S+)/, (u) => toRootUrl(u)));
      return `${attr}${q}${items.join(', ')}${q}`;
    })
    .replace(/(\sstyle=)(["'])(.*?)\2/g, (m, attr, q, style) =>
      `${attr}${q}${style.replace(/url\((['"]?)([^'")]+)\1\)/g, (u, uq, url) => `url(${uq}${toRootUrl(url.trim())}${uq})`)}${q}`,
    );
}

// The Blog item in the header (desktop nav and mobile menu) is marked as the current page,
// the same way dev/integrate.mjs marks the active item on the static pages. The footer stays unmarked.
export function markBlogCurrent(html) {
  return html.replace(/<a\b[^>]*\shref="\/blog(?:\/|\/index\.html)?"[^>]*>/g, (tag) => (/\saria-current=/.test(tag) ? tag : tag.replace(/>$/, ' aria-current="page">')));
}

// The block as it appears in the template, without the indentation of its first line.
function dedentMatch(source, match) {
  const lineStart = source.lastIndexOf('\n', match.index) + 1;
  const pad = source.slice(lineStart, match.index);
  if (!/^[ \t]+$/.test(pad)) return match[0];
  return match[0]
    .split('\n')
    .map((line, i) => (i > 0 && line.startsWith(pad) ? line.slice(pad.length) : line))
    .join('\n');
}

export function loadChrome() {
  const tpl = readText(SITE_TEMPLATE_FILE);
  const header = /<header\b[^>]*class="site-header\b[^"]*"[^>]*>[\s\S]*?<\/header>/.exec(tpl);
  const footer = /<footer\b[^>]*class="site-footer\b[^"]*"[^>]*>[\s\S]*?<\/footer>/.exec(tpl);
  if (!header || !footer) throw new Error('site/_template.html: could not find <header class="site-header"> and <footer class="site-footer">');
  return {
    header: markBlogCurrent(rootAbsolute(dedentMatch(tpl, header))),
    footer: rootAbsolute(dedentMatch(tpl, footer)),
  };
}

/* ---------- Post page parts ---------- */

export function renderBreadcrumb(title) {
  return [
    '<nav class="breadcrumb" aria-label="Kruimelpad">',
    '  <ol class="breadcrumb__list" role="list">',
    '    <li class="breadcrumb__item"><a href="/">Home</a></li>',
    '    <li class="breadcrumb__item"><a href="/blog/">Blog</a></li>',
    `    <li class="breadcrumb__item"><span aria-current="page">${e(title)}</span></li>`,
    '  </ol>',
    '</nav>',
  ].join('\n');
}

// Date, reading time and author. From 960px it stands as a readout in the left column, beside the title.
export function renderPostMeta(post) {
  const { meta } = post;
  const items = [`<li><span class="visually-hidden">Gepubliceerd op </span>${time(meta.date)}</li>`];
  if (meta.updated !== meta.date) items.push(`<li>Bijgewerkt op ${time(meta.updated)}</li>`);
  items.push(`<li>${minutes(post)}</li>`);
  items.push('<li>Door <a href="/over-ons.html">Flow State Consultancy</a></li>');
  return `<ul class="post-meta" role="list">\n  ${items.join('\n  ')}\n</ul>`;
}

// Table of contents: the h2 sections of the body, then Bronnen and Veelgestelde vragen.
export function tocItems(post) {
  const items = post.toc.map((t) => ({ id: t.id, text: t.text }));
  items.push({ id: 'bronnen', text: 'Bronnen' });
  if (post.meta.faq && post.meta.faq.length) items.push({ id: 'veelgestelde-vragen', text: 'Veelgestelde vragen' });
  return items;
}

// Two renderings of the same list: a collapsed <details> below 960px and a sticky nav from 960px.
// Only one is displayed at a time, so assistive technology meets one navigation landmark.
// The sticky list scrolls on its own when it is taller than the window (data-lenis-prevent lets it).
export function renderToc(items) {
  if (items.length < 3) return '';
  const list = (pad) => items.map((t) => `${pad}<li class="post-toc__item"><a class="post-toc__link" href="#${e(t.id)}">${e(t.text)}</a></li>`).join('\n');
  return [
    '<details class="post-toc-mobile">',
    '  <summary class="post-toc-mobile__summary">',
    '    <span class="label">In dit artikel</span>',
    `    <span class="post-toc-mobile__count">${items.length} onderdelen</span>`,
    `    ${ICON_PLUS.replace('class="faq__icon"', 'class="post-toc-mobile__icon"')}`,
    '  </summary>',
    '  <nav class="post-toc-mobile__nav" aria-label="Inhoudsopgave">',
    '    <ol class="post-toc__list" role="list">',
    list('      '),
    '    </ol>',
    '  </nav>',
    '</details>',
    '<nav class="post-toc" aria-labelledby="toc-title" data-toc data-lenis-prevent>',
    '  <p class="label post-toc__title" id="toc-title">In dit artikel</p>',
    '  <div class="post-toc__body">',
    '    <span class="post-toc__rail" aria-hidden="true"><span class="post-toc__progress" data-toc-progress></span></span>',
    '    <ol class="post-toc__list" role="list">',
    list('      '),
    '    </ol>',
    '  </div>',
    '</nav>',
  ].join('\n');
}

export function renderSources(post) {
  const items = post.view.sources
    .map((s) =>
      [
        '    <li class="source">',
        `      <p class="source__publisher">${e(s.publisher)}</p>`,
        `      <p class="source__title"><a href="${e(s.url)}">${e(s.title)}</a></p>`,
        `      <p class="source__date">${time(s.date)}</p>`,
        '    </li>',
      ].join('\n'),
    )
    .join('\n');
  return [
    '<section class="post-section post-sources" aria-labelledby="bronnen">',
    '  <h2 class="post-section__title" id="bronnen">Bronnen</h2>',
    '  <ol class="source-list" role="list">',
    items,
    '  </ol>',
    '</section>',
  ].join('\n');
}

export function renderFaq(post) {
  const faq = post.view.faq;
  if (!faq.length) return '';
  const items = faq
    .map((f) => `    <details class="faq__item">\n      <summary class="faq__q">${e(f.q)}${ICON_PLUS}</summary>\n      <div class="faq__a"><p>${e(f.a)}</p></div>\n    </details>`)
    .join('\n');
  return [
    '<section class="post-section post-faq" aria-labelledby="veelgestelde-vragen">',
    '  <h2 class="post-section__title" id="veelgestelde-vragen">Veelgestelde vragen</h2>',
    '  <div class="faq">',
    items,
    '  </div>',
    '</section>',
  ].join('\n');
}

// Shared closing band, copy from docs/COPY.md ("Afsluitende band"), e-mail from the config.
export function renderCta(config) {
  const mail = config.organization.email;
  return [
    '<section class="section cta-band" aria-labelledby="cta-title">',
    '  <div class="container cta-band__inner">',
    '    <div class="cta-band__text">',
    '      <h2 class="display" id="cta-title">Zullen we afstemmen?</h2>',
    '      <p class="lead">Vertel kort wat er in je team speelt. Dan plannen we een kennismaking van een half uur en kijken we samen waar de ruis zit.</p>',
    `      <p class="cta-band__mail">Of mail direct naar <a class="text-link" href="mailto:${e(mail)}">${e(mail)}</a></p>`,
    '    </div>',
    '    <div class="cta-band__actions">',
    `      <a class="btn btn--primary btn--lg" href="/contact.html">Plan een kennismaking ${ICON_ARROW_MOVE}</a>`,
    '    </div>',
    '  </div>',
    '</section>',
  ].join('\n');
}

/* ---------- Cards and rows ---------- */
// Every meta line uses one order: category, date, reading time.

export function renderCard(post, headingTag = 'h3') {
  const { meta, view } = post;
  return [
    '<li class="post-card">',
    `  <p class="post-card__meta"><span class="post-card__category">${e(meta.category)}</span>${time(meta.date, formatDateNlShort(meta.date))}</p>`,
    `  <${headingTag} class="post-card__title"><a class="post-card__link" href="${e(post.path)}">${e(view.title)}</a></${headingTag}>`,
    `  <p class="post-card__desc">${e(view.description)}</p>`,
    `  <p class="post-card__foot"><span>${minutes(post)}</span>${ICON_ARROW}</p>`,
    '</li>',
  ].join('\n');
}

// One post as an editorial row: meta on the left, title and description, reading time on the right.
export function renderRow(post, reveal = true) {
  const { meta, view } = post;
  return [
    `<li class="post-row"${reveal ? ' data-reveal="fade-up"' : ''}>`,
    `  <p class="post-row__meta"><span class="post-row__category">${e(meta.category)}</span>${time(meta.date, formatDateNlShort(meta.date))}</p>`,
    '  <div class="post-row__body">',
    '    <div class="post-row__main">',
    `      <h3 class="post-row__title"><a class="post-row__link" href="${e(post.path)}">${e(view.title)}</a></h3>`,
    `      <p class="post-row__desc">${e(view.description)}</p>`,
    '    </div>',
    `    <p class="post-row__aside"><span>${minutes(post)}</span>${ICON_ARROW}</p>`,
    '  </div>',
    '</li>',
  ].join('\n');
}

// Section label above a strong rule, with a count or a link on the right (blog index and "Lees ook").
function sectionHead(cls, id, title, aside) {
  return [`<div class="list-head ${cls}">`, `  <h2 class="label list-head__title" id="${id}">${title}</h2>`, `  ${aside}`, '</div>'].join('\n');
}

// "Lees ook": up to three other posts as rows, so one, two or three items all look intended.
export function renderRelated(related) {
  if (!related.length) return '';
  return [
    '<section class="section related" aria-labelledby="related-title">',
    '  <div class="container">',
    indent(sectionHead('related__head', 'related-title', 'Lees ook', `<a class="link-arrow list-head__link" href="/blog/">Alle artikelen ${ICON_ARROW}</a>`), 4),
    '    <ul class="post-list" role="list">',
    indent(related.map((p) => renderRow(p)).join('\n'), 6),
    '    </ul>',
    '  </div>',
    '</section>',
  ].join('\n');
}

// Newest post: an ink panel with the title on the left and a readout of true facts on the right.
export function renderFeatured(post) {
  const { meta, view } = post;
  const sources = meta.sources.length;
  return [
    '<section class="blog-featured" aria-labelledby="featured-title">',
    '  <div class="container">',
    '    <article class="post-feature">',
    '      <p class="post-feature__kicker"><span class="status-dot" aria-hidden="true"></span>Nieuwste artikel</p>',
    `      ${signalDivider('post-feature__signal')}`,
    '      <div class="post-feature__grid">',
    '        <div class="post-feature__main">',
    `          <h2 class="post-feature__title" id="featured-title"><a class="post-feature__link" href="${e(post.path)}">${e(view.title)}</a></h2>`,
    `          <p class="post-feature__desc">${e(view.description)}</p>`,
    `          <p class="post-feature__cta" aria-hidden="true">Lees het artikel ${ICON_ARROW}</p>`,
    '        </div>',
    '        <dl class="readout post-feature__readout">',
    `          <dt>Categorie</dt><dd>${e(meta.category)}</dd>`,
    `          <dt>Gepubliceerd</dt><dd>${time(meta.date, formatDateNlShort(meta.date))}</dd>`,
    `          <dt>Leestijd</dt><dd>${post.readingMinutes} min</dd>`,
    `          <dt>Bronnen</dt><dd>${sources}</dd>`,
    '        </dl>',
    '      </div>',
    '    </article>',
    '  </div>',
    '</section>',
  ].join('\n');
}

const count = (n) => (n === 1 ? '1 artikel' : `${n} artikelen`);

// Older posts: the newest ones as full rows, everything older as a compact list per year,
// so the index stays one crawlable page that links to every post without growing endlessly.
export function renderArchive(posts, rows = 12) {
  if (!posts.length) return '';
  const full = posts.slice(0, rows);
  const older = posts.slice(rows);
  const years = [];
  for (const p of older) {
    const y = p.meta.date.slice(0, 4);
    if (!years.length || years[years.length - 1].year !== y) years.push({ year: y, posts: [] });
    years[years.length - 1].posts.push(p);
  }
  const yearBlocks = years.map(({ year, posts: list }) =>
    [
      '<div class="archive-year">',
      `  <h3 class="label archive-year__title" id="archief-${year}">${year}</h3>`,
      `  <ul class="archive-year__list" role="list" aria-labelledby="archief-${year}">`,
      ...list.map((p) =>
        [
          '    <li class="archive-entry">',
          `      <a class="archive-entry__link" href="${e(p.path)}">${e(p.view.title)}</a>`,
          `      <p class="archive-entry__meta"><span>${e(p.meta.category)}</span>${time(p.meta.date, formatDateNlShort(p.meta.date))}</p>`,
          '    </li>',
        ].join('\n'),
      ),
      '  </ul>',
      '</div>',
    ].join('\n'),
  );
  return [
    '<section class="section blog-archive" aria-labelledby="archive-title">',
    '  <div class="container">',
    indent(sectionHead('blog-archive__head', 'archive-title', 'Eerdere artikelen', `<p class="label list-head__count">${count(posts.length)}</p>`), 4),
    '    <ul class="post-list" role="list">',
    indent(full.map((p) => renderRow(p)).join('\n'), 6),
    '    </ul>',
    ...(yearBlocks.length ? ['    <div class="blog-archive__older">', indent(yearBlocks.join('\n'), 6), '    </div>'] : []),
    '  </div>',
    '</section>',
  ].join('\n');
}

export function renderEmptyState() {
  return [
    '<section class="section blog-empty" aria-labelledby="empty-title">',
    '  <div class="container">',
    '    <div class="blog-empty__grid">',
    '      <div class="blog-empty__panel" aria-hidden="true">',
    '        <dl class="readout"><dt>Kanaal</dt><dd>Signaal</dd><dt>Artikelen</dt><dd>0</dd><dt>Status</dt><dd><span class="status-dot is-blinking"></span>Afstemmen</dd></dl>',
    `        ${signalDivider('blog-empty__signal')}`,
    '      </div>',
    '      <div class="blog-empty__text">',
    '        <h2 class="blog-empty__title" id="empty-title">Nog geen artikelen.</h2>',
    '        <p>Het eerste artikel verschijnt hier binnenkort. Tot die tijd lees je bij de diensten hoe we teams trainen en coachen.</p>',
    '        <div class="btn-row">',
    '          <a class="btn btn--secondary" href="/diensten.html">Bekijk de diensten</a>',
    `          <a class="link-arrow" href="/over-ons.html">Over Flow State ${ICON_ARROW}</a>`,
    '        </div>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</section>',
  ].join('\n');
}

export function renderHeroFacts(posts) {
  const items = [];
  if (posts.length) {
    items.push(`<li>${count(posts.length)}</li>`);
    const newest = posts.map((p) => p.meta.updated).sort().pop();
    items.push(`<li>Bijgewerkt op ${time(newest)}</li>`);
  }
  items.push(`<li><a class="blog-hero__rss" href="/feed.xml">Volg Signaal via RSS ${ICON_ARROW_UP_RIGHT}</a></li>`);
  return `<ul class="blog-hero__facts" role="list">\n  ${items.join('\n  ')}\n</ul>`;
}

/* ---------- Homepage teaser between the blog:latest markers ---------- */

export function renderHomeLatest(posts, config, withStylesheet) {
  const latest = posts.slice(0, config.blog.latestOnHome || 3);
  if (!latest.length) return '';
  return [
    withStylesheet ? '<link rel="stylesheet" href="/assets/css/blog.css">' : '',
    '<section class="section blog-latest" aria-labelledby="blog-latest-title">',
    '  <div class="container">',
    '    <div class="section-head">',
    `      <div class="section-head__meta"><span class="label">${e(config.blog.name)}</span></div>`,
    '      <div class="section-head__body">',
    '        <h2 class="display" id="blog-latest-title">Laatste artikelen.</h2>',
    '        <p class="lead">Uit Signaal, onze blog over verkopen, coachen en telecom.</p>',
    '      </div>',
    '    </div>',
    `    <ul class="post-cards post-cards--${latest.length}" role="list" data-reveal="stagger">`,
    indent(latest.map((p) => renderCard(p)).join('\n'), 6),
    '    </ul>',
    `    <p class="blog-latest__more"><a class="link-arrow" href="/blog/">Alle artikelen op Signaal ${ICON_ARROW}</a></p>`,
    '  </div>',
    '</section>',
  ]
    .filter(Boolean)
    .join('\n');
}

/* ---------- Structured data ---------- */
// The organisation and website nodes describe the same @id as the homepage graph (dev/seo-heads.mjs),
// with the same values, all from tools/site.config.json. Placeholders such as [BTW-ID] are left out.

export function organizationNode(config) {
  const o = config.organization;
  const abs = (p) => config.siteUrl + p;
  const node = { '@type': o.type, '@id': organizationId(config), name: o.name };
  if (!isPlaceholder(o.legalName)) node.legalName = o.legalName;
  if (Array.isArray(o.alternateName) && o.alternateName.length) node.alternateName = o.alternateName;
  node.url = `${config.siteUrl}/`;
  node.logo = { '@type': 'ImageObject', url: abs(o.logo.path), width: o.logo.width, height: o.logo.height };
  if (o.image) node.image = abs(o.image);
  node.description = o.description;
  node.email = o.email;
  if (![o.street, o.postalCode, o.city].some(isPlaceholder)) {
    node.address = { '@type': 'PostalAddress', streetAddress: o.street, postalCode: o.postalCode, addressLocality: o.city, addressCountry: o.country };
  }
  if (o.areaServed) node.areaServed = { '@type': 'Country', name: o.areaServed };
  if (!isPlaceholder(o.kvk)) node.identifier = { '@type': 'PropertyValue', propertyID: 'KvK-nummer', value: o.kvk };
  if (!isPlaceholder(o.btwId)) node.vatID = o.btwId;
  if (Array.isArray(o.knowsAbout) && o.knowsAbout.length) node.knowsAbout = o.knowsAbout;
  if (Array.isArray(o.sameAs) && o.sameAs.length) node.sameAs = o.sameAs;
  node.contactPoint = { '@type': 'ContactPoint', contactType: 'sales', email: o.email, availableLanguage: ['nl'], areaServed: o.country };
  return node;
}

export const websiteNode = (config) => ({
  '@type': 'WebSite',
  '@id': websiteId(config),
  url: `${config.siteUrl}/`,
  name: config.siteName,
  inLanguage: config.language,
  publisher: { '@id': organizationId(config) },
});

const orgRef = (config) => ({ '@type': config.organization.type, '@id': organizationId(config), name: config.organization.name, url: `${config.siteUrl}/` });

const imageNode = (config) => ({
  '@type': 'ImageObject',
  url: config.siteUrl + config.defaultImage.path,
  width: config.defaultImage.width,
  height: config.defaultImage.height,
});

const blogNode = (config, extra = {}) => ({
  '@type': 'Blog',
  '@id': `${blogUrl(config)}#blog`,
  name: config.blog.name,
  ...extra,
  url: blogUrl(config),
  inLanguage: config.language,
  isPartOf: { '@id': websiteId(config) },
  publisher: { '@id': organizationId(config) },
});

function breadcrumbNode(id, items) {
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

export function postJsonLd(post, config) {
  const { meta, view } = post;
  const keywords = [...new Set([meta.primaryKeyword, ...meta.keywords].map((k) => k.trim()))];
  const graph = [
    organizationNode(config),
    websiteNode(config),
    blogNode(config),
    {
      '@type': 'BlogPosting',
      '@id': `${post.url}#article`,
      headline: view.title,
      description: view.description,
      url: post.url,
      datePublished: isoDateTime(meta.date),
      dateModified: isoDateTime(meta.updated),
      inLanguage: config.language,
      author: orgRef(config),
      publisher: orgRef(config),
      mainEntityOfPage: { '@type': 'WebPage', '@id': post.url },
      isPartOf: { '@id': `${blogUrl(config)}#blog` },
      image: imageNode(config),
      keywords: keywords.join(', '),
      articleSection: meta.category,
      wordCount: post.words,
      timeRequired: `PT${post.readingMinutes}M`,
      citation: view.sources.map((s) => ({
        '@type': 'CreativeWork',
        name: s.title,
        url: s.url,
        datePublished: s.date,
        publisher: { '@type': 'Organization', name: s.publisher },
      })),
    },
    breadcrumbNode(`${post.url}#breadcrumb`, [
      { name: 'Home', url: `${config.siteUrl}/` },
      { name: 'Blog', url: blogUrl(config) },
      { name: view.title, url: post.url },
    ]),
  ];
  if (view.faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${post.url}#faq`,
      inLanguage: config.language,
      mainEntity: view.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function indexJsonLd(posts, config) {
  const blog = blogNode(config, { alternateName: config.blog.fullName, description: config.blog.description, image: imageNode(config) });
  if (posts.length) {
    blog.blogPost = posts.map((p) => ({
      '@type': 'BlogPosting',
      '@id': `${p.url}#article`,
      headline: p.view.title,
      url: p.url,
      datePublished: isoDateTime(p.meta.date),
      dateModified: isoDateTime(p.meta.updated),
    }));
  }
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organizationNode(config),
      websiteNode(config),
      blog,
      breadcrumbNode(`${blogUrl(config)}#breadcrumb`, [
        { name: 'Home', url: `${config.siteUrl}/` },
        { name: 'Blog', url: blogUrl(config) },
      ]),
    ],
  };
}
