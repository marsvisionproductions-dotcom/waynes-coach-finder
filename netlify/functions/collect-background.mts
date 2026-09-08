// Background function: 15-minute budget. Runs every collector, then the digest.
import type { Context } from '@netlify/functions';
import { runAll } from '../../src/lib/run.mts';

export default async (req: Request, _ctx: Context) => {
  const s = process.env.INGEST_SECRET;
  if (s && req.headers.get('x-ingest-secret') !== s) { console.warn('collect-background: bad secret'); return; }
  const body = await req.json().catch(() => ({})) as any;
  const siteUrl = process.env.URL || process.env.SITE_URL || new URL(req.url).origin;
  const summary = await runAll({ trigger: body.trigger || 'manual', siteUrl, facebook: body.facebook, digest: body.digest, sources: body.sources });
  console.log('run summary', JSON.stringify(summary));
};
