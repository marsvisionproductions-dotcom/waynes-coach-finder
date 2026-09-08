// 6:00 am Eastern (10:00 UTC during DST, 11:00 UTC in winter — we run at 10:00 UTC year-round; that's 5 am in winter, fine).
// Scheduled functions get 30 seconds, so this only kicks the background worker.
import type { Config } from '@netlify/functions';

export default async (req: Request) => {
  const { next_run } = await req.json().catch(() => ({ next_run: null }));
  const site = process.env.URL || process.env.SITE_URL;
  if (!site) { console.error('URL env missing'); return; }
  const r = await fetch(`${site}/.netlify/functions/collect-background`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET || '' }, body: JSON.stringify({ trigger: 'schedule' }) });
  console.log('collect-scheduled → background', r.status, 'next run', next_run);
};

export const config: Config = { schedule: '0 10 * * *' };
