#!/usr/bin/env node
// Preflight for the Signaal blog routine (automation/ROUTINE.md, section 1). Run from the project root:
//   node automation/preflight.mjs
// Checks the environment, the repository and the live site before anything is written, and names the
// exact reason when a run should not publish. Read-only: it changes no files and pushes nothing.
// Exit code 0: go. Exit code 3: stop, the last line says why. Lines starting with "deploy:" go into the log.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONTENT_DIR, ROOT, loadConfig, parseIsoDate, postPath, todayInAmsterdam } from '../tools/lib/shared.mjs';

const lines = [];
const stops = [];
const say = (kind, msg) => lines.push(`${kind.padEnd(5)} ${msg}`);
const ok = (msg) => say('ok', msg);
const warn = (msg) => say('warn', msg);
const stop = (msg) => {
  say('STOP', msg);
  stops.push(msg);
};

function run(cmd, args, timeout = 30000) {
  try {
    // Never wait for a password prompt: unattended runs must fail fast and say why.
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' };
    return { ok: true, out: execFileSync(cmd, args, { cwd: ROOT, timeout, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim() };
  } catch (err) {
    return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}`.toString().trim() || err.message };
  }
}

async function reach(url, method = 'HEAD') {
  try {
    const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'signaal-preflight' } });
    return { ok: true, status: res.status, res };
  } catch (err) {
    return { ok: false, error: err.cause ? err.cause.code || err.cause.message : err.message };
  }
}

const config = loadConfig();
const today = todayInAmsterdam();
ok(`today in Amsterdam is ${today}`);

/* ---------- Pause switch: the owner adds automation/PAUZE on GitHub to stop the routine ---------- */
const pauseFile = path.join(ROOT, 'automation', 'PAUZE');
if (fs.existsSync(pauseFile)) {
  const note = fs.readFileSync(pauseFile, 'utf8').trim().split('\n')[0];
  stop(`the routine is paused: automation/PAUZE exists${note ? ` ("${note.slice(0, 120)}")` : ''}; delete that file to resume`);
}

/* ---------- Tools ---------- */
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok(`node ${process.versions.node}`);
else stop(`node ${process.versions.node} is too old; the build needs Node 20 or newer`);
for (const [cmd, args, why] of [
  ['npm', ['--version'], 'npm ci, build and check'],
  ['python3', ['--version'], 'the copy and XML checks in npm run check'],
  ['git', ['--version'], 'committing and pushing'],
]) {
  const r = run(cmd, args);
  if (r.ok) ok(`${cmd} ${r.out.replace(/^(Python|git version) /, '')}`);
  else stop(`${cmd} is not available; it is needed for ${why}`);
}

/* ---------- Posting rhythm ---------- */
const posts = fs.existsSync(CONTENT_DIR)
  ? fs.readdirSync(CONTENT_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
  : [];
let newest = null;
for (const d of posts) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, d.name, 'meta.json'), 'utf8'));
    if (parseIsoDate(meta.date) && (!newest || meta.date > newest.date)) newest = { slug: d.name, date: meta.date };
  } catch {
    // a broken post is reported by npm run check
  }
}
if (newest) {
  const days = Math.round((parseIsoDate(today).utc - parseIsoDate(newest.date).utc) / 86400000);
  if (days < 2) stop(`the newest post (${newest.slug}, ${newest.date}) is less than two days old; a recent run already published`);
  else ok(`newest post ${newest.slug} is ${days} days old`);
} else ok('no posts yet');

/* ---------- Repository ---------- */
const remote = run('git', ['remote', 'get-url', 'origin']);
const repoMatch = remote.ok ? /([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote.out) : null;
const repo = repoMatch ? `${repoMatch[1]}/${repoMatch[2]}` : null;
const heads = run('git', ['ls-remote', '--heads', 'origin'], 60000);
if (!heads.ok) stop(`cannot reach the GitHub repository with git (${heads.out.split('\n')[0]}); check the routine's repository access`);
else {
  ok(`git can reach origin${repo ? ` (${repo})` : ''}`);
  const stranded = heads.out
    .split('\n')
    .map((l) => l.split('\t')[1] || '')
    .filter((ref) => ref.startsWith('refs/heads/claude/blog-'))
    .map((ref) => ref.replace('refs/heads/', ''));
  if (stranded.length) stop(`unpublished blog branch on GitHub: ${stranded.join(', ')}; a person has to merge or delete it first`);
  else ok('no unpublished claude/blog-* branches');
}
const identity = run('git', ['config', 'user.email']);
if (!identity.ok || !identity.out) warn(`git has no identity yet; use name "Signaal blog agent" and e-mail ${config.organization.email}`);

/* ---------- Last deploy ---------- */
let deploy = null;
const ghAuth = run('gh', ['auth', 'status']);
if (ghAuth.ok && repo) {
  const r = run('gh', ['run', 'list', '--repo', repo, '--workflow', 'deploy.yml', '--branch', 'main', '--limit', '1', '--json', 'status,conclusion,headSha,url']);
  if (r.ok) {
    const [last] = JSON.parse(r.out || '[]');
    if (last) deploy = { status: last.status, conclusion: last.conclusion, sha: last.headSha, url: last.url, via: 'gh' };
  }
}
if (!deploy && repo) {
  const r = await reach(`https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/runs?branch=main&per_page=1`, 'GET');
  if (r.ok && r.status === 200) {
    const data = await r.res.json();
    const last = data.workflow_runs && data.workflow_runs[0];
    if (last) deploy = { status: last.status, conclusion: last.conclusion, sha: last.head_sha, url: last.html_url, via: 'GitHub API' };
  }
}
if (!deploy) {
  warn('could not read the last deploy (no gh login, no GitHub connector result and the public API gave nothing); the live check below decides');
  lines.push('deploy: unknown');
} else {
  const label = deploy.status === 'completed' ? deploy.conclusion : deploy.status;
  lines.push(`deploy: ${label} ${String(deploy.sha).slice(0, 7)}`);
  if (deploy.status === 'completed' && ['failure', 'timed_out', 'startup_failure'].includes(deploy.conclusion)) {
    stop(`the last deploy failed (${String(deploy.sha).slice(0, 7)}, ${deploy.url}); fix the site first, a new post would not go live`);
  } else ok(`last deploy: ${label} (${String(deploy.sha).slice(0, 7)}, via ${deploy.via})`);
}

/* ---------- Live site ---------- */
if (newest) {
  const url = config.siteUrl + postPath(newest.slug);
  const r = await reach(url);
  if (!r.ok) warn(`cannot reach ${url} (${r.error}); the domain may not be live yet, or this environment blocks it`);
  else if (r.status === 404) stop(`${url} answers 404: the newest post never went live, so deploys are not reaching the site`);
  else if (r.status >= 400) warn(`${url} answers HTTP ${r.status}`);
  else ok(`newest post is live (${url})`);
}

/* ---------- Network for npm and research ---------- */
const npmReg = await reach('https://registry.npmjs.org/marked', 'GET');
if (npmReg.ok && npmReg.status < 400) ok('npm registry reachable');
else stop(`the npm registry is not reachable (${npmReg.error || `HTTP ${npmReg.status}`}); npm ci cannot install the build tools`);
const research = ['https://www.acm.nl/nl', 'https://www.rijksoverheid.nl/', 'https://nos.nl/'];
const reached = [];
for (const url of research) {
  const r = await reach(url);
  if (r.ok && r.status < 500) reached.push(url);
}
if (reached.length) ok(`news and government sites reachable (${reached.length} of ${research.length})`);
else warn('none of www.acm.nl, www.rijksoverheid.nl and nos.nl can be reached from here; try one WebFetch yourself, and stop if that fails too (sources cannot be verified)');

/* ---------- Result ---------- */
console.log('PREFLIGHT');
for (const l of lines) console.log(l);
if (stops.length) {
  console.log(`RESULT stop: ${stops[0]}`);
  process.exit(3);
}
console.log('RESULT go');
