// Morning digest via Resend. New private coaches ranked best-first, then follow-ups due.
import { db, initDb, getSetting } from './db.mts';

const money = (n: any) => n == null ? '' : '$' + Math.round(Number(n)).toLocaleString('en-US');
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export async function buildDigest(siteUrl: string) {
  await initDb();
  const sql = db().sql;
  const fresh = await sql`SELECT * FROM listings WHERE stage = 'new' AND seller_type <> 'dealer' AND first_seen_at > now() - interval '26 hours' ORDER BY score DESC NULLS LAST LIMIT 25`;
  const due = await sql`SELECT * FROM listings WHERE stage IN ('contacted','talking') AND followup_on IS NOT NULL AND followup_on <= CURRENT_DATE ORDER BY followup_on`;
  const buyer = await getSetting<any>('buyer', { name: 'Wayne' });
  const title = (x: any) => `${x.conv_year ?? ''} ${x.make ?? ''} ${x.model ?? ''}${x.converter && x.converter !== x.make ? ' · ' + x.converter : ''}`.replace(/\s+/g, ' ').trim();
  const row = (x: any) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #e6e9ee;vertical-align:top;width:96px">${x.thumb_url ? `<img src="${esc(x.thumb_url)}" width="88" height="66" style="object-fit:cover;border-radius:6px;display:block">` : ''}</td>
    <td style="padding:10px 8px;border-bottom:1px solid #e6e9ee;vertical-align:top;font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#17293A">
      <a href="${siteUrl}/#l=${x.id}" style="color:#17293A;font-weight:700;text-decoration:none">${esc(title(x))}</a><br>
      <span style="color:#475663">${x.mileage ? Number(x.mileage).toLocaleString() + ' mi · ' : ''}${x.slides != null ? x.slides + ' slides · ' : ''}${esc([x.city, x.state].filter(Boolean).join(', '))}${x.dist_mi ? ' · ' + x.dist_mi + ' mi away' : ''}</span><br>
      <span style="color:#7A8894;font-size:12px">${x.seller_type === 'private' ? 'Private owner' : x.seller_type === 'broker' ? 'Broker' : 'Seller type unknown'}${x.contact_phone ? ' · ☎ ' + esc(x.contact_phone) : ''}${x.followup_on ? ' · follow up ' + new Date(x.followup_on).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span></td>
    <td style="padding:10px 0;border-bottom:1px solid #e6e9ee;vertical-align:top;text-align:right;font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;font-weight:700;color:#17293A;white-space:nowrap">${money(x.price)}<br><span style="font-size:11px;color:#A97C2E;font-weight:600">SCORE ${x.score ?? ''}</span></td></tr>`;
  const html = `<div style="max-width:640px;margin:0 auto;padding:20px;background:#fff">
    <div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:20px;font-weight:700;color:#17293A">Coach Finder — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
    <div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;color:#7A8894;margin:4px 0 16px">${fresh.length} new private coach${fresh.length === 1 ? '' : 'es'} since yesterday · ${due.length} follow-up${due.length === 1 ? '' : 's'} due</div>
    ${due.length ? `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#B7791A;font-weight:600;margin:12px 0 4px">Follow up today</div><table width="100%" cellspacing="0" cellpadding="0">${due.map(row).join('')}</table>` : ''}
    <div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#A97C2E;font-weight:600;margin:16px 0 4px">New today</div>
    ${fresh.length ? `<table width="100%" cellspacing="0" cellpadding="0">${fresh.map(row).join('')}</table>` : `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#7A8894;padding:12px 0">Nothing new overnight.</div>`}
    <div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:12px;color:#7A8894;margin-top:20px"><a href="${siteUrl}" style="color:#A97C2E">Open Coach Finder</a></div></div>`;
  return { html, subject: `${fresh.length} new private coach${fresh.length === 1 ? '' : 'es'}${due.length ? ` · ${due.length} follow-up${due.length === 1 ? '' : 's'} due` : ''}`, fresh: fresh.length, due: due.length, to: buyer.email as string | undefined };
}

export async function sendDigest(opts: { siteUrl: string; to?: string; force?: boolean }) {
  const key = process.env.RESEND_API_KEY;
  const d = await buildDigest(opts.siteUrl);
  const to = opts.to || d.to || process.env.DIGEST_TO;
  if (!key) return { skipped: 'RESEND_API_KEY not set', ...d, html: undefined };
  if (!to) return { skipped: 'no recipient (set DIGEST_TO or the buyer email in settings)', fresh: d.fresh, due: d.due };
  if (!opts.force && d.fresh === 0 && d.due === 0) return { skipped: 'nothing to send', fresh: 0, due: 0 };
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.DIGEST_FROM || 'Coach Finder <onboarding@resend.dev>', to: [to], subject: d.subject, html: d.html }) });
  const j = await r.json().catch(() => ({}));
  return { sent: r.ok, to, fresh: d.fresh, due: d.due, id: (j as any).id, error: r.ok ? undefined : j };
}
