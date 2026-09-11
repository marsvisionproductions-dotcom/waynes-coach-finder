// Apify calls this when a Facebook run finishes. We pull the dataset and ingest it.
import type { Config } from '@netlify/functions';
import { fetchDataset, mapApifyItem, startFacebookRun } from '../../src/collectors/apify.mts';
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
  const stage = url.searchParams.get('stage') || 'detail';
  let detail: any = null;
  if (stage === 'search' && r.ids.length) {
    // which search URLs produced the coaches we just inserted? re-run only those, with details on
    const newIds = new Set(r.ids.slice(-r.inserted));
    const byId = new Map(raws.map((x: any) => [String(x.external_id), x]));
    // …plus any Facebook coach still missing its photos from an earlier day, so nobody stays a grey placeholder
    const seen = await import('../../src/lib/db.mts').then(async m => { await m.initDb(); return m.db().sql`SELECT s.external_id FROM listing_sources s JOIN listings l ON l.id = s.listing_id WHERE s.source = 'fb' AND (s.listing_id = ANY(${[...newIds]}) OR (l.stage = 'new' AND l.thumb_url IS NULL))`; });
    const searchUrls = [...new Set(seen.map((s: any) => byId.get(String(s.external_id))?.raw?.searchUrl).filter(Boolean))] as string[];
    if (searchUrls.length) { try { detail = await startFacebookRun({ siteUrl: process.env.URL || url.origin, stage: 'detail', urls: searchUrls.slice(0, 20) }); } catch (e: any) { detail = { error: e.message }; } }
  }
  await initDb();
  await db().sql`INSERT INTO runs (trigger, status, finished_at, summary) VALUES ('webhook', 'ok', now(), ${JSON.stringify({ apify: { stage, datasetId, status, items: items.length, ...r, ids: undefined, detail } })}::jsonb)`;
  console.log('apify webhook', datasetId, items.length, 'items →', r.inserted, 'new');
  return new Response(JSON.stringify({ ok: true, items: items.length, inserted: r.inserted, updated: r.updated, dropped_dealer: r.dropped_dealer }), { headers: { 'content-type': 'application/json' } });
};

export const config: Config = { path: '/api/apify-webhook' };
