// Local preview without Netlify: serves public/ and routes /api/* to the real function with an in-process Postgres.
// Usage: COACH_DB=pglite node scripts/dev-local.mjs  → http://localhost:8788
process.env.COACH_DB ||= 'pglite';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const api = (await import('../netlify/functions/api.mts')).default;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const port = +(process.env.PORT || 8788);
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await api(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), {});
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let p = join('public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(p)) p = 'public/index.html';
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(port, () => console.log(`coach finder local → http://localhost:${port}`));
