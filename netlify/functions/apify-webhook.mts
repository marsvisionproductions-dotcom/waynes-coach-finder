// Apify calls this when a Facebook run finishes. We pull the dataset and ingest it.
import type { Config } from '@netlify/functions';
import { fetchDataset, mapApifyItem } from '../../src/collectors/apify.mts';
import { ingest } from '../../src/lib/ingest.mts';
import { db, initDb } from '../../src/lib/db.mts';

export default async (req: Request) => {
  const url = new URL(req.url);
  const s = process.env.INGEST_SECRET;
  if (s && url.searchParams.get('secret') !== s) return new Response('unauthorized', { status: 401 });
  const body = await req.json().catch(() => ({})) as any;
  const status = body.eventType || body.resource?.status;
  const datasetId = body.resource?.defaultDatasetId || body.datasetId || url.searchParams.get('datasetId');
  if (!datasetId) return new Response(JSON.stringify({ error: 'no datasetId' }), { status: 400 });
  if (status && /FAILED|TIMED_OUT/.test(status)) { console.warn('apify run failed', body.resource?.id); }
  const items = await fetchDataset(datasetId);
  const raws = items.map(mapApifyItem).filter(Boolean) as any[];
  const r = await ingest(raws);
  await initDb();
  await db().sql`INSERT INTO runs (trigger, status, finished_at, summary) VALUES ('webhook', 'ok', now(), ${JSON.stringify({ apify: { datasetId, status, items: items.length, ...r, ids: undefined } })}::jsonb)`;
  console.log('apify webhook', datasetId, items.length, 'items →', r.inserted, 'new');
  return new Response(JSON.stringify({ ok: true, items: items.length, inserted: r.inserted, updated: r.updated, dropped_dealer: r.dropped_dealer }), { headers: { 'content-type': 'application/json' } });
};

export const config: Config = { path: '/api/apify-webhook' };
