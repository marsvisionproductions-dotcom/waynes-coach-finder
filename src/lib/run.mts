// The daily run: every collector → ingest → sweep → digest. Called by the background function.
import { db, initDb, getSetting } from './db.mts';
import { ingest, sweepGone, type IngestResult } from './ingest.mts';
import { collectEbay } from '../collectors/ebay.mts';
import { collectFeeds } from '../collectors/rss.mts';
import { collectPrevostStuff } from '../collectors/prevoststuff.mts';
import { collectRvusa } from '../collectors/rvusa.mts';
import { startFacebookRun } from '../collectors/apify.mts';
import { collectRvtrader } from '../collectors/rvtrader.mts';
import { sendDigest } from './digest.mts';

export interface RunSummary { runId: number; started: string; finished?: string; sources: Record<string, any>; totals: Partial<IngestResult>; gone: number; digest?: any; errors: string[] }

export async function runAll(opts: { trigger: string; siteUrl: string; facebook?: boolean; digest?: boolean; sources?: string[] }): Promise<RunSummary> {
  await initDb();
  const sql = db().sql;
  const [run] = await sql`INSERT INTO runs (trigger) VALUES (${opts.trigger}) RETURNING id, started_at`;
  const summary: RunSummary = { runId: run.id, started: run.started_at, sources: {}, totals: {}, gone: 0, errors: [] };
  const minPrice = await getSetting<number>('min_price', 100000);
  const want = (s: string) => !opts.sources || opts.sources.includes(s);
  const add = (r: IngestResult) => { for (const k of ['received', 'relevant', 'inserted', 'updated', 'dropped_dealer', 'dropped_irrelevant'] as const) summary.totals[k] = (summary.totals[k] || 0) + r[k]; };

  const step = async (name: string, fn: () => Promise<{ items: any[]; errors?: string[]; skipped?: string }>) => {
    if (!want(name)) return;
    try {
      const r = await fn();
      const ing = r.items.length ? await ingest(r.items) : null;
      summary.sources[name] = { found: r.items.length, ...(ing ? { inserted: ing.inserted, updated: ing.updated, dropped_dealer: ing.dropped_dealer } : {}), ...(r.skipped ? { skipped: r.skipped } : {}), ...(r.errors?.length ? { errors: r.errors } : {}) };
      if (ing) add(ing);
    } catch (e: any) { summary.sources[name] = { error: e.message }; summary.errors.push(`${name}: ${e.message}`); }
  };

  await step('ebay', () => collectEbay({ minPrice }));
  await step('feeds', () => collectFeeds());
  await step('prevoststuff', () => collectPrevostStuff());
  await step('rvusa', () => collectRvusa({ days: 2, maxPages: 25 }));
  await step('rvtrader', () => collectRvtrader());

  if (opts.facebook !== false && want('fb')) {
    try {
      const radius = await getSetting<number>('fb_radius_mi', 500);
      const r = await startFacebookRun({ siteUrl: opts.siteUrl, radiusMi: radius, minPrice, daysSinceListed: 1 });
      summary.sources.fb = 'skipped' in r ? { skipped: r.skipped } : { started: r.runId, urls: r.urls, note: 'results arrive by webhook when the Apify run finishes' };
    } catch (e: any) { summary.sources.fb = { error: e.message }; summary.errors.push(`fb: ${e.message}`); }
  }

  try { summary.gone = await sweepGone(3); } catch (e: any) { summary.errors.push(`sweep: ${e.message}`); }

  if (opts.digest !== false) {
    try { summary.digest = await sendDigest({ siteUrl: opts.siteUrl }); } catch (e: any) { summary.digest = { error: e.message }; summary.errors.push(`digest: ${e.message}`); }
  }

  summary.finished = new Date().toISOString();
  await sql`UPDATE runs SET finished_at = now(), status = ${summary.errors.length ? 'partial' : 'ok'}, summary = ${JSON.stringify(summary)}::jsonb WHERE id = ${run.id}`;
  return summary;
}
