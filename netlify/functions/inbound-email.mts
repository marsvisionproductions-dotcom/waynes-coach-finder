// Inbound-parse webhook for saved-search alert emails (point Resend/Postmark/Cloudflare Email Routing here).
import type { Config } from '@netlify/functions';
import { collectFromEmail } from '../../src/collectors/email.mts';
import { ingest } from '../../src/lib/ingest.mts';
import { emailBody } from '../../src/collectors/email.mts';
import { db, initDb, getSetting } from '../../src/lib/db.mts';

export default async (req: Request) => {
  const url = new URL(req.url);
  const s = process.env.INGEST_SECRET;
  if (s && url.searchParams.get('secret') !== s && req.headers.get('x-ingest-secret') !== s) return new Response('unauthorized', { status: 401 });
  const payload = await req.json().catch(() => ({}));
  // 1. Is this a conversation about a coach we're working? (Wayne's BCC copy, or the seller's reply)
  const { from, subject, text } = emailBody(payload);
  const ref = subject.match(/\(ref (\d+)\)/i)?.[1];
  await initDb();
  const buyer = await getSetting<any>('buyer', {});
  const fromWayne = !!buyer.email && from.toLowerCase().includes(String(buyer.email).toLowerCase());
  let hit: any = ref ? (await db().sql`SELECT id, stage, contact_email FROM listings WHERE id = ${+ref}`)[0] : null;
  if (!hit) { const addr = (from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0].toLowerCase(); if (addr && !fromWayne) hit = (await db().sql`SELECT id, stage, contact_email FROM listings WHERE lower(contact_email) = ${addr} AND stage IN ('contacted','talking','new') ORDER BY updated_at DESC LIMIT 1`)[0]; }
  if (hit) {
    const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/On .{10,80} wrote:.*$/s, '').trim().slice(0, 600);
    if (fromWayne) {
      await db().sql`INSERT INTO events (listing_id, kind, body) VALUES (${hit.id}, 'contact', ${'Emailed: ' + subject.slice(0, 120)})`;
      if (hit.stage === 'new') await db().sql`UPDATE listings SET stage = 'contacted', updated_at = now() WHERE id = ${hit.id}`;
      if (['new','contacted'].includes(hit.stage)) await db().sql`UPDATE listings SET followup_on = COALESCE(followup_on, CURRENT_DATE + 3) WHERE id = ${hit.id}`;
    } else {
      await db().sql`INSERT INTO events (listing_id, kind, body) VALUES (${hit.id}, 'reply', ${'Seller replied: ' + snippet})`;
      if (['new','contacted'].includes(hit.stage)) await db().sql`UPDATE listings SET stage = 'talking', followup_on = CURRENT_DATE + 2, updated_at = now() WHERE id = ${hit.id}`;
    }
    return new Response(JSON.stringify({ ok: true, matched: hit.id, direction: fromWayne ? 'sent' : 'reply' }), { headers: { 'content-type': 'application/json' } });
  }
  // 2. Otherwise it's a saved-search alert email: pull listings out of it
  const { items, urls, errors } = await collectFromEmail(payload);
  const r = items.length ? await ingest(items) : null;
  console.log('inbound email', urls.length, 'urls →', r?.inserted ?? 0, 'new', errors);
  return new Response(JSON.stringify({ ok: true, urls: urls.length, inserted: r?.inserted ?? 0, updated: r?.updated ?? 0, errors }), { headers: { 'content-type': 'application/json' } });
};

export const config: Config = { path: '/api/inbound-email' };
