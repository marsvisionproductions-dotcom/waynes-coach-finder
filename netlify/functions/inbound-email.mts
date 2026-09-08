// Inbound-parse webhook for saved-search alert emails (point Resend/Postmark/Cloudflare Email Routing here).
import type { Config } from '@netlify/functions';
import { collectFromEmail } from '../../src/collectors/email.mts';
import { ingest } from '../../src/lib/ingest.mts';

export default async (req: Request) => {
  const url = new URL(req.url);
  const s = process.env.INGEST_SECRET;
  if (s && url.searchParams.get('secret') !== s && req.headers.get('x-ingest-secret') !== s) return new Response('unauthorized', { status: 401 });
  const payload = await req.json().catch(() => ({}));
  const { items, urls, errors } = await collectFromEmail(payload);
  const r = items.length ? await ingest(items) : null;
  console.log('inbound email', urls.length, 'urls →', r?.inserted ?? 0, 'new', errors);
  return new Response(JSON.stringify({ ok: true, urls: urls.length, inserted: r?.inserted ?? 0, updated: r?.updated ?? 0, errors }), { headers: { 'content-type': 'application/json' } });
};

export const config: Config = { path: '/api/inbound-email' };
