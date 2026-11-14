#!/usr/bin/env node
// Tells IndexNow (Bing, Yandex, Seznam, Naver, Yep and others) which URLs changed. Runs after each deploy.
// Google does not use IndexNow: it finds new pages through the sitemap (robots.txt points to it)
// and through Google Search Console.
//
//   node tools/indexnow.mjs --changed <from-sha> <to-sha>   pages and posts changed between two commits
//   node tools/indexnow.mjs --all                           every URL in site/sitemap.xml
//   node tools/indexnow.mjs --urls <url> [<url> ...]        exactly these URLs
//   add --dry-run to print the request instead of sending it
//
// Only URLs listed in site/sitemap.xml are sent. Problems become warnings; this never fails a deploy.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOME_MARKERS, ROOT, SITE_DIR, decodeEntities, loadConfig, readText } from './lib/shared.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning title=IndexNow::${msg}` : `Warning: ${msg}`);

const config = loadConfig();
const { key, endpoint } = config.indexNow;
const host = new URL(config.siteUrl).host;
const keyLocation = `${config.siteUrl}/${key}.txt`;

function sitemapUrls() {
  const file = path.join(SITE_DIR, 'sitemap.xml');
  if (!fs.existsSync(file)) return [];
  return [...readText(file).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decodeEntities(m[1]));
}

// Files changed between two commits, or null when that cannot be known (first push, rewritten history).
function changedFiles(from, to) {
  const git = (gitArgs) => execFileSync('git', gitArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  if (!from || /^0+$/.test(from)) return null;
  try {
    return git(['diff', '--name-only', from, to]).split('\n').filter(Boolean);
  } catch {
    try {
      return git(['diff-tree', '--no-commit-id', '--name-only', '-r', to]).split('\n').filter(Boolean);
    } catch {
      return null;
    }
  }
}

function urlsForFiles(files) {
  const urls = new Set();
  const homeFile = path.join(SITE_DIR, 'index.html');
  const homeHasTeaser = fs.existsSync(homeFile) && readText(homeFile).includes(HOME_MARKERS.start);
  for (const f of files) {
    let m;
    if ((m = /^content\/blog\/([^/]+)\//.exec(f))) {
      urls.add(`${config.siteUrl}/blog/${m[1]}.html`);
      urls.add(`${config.siteUrl}/blog/`);
      if (homeHasTeaser) urls.add(`${config.siteUrl}/`);
    } else if ((m = /^site\/blog\/([^/]+)\.html$/.exec(f))) {
      urls.add(m[1] === 'index' ? `${config.siteUrl}/blog/` : `${config.siteUrl}/blog/${m[1]}.html`);
    } else if ((m = /^site\/([^/_][^/]*)\.html$/.exec(f))) {
      urls.add(m[1] === 'index' ? `${config.siteUrl}/` : `${config.siteUrl}/${m[1]}.html`);
    }
  }
  return [...urls];
}

let candidates;
if (args.includes('--all')) {
  candidates = sitemapUrls();
} else if (args.includes('--changed')) {
  const i = args.indexOf('--changed');
  const files = changedFiles(args[i + 1], args[i + 2] || 'HEAD');
  if (files === null) console.log('Previous commit unknown; submitting every URL in the sitemap.');
  candidates = files === null ? sitemapUrls() : urlsForFiles(files);
} else if (args.includes('--urls')) {
  candidates = args.slice(args.indexOf('--urls') + 1).filter((a) => !a.startsWith('--'));
} else {
  console.log('Usage: node tools/indexnow.mjs --changed <from-sha> <to-sha> | --all | --urls <url> ... [--dry-run]');
  process.exit(2);
}

const inSitemap = new Set(sitemapUrls());
const urlList = [...new Set(candidates)].filter((u) => inSitemap.has(u)).sort();
const skipped = [...new Set(candidates)].filter((u) => !inSitemap.has(u));
if (skipped.length) console.log(`Not in the sitemap, not sent: ${skipped.join(', ')}`);
if (!urlList.length) {
  console.log('IndexNow: no changed pages to submit.');
  process.exit(0);
}

const body = { host, key, keyLocation, urlList };
if (dryRun) {
  console.log(`POST ${endpoint}\n${JSON.stringify(body, null, 2)}`);
  process.exit(0);
}

// IndexNow verifies ownership by reading the key file, so it has to be live first.
async function keyFileIsLive() {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(keyLocation, { cache: 'no-store', redirect: 'follow' });
      if (res.ok && (await res.text()).trim() === key) return true;
    } catch {
      // not reachable yet
    }
    if (attempt < 6) await new Promise((r) => setTimeout(r, 10000));
  }
  return false;
}

if (!(await keyFileIsLive())) {
  warn(`${keyLocation} is not reachable (is the domain live and pointing to GitHub Pages?). Nothing was submitted.`);
  process.exit(0);
}

try {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = (await res.text()).trim();
  if (res.status === 200 || res.status === 202) {
    console.log(`IndexNow accepted ${urlList.length} URL(s) (HTTP ${res.status}):\n  ${urlList.join('\n  ')}`);
  } else {
    warn(`IndexNow answered HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
} catch (err) {
  warn(`IndexNow request failed: ${err.message}`);
}
