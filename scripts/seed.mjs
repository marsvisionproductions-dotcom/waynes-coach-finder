// Seeds sample listings into a running local server: node scripts/seed.mjs [http://localhost:8788]
import { readFileSync } from 'node:fs';
const base = process.argv[2] || 'http://localhost:8788';
const items = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8').replace(/"__H-(\d+)__"/g, (_, h) => JSON.stringify(new Date(Date.now() - h * 3600e3).toISOString())));
const r = await fetch(base + '/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET || '' }, body: JSON.stringify(items) });
console.log(r.status, await r.text());
