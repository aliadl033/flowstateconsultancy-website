#!/usr/bin/env node
// SEO head pass for the static pages. Idempotent: everything it writes lives between
// <!-- seo:start --> and <!-- seo:end --> in <head>, and it removes the tags it replaces.
// Usage: node dev/seo-heads.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../tools/lib/shared.mjs';
import { organizationNode, websiteNode } from '../tools/lib/render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '../site');
const dry = process.argv.includes('--dry');
const BASE = 'https://flowstateconsultancy.nl';
const ORG_ID = `${BASE}/#organization`;
const WEBSITE_ID = `${BASE}/#website`;
const OG_IMAGE = `${BASE}/assets/img/og-image.png`;

// The Organization and WebSite nodes come from the blog tooling, so every page describes the
// company identically under one @id, all from tools/site.config.json.
const config = loadConfig();
const organization = organizationNode(config);
const website = websiteNode(config);

const crumbs = (items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
});

const services = [
  ['training', 'Salestraining', 'Praktische trainingen voor verkopers, in-company en op maat: gespreksopbouw, behoefteanalyse, bezwaren en afsluiten.'],
  ['coaching', 'Coaching op de vloer', 'Meeluisteren met echte gesprekken en direct feedback geven, zodat wat in de training is geoefend de standaard wordt.'],
  ['gespreksanalyse', 'Gespreksanalyse', 'Opgenomen gesprekken beoordelen met een vaste scorekaart, zodat zichtbaar wordt waar gesprekken stranden.'],
  ['teamleiders', 'Coaching voor teamleiders', 'Teamleiders leren zelf coachen: meeluisteren, feedback geven en het team scherp houden.'],
];

const PAGES = {
  'index.html': {
    url: `${BASE}/`,
    title: 'Salestraining en sales coaching voor telecom | Flow State',
    description: 'Flow State Consultancy traint en coacht salesteams. Gespecialiseerd in telecom: outbound, inbound en retentie, retail, deur-aan-deur en zakelijk.',
    graph: (p) => [organization, website, { '@type': 'WebPage', '@id': `${p.url}#webpage`, url: p.url, name: p.title, description: p.description, inLanguage: 'nl-NL', isPartOf: { '@id': WEBSITE_ID }, about: { '@id': ORG_ID }, primaryImageOfPage: OG_IMAGE }],
  },
  'diensten.html': {
    url: `${BASE}/diensten.html`,
    title: 'Salestraining, coaching en gespreksanalyse | Flow State',
    description: 'Salestraining, coaching op de vloer, gespreksanalyse en coaching voor teamleiders. Met trainingsmodules voor outbound, inbound, retail en zakelijk.',
    graph: (p) => [
      { '@type': 'WebPage', '@id': `${p.url}#webpage`, url: p.url, name: p.title, description: p.description, inLanguage: 'nl-NL', isPartOf: { '@id': WEBSITE_ID }, breadcrumb: { '@id': `${p.url}#breadcrumb` } },
      { ...crumbs([{ name: 'Home', url: `${BASE}/` }, { name: 'Diensten', url: p.url }]), '@id': `${p.url}#breadcrumb` },
      ...services.map(([id, name, description]) => ({ '@type': 'Service', '@id': `${p.url}#${id}`, name, description, serviceType: name, url: `${p.url}#${id}`, provider: { '@id': ORG_ID }, areaServed: { '@type': 'Country', name: 'Nederland' }, inLanguage: 'nl-NL' })),
    ],
  },
  'over-ons.html': {
    url: `${BASE}/over-ons.html`,
    title: 'Over ons: het verhaal achter Flow State Consultancy',
    description: 'Waar de naam Flow State vandaan komt, waar we voor staan en waarom we ons specialiseren in sales binnen telecom. Training en coaching met flow.',
    graph: (p) => [
      { '@type': 'AboutPage', '@id': `${p.url}#webpage`, url: p.url, name: p.title, description: p.description, inLanguage: 'nl-NL', isPartOf: { '@id': WEBSITE_ID }, about: { '@id': ORG_ID }, breadcrumb: { '@id': `${p.url}#breadcrumb` } },
      { ...crumbs([{ name: 'Home', url: `${BASE}/` }, { name: 'Over ons', url: p.url }]), '@id': `${p.url}#breadcrumb` },
    ],
  },
  'contact.html': {
    url: `${BASE}/contact.html`,
    title: 'Contact en kennismaking | Flow State Consultancy',
    description: 'Plan een kennismaking met Flow State Consultancy. Vertel wat er in je salesteam speelt, dan kijken we samen waar de ruis zit.',
    faqFromPage: true,
    graph: (p, faq) => [
      { '@type': 'ContactPage', '@id': `${p.url}#webpage`, url: p.url, name: p.title, description: p.description, inLanguage: 'nl-NL', isPartOf: { '@id': WEBSITE_ID }, about: { '@id': ORG_ID }, breadcrumb: { '@id': `${p.url}#breadcrumb` } },
      { ...crumbs([{ name: 'Home', url: `${BASE}/` }, { name: 'Contact', url: p.url }]), '@id': `${p.url}#breadcrumb` },
      ...(faq.length ? [{ '@type': 'FAQPage', '@id': `${p.url}#faq`, mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }] : []),
    ],
  },
  'privacy.html': {
    url: `${BASE}/privacy.html`,
    title: 'Privacyverklaring | Flow State Consultancy',
    description: 'Hoe Flow State Consultancy omgaat met persoonsgegevens: welke gegevens we verwerken, waarom, hoe lang we ze bewaren en welke rechten je hebt.',
    graph: (p) => [
      { '@type': 'WebPage', '@id': `${p.url}#webpage`, url: p.url, name: p.title, description: p.description, inLanguage: 'nl-NL', isPartOf: { '@id': WEBSITE_ID }, breadcrumb: { '@id': `${p.url}#breadcrumb` } },
      { ...crumbs([{ name: 'Home', url: `${BASE}/` }, { name: 'Privacyverklaring', url: p.url }]), '@id': `${p.url}#breadcrumb` },
    ],
  },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function extractFaq(html) {
  const out = [];
  const re = /<details[^>]*class="[^"]*faq__item[^"]*"[^>]*>([\s\S]*?)<\/details>/g;
  let m;
  while ((m = re.exec(html))) {
    const q = strip((m[1].match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || '');
    const a = strip(m[1].replace(/<summary[\s\S]*?<\/summary>/, ''));
    if (q && a) out.push({ q, a });
  }
  return out;
}

const report = [];
for (const [file, page] of Object.entries(PAGES)) {
  const p = path.join(SITE, file);
  if (!fs.existsSync(p)) { report.push(`${file}: missing`); continue; }
  let html = fs.readFileSync(p, 'utf8');
  // remove previous block and the tags we own
  html = html.replace(/\s*<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, '');
  html = html.replace(/\s*<title>[\s\S]*?<\/title>/, '');
  html = html.replace(/\s*<meta name="description"[^>]*>/g, '');
  html = html.replace(/\s*<meta name="robots"[^>]*>/g, '');
  html = html.replace(/\s*<link rel="canonical"[^>]*>/g, '');
  html = html.replace(/\s*<meta property="og:[^"]+"[^>]*>/g, '');
  html = html.replace(/\s*<meta name="twitter:[^"]+"[^>]*>/g, '');
  html = html.replace(/\s*<link rel="alternate" type="application\/rss\+xml"[^>]*>/g, '');
  html = html.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');

  const faq = page.faqFromPage ? extractFaq(html) : [];
  const graph = { '@context': 'https://schema.org', '@graph': page.graph(page, faq) };
  const lines = [
    '<!-- seo:start -->',
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    `<link rel="canonical" href="${page.url}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="nl_NL">',
    '<meta property="og:site_name" content="Flow State Consultancy">',
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:url" content="${page.url}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Flow State Consultancy: Verkopen zonder ruis.">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(page.title)}">`,
    `<meta name="twitter:description" content="${esc(page.description)}">`,
    `<meta name="twitter:image" content="${OG_IMAGE}">`,
    '<link rel="alternate" type="application/rss+xml" title="Signaal, de blog van Flow State" href="/feed.xml">',
    `<script type="application/ld+json">${JSON.stringify(graph)}</script>`,
    '<!-- seo:end -->',
  ];
  const indent = '  ';
  html = html.replace(/(<meta name="viewport"[^>]*>)/, `$1\n${indent}${lines.join(`\n${indent}`)}`);
  if (!html.includes('<!-- seo:start -->')) { report.push(`${file}: viewport meta not found, nothing inserted`); continue; }
  if (page.title.length > 60) report.push(`${file}: title ${page.title.length} chars`);
  if (page.description.length < 110 || page.description.length > 160) report.push(`${file}: description ${page.description.length} chars`);
  if (!dry) fs.writeFileSync(p, html);
  report.push(`${file}: seo head written${faq.length ? `, FAQPage with ${faq.length} questions` : ''}`);
}
console.log(report.join('\n'));
