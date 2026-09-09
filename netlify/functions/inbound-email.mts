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
  let payload: any = await req.json().catch(() => ({}));
  // Resend Inbound sends only metadata ({type:'email.received', data:{email_id}}); fetch the body from their API.
  if (payload?.type === 'email.received' || payload?.data?.email_id) {
    const key = process.env.RESEND_API_KEY; const id = payload?.data?.email_id;
    if (!key || !id) return new Response(JSON.stringify({ ok: false, error: key ? 'no email_id' : 'RESEND_API_KEY not set' }), { status: 200, headers: { 'content-type': 'application/json' } });
    const r = await fetch(`https://api.resend.com/emails/receiving/${id}`, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) return new Response(JSON.stringify({ ok: false, error: `resend ${r.status}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    const m: any = await r.json();
    payload = { from: m.headers?.from || m.from, subject: m.subject, text: m.text || '', html: m.html || '', to: m.to, resend_id: id };
  }
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
  // 3. Nothing we recognised (a "confirm your saved search" email, a stray reply) → forward to a human so it isn't lost.
  let forwarded = false;
  if (!urls.length && process.env.RESEND_API_KEY && process.env.FORWARD_TO) {
    const fr = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.DIGEST_FROM || 'Coach Finder <onboarding@resend.dev>', to: [process.env.FORWARD_TO], reply_to: from || undefined,
        subject: `[Coach Finder inbox] ${subject || '(no subject)'}`, html: payload.html || `<pre>${text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</pre>` }) });
    forwarded = fr.ok;
  }
  return new Response(JSON.stringify({ ok: true, urls: urls.length, inserted: r?.inserted ?? 0, updated: r?.updated ?? 0, forwarded, errors }), { headers: { 'content-type': 'application/json' } });
};

export const config: Config = { path: '/api/inbound-email' };
