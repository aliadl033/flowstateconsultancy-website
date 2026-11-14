#!/usr/bin/env node
// Local preview of site/ that behaves like GitHub Pages (npm run serve).
//   /blog/        serves site/blog/index.html
//   /blog/x       serves site/blog/x.html when it exists
//   unknown URLs  get site/404.html with status 404
// Options: PORT=4321 (or the first argument). Binds to 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_DIR } from './lib/shared.mjs';

const port = Number(process.argv[2] || process.env.PORT || 4321);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function resolve(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const abs = path.normalize(path.join(SITE_DIR, p));
  if (abs !== SITE_DIR && !abs.startsWith(SITE_DIR + path.sep)) return null;
  const candidates = p.endsWith('/') ? [path.join(abs, 'index.html')] : [abs, `${abs}.html`, path.join(abs, 'index.html')];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

const server = http.createServer((req, res) => {
  const file = resolve(req.url || '/');
  const notFound = path.join(SITE_DIR, '404.html');
  const target = file || (fs.existsSync(notFound) ? notFound : null);
  if (!target) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(file ? 200 : 404, {
    'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(target).pipe(res);
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is in use. Try: PORT=4400 npm run serve` : err.message);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => console.log(`Serving site/ at http://localhost:${port}/  (blog: http://localhost:${port}/blog/)`));
