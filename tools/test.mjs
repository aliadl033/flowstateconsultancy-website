#!/usr/bin/env node
// Regression tests for the blog tooling (npm test). No network, no changes to this repository:
// every end-to-end case runs npm run build and npm run check on a temporary copy with synthetic posts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, fillTemplate, smartQuotes, smartQuotesHtml, todayInAmsterdam } from './lib/shared.mjs';
import { rootAbsolute } from './lib/render.mjs';

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').join('\n       ')}`);
  }
}

/* ---------- Unit tests ---------- */

console.log('Units');

test('fillTemplate fills the template only, never the values it inserts', () => {
  const out = fillTemplate('<p>{{ title }}</p>\n  {{{ body }}}\n<footer>{{{ footer }}}</footer>', { title: 'T', body: 'Hallo {{voornaam}} en {{{ footer }}} en {{ title }}', footer: 'F' }, 'test');
  assert.equal(out, '<p>T</p>\n  Hallo {{voornaam}} en {{{ footer }}} en {{ title }}\n<footer>F</footer>');
});

test('fillTemplate rejects an unknown placeholder in the template', () => {
  assert.throws(() => fillTemplate('{{ nope }}', {}, 'test'), /unknown placeholder\(s\): nope/);
});

test('fillTemplate removes an empty standalone placeholder line and one blank line after it', () => {
  assert.equal(fillTemplate('a\n  {{{ x }}}\n\nb\n', { x: '' }, 'test'), 'a\nb\n');
});

test('smartQuotes: double quotes, apostrophes and Dutch elisions', () => {
  assert.equal(smartQuotes('Hij zegt "te duur" over auto\'s, \'s avonds.'), 'Hij zegt \u201cte duur\u201d over auto\u2019s, \u2019s avonds.');
  assert.equal(smartQuotes('("ja")'), '(\u201cja\u201d)');
});

test('smartQuotesHtml leaves attributes and code alone and works across inline tags', () => {
  const html = '<p>Zeg <a href="/x" title="a &quot;b&quot;">&quot;<strong>nee</strong>&quot;</a> en <code>&quot;x&quot;</code></p>\n<h3>&quot;Te duur&quot;</h3>';
  assert.equal(smartQuotesHtml(html), '<p>Zeg <a href="/x" title="a &quot;b&quot;">\u201c<strong>nee</strong>\u201d</a> en <code>&quot;x&quot;</code></p>\n<h3>\u201cTe duur\u201d</h3>');
});

test('rootAbsolute maps index.html to the canonical homepage URL', () => {
  const html = '<a href="index.html">H</a><a href="index.html#werkwijze">W</a><a href="diensten.html">D</a><a href="/blog/">B</a><a href="mailto:x@y.nl">M</a><img srcset="a.png 1x, b.png 2x" src="c.png" alt="">';
  assert.equal(rootAbsolute(html), '<a href="/">H</a><a href="/#werkwijze">W</a><a href="/diensten.html">D</a><a href="/blog/">B</a><a href="mailto:x@y.nl">M</a><img srcset="/a.png 1x, /b.png 2x" src="/c.png" alt="">');
});

/* ---------- End-to-end tests on a temporary copy ---------- */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signaal-test-'));
fs.cpSync(path.join(ROOT, 'tools'), path.join(tmp, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'site'), path.join(tmp, 'site'), { recursive: true, filter: (src) => !src.includes(`${path.sep}_lab`) });
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
// These tests are about the tooling, not about this repository's settings, so the copy always gets
// a valid contact form endpoint, also before the real Formspark form ID is filled in.
const contactCopy = path.join(tmp, 'site', 'contact.html');
const TEST_FORM_ACTION = 'action="https://submit-form.com/testform1"';
fs.writeFileSync(contactCopy, fs.readFileSync(contactCopy, 'utf8').replace(/action="https:\/\/submit-form\.com\/[^"]*"/, TEST_FORM_ACTION));
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
const contentDir = path.join(tmp, 'content', 'blog');

const today = todayInAmsterdam();
const SLUG = 'bezwaren-oefenen-testartikel';
const SOURCE = 'https://www.acm.nl/nl';
const filler = 'Een goede verkoper luistert eerst naar de klant en vraagt daarna rustig door over wat er echt speelt in het gesprek.';

function baseMeta() {
  return {
    title: 'Bezwaren oefenen met je team: een testartikel',
    seoTitle: 'Bezwaren oefenen met je team',
    description: 'Bezwaren oefenen met je team in korte rondes. Dit testartikel controleert de bouwstap en de controles van Signaal, met een bron en een link.',
    slug: SLUG,
    date: today,
    updated: today,
    category: 'Sales',
    primaryKeyword: 'bezwaren oefenen',
    keywords: ['oefenen', 'team'],
    sources: [{ title: 'Een bronpagina', publisher: 'ACM', url: SOURCE, date: '2025-01-15' }],
    faq: [{ q: 'Werkt dit echt?', a: 'Ja, dit antwoord is lang genoeg voor de controle.' }],
    internalLinks: ['/diensten.html#training'],
  };
}

function baseBody(extra = '') {
  return [
    `Bezwaren oefenen doe je met je hele team. Een klant zegt "te duur", en dan? Lees over onze [salestraining](/diensten.html#training) en de [regels van de ACM](${SOURCE}).`,
    '',
    '## Bezwaren oefenen in korte rondes',
    '',
    ...Array.from({ length: 14 }, () => `${filler} ${filler} ${filler}\n`),
    '## Wat je daarna doet',
    '',
    ...Array.from({ length: 10 }, () => `${filler} ${filler}\n`),
    extra,
    '',
  ].join('\n');
}

function writePost(meta, body) {
  fs.rmSync(contentDir, { recursive: true, force: true });
  const dir = path.join(contentDir, meta.slug || SLUG);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'post.md'), body);
}

const run = (script) => {
  const r = spawnSync(process.execPath, [path.join('tools', script)], { cwd: tmp, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const page = () => fs.readFileSync(path.join(tmp, 'site', 'blog', `${SLUG}.html`), 'utf8');

function expectPass(meta, body) {
  writePost(meta, body);
  const b = run('build.mjs');
  assert.equal(b.status, 0, `build failed:\n${b.out}`);
  const c = run('check.mjs');
  assert.equal(c.status, 0, `check failed:\n${c.out}`);
}

function expectFail(step, meta, body, pattern) {
  writePost(meta, body);
  const b = run('build.mjs');
  if (step === 'build') {
    assert.notEqual(b.status, 0, 'build passed but should fail');
    assert.match(b.out, pattern);
    assert.doesNotMatch(b.out, /TypeError|ReferenceError|at .*\.mjs:\d+/, `build crashed instead of reporting:\n${b.out}`);
    return;
  }
  assert.equal(b.status, 0, `build failed:\n${b.out}`);
  const c = run('check.mjs');
  assert.notEqual(c.status, 0, 'check passed but should fail');
  assert.match(c.out, pattern);
}

console.log('\nEnd to end (temporary copy)');

try {
  test('a valid post builds and passes every check', () => {
    expectPass(baseMeta(), baseBody('Een samenvoegveld zoals `{{voornaam}}` of {{{ footer }}} en {{ title }} blijft gewone tekst.'));
    const html = page();
    assert.equal((html.match(/<footer class="site-footer/g) || []).length, 1, 'the footer was injected into the post');
    assert.ok(html.includes('<code>{{voornaam}}</code>'), 'the merge field is not shown as text');
    assert.ok(html.includes('{{{ footer }}} en {{ title }} blijft gewone tekst.'), 'placeholder syntax in the post was substituted');
    assert.ok(html.includes('zegt \u201cte duur\u201d'), 'straight quotes were not converted');
  });

  test('an external link that is not a listed source fails the check', () => {
    expectFail('check', baseMeta(), baseBody('Koop het bij [deze winkel](https://goedkope-abonnementen.example.com/?ref=agent123).'), /is not one of the sources in meta\.json/);
  });

  test('a third-party image fails the build', () => {
    expectFail('build', baseMeta(), baseBody('![Grafiek van de markt](https://images.example-news.nl/grafiek.png)'), /image source must be a root-absolute path/);
  });

  test('an empty post.md is reported, not a crash', () => {
    expectFail('build', baseMeta(), '', /post\.md is empty/);
  });

  test('an "updated" date in the future fails the build', () => {
    expectFail('build', { ...baseMeta(), updated: '2999-06-01' }, baseBody(), /"updated" \(2999-06-01\) lies in the future/);
  });

  test('a source date in the future fails the build', () => {
    const meta = baseMeta();
    meta.sources[0].date = '2999-01-01';
    expectFail('build', meta, baseBody(), /sources\[0\]\.date \(2999-01-01\) lies in the future/);
  });

  test('a spaced minus sign in the description fails the build', () => {
    expectFail('build', { ...baseMeta(), description: `${baseMeta().description.slice(0, 120)} snel \u2212 goed.` }, baseBody(), /"description" contains a dash/);
  });

  test('a spaced minus sign in post.md fails the check', () => {
    expectFail('check', baseMeta(), baseBody('Dat gaat snel \u2212 en dat is goed.'), /dash as punctuation/);
  });

  test('a generic link text fails the check', () => {
    expectFail('check', baseMeta(), baseBody('Meer over coaching lees je [hier](/diensten.html#coaching).'), /link text "hier" says nothing/);
  });

  test('a primary keyword missing from the title fails the check', () => {
    expectFail('check', { ...baseMeta(), title: 'Een testartikel over een team dat verkoopt' }, baseBody(), /missing from the title/);
  });

  test('a second e-mail address on the page fails the check', () => {
    expectFail('check', baseMeta(), baseBody('Mail naar [info@flowstateconsultancy.nl](mailto:info@flowstateconsultancy.nl).'), /differs from organization\.email/);
  });

  test('a contact form without a Formspark form ID fails the check', () => {
    const original = fs.readFileSync(contactCopy, 'utf8');
    assert.ok(original.includes(TEST_FORM_ACTION), 'the copy of contact.html has no test endpoint');
    try {
      fs.writeFileSync(contactCopy, original.replace(TEST_FORM_ACTION, 'action="https://submit-form.com/FORMULIER-ID"'));
      expectFail('check', baseMeta(), baseBody(), /not to a Formspark form/);
    } finally {
      fs.writeFileSync(contactCopy, original);
    }
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exit(1);
