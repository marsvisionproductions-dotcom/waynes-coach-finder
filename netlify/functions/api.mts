import type { Config, Context } from '@netlify/functions';
import { db, initDb, getSetting, setSetting } from '../../src/lib/db.mts';
import { ingest } from '../../src/lib/ingest.mts';
import { collectPage } from '../../src/collectors/page.mts';
import { buildDigest, sendDigest } from '../../src/lib/digest.mts';
import type { RawListing } from '../../src/lib/schema.mts';
import { distanceFromHome } from '../../src/lib/geo.mts';

const STAGES = ['new', 'contacted', 'talking', 'won', 'lost'];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = (msg: string, status = 400) => json({ error: msg }, status);

function secretOk(req: Request, url: URL): boolean {
  const s = process.env.INGEST_SECRET; if (!s) return true; // no secret configured → open (dev)
  return req.headers.get('x-ingest-secret') === s || url.searchParams.get('secret') === s || (req.headers.get('authorization') || '') === `Bearer ${s}`;
}
function siteUrl(req: Request) { return process.env.URL || process.env.SITE_URL || new URL(req.url).origin; }

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  await initDb();
  const sql = db().sql;
  try {
    // ---- health / stats ----
    if (path === '/health') { const [r] = await sql`SELECT count(*)::int AS n FROM listings`; return json({ ok: true, listings: r.n, time: new Date().toISOString() }); }
    if (path === '/stats' && req.method === 'GET') {
      const brokers = url.searchParams.get('brokers') === '1';
      const counts = await sql`SELECT stage, count(*)::int AS n FROM listings WHERE seller_type <> 'dealer' AND (${brokers} OR seller_type <> 'broker') GROUP BY stage`;
      const [fresh] = await sql`SELECT count(*)::int AS n FROM listings WHERE stage = 'new' AND seller_type <> 'dealer' AND (${brokers} OR seller_type <> 'broker') AND first_seen_at > now() - interval '26 hours'`;
      const [due] = await sql`SELECT count(*)::int AS n FROM listings WHERE stage IN ('contacted','talking') AND followup_on IS NOT NULL AND followup_on <= CURRENT_DATE`;
      const dueBy = await sql`SELECT stage, count(*)::int AS n FROM listings WHERE stage IN ('contacted','talking') AND followup_on IS NOT NULL AND followup_on <= CURRENT_DATE GROUP BY stage`;
      const [lastRun] = await sql`SELECT id, started_at, finished_at, status, summary FROM runs ORDER BY id DESC LIMIT 1`;
      const [replies] = await sql`SELECT count(*)::int AS n FROM events WHERE kind = 'reply' AND at > now() - interval '3 days'`;
      const buyer = await getSetting('buyer', { name: 'Wayne' });
      const out = json({ counts: Object.fromEntries(STAGES.map(s => [s, counts.find((c: any) => c.stage === s)?.n ?? 0])), fresh: fresh.n, due: due.n, dueBy: Object.fromEntries(dueBy.map((d: any) => [d.stage, d.n])), lastRun: lastRun ?? null, buyer, replies: replies.n, capture_email: await getSetting('capture_email', '') });
      // The AIHQ portal card reads these counts cross-origin.
      const origin = req.headers.get('origin') || '';
      if (/^https:\/\/(?:[a-z0-9-]+\.)?ppitgaihq\.com$/.test(origin)) out.headers.set('access-control-allow-origin', origin);
      return out;
    }

    // ---- listings ----
    if (path === '/listings' && req.method === 'GET') {
      const stage = url.searchParams.get('stage') || 'new';
      if (!STAGES.includes(stage)) return bad('bad stage');
      const brokers = url.searchParams.get('brokers') === '1';
      const rows = await sql`
        SELECT l.*, (SELECT json_agg(json_build_object('source', s.source, 'url', s.url, 'seen_at', s.seen_at) ORDER BY s.seen_at) FROM listing_sources s WHERE s.listing_id = l.id) AS sources,
               (SELECT json_build_object('at', e.at, 'body', e.body, 'kind', e.kind) FROM events e WHERE e.listing_id = l.id AND e.kind <> 'system' ORDER BY e.at DESC LIMIT 1) AS last_event
        FROM listings l
        WHERE l.stage = ${stage} AND l.seller_type <> 'dealer' AND (${brokers} OR l.seller_type <> 'broker')
        ORDER BY l.favorite DESC, l.score DESC NULLS LAST, l.first_seen_at DESC LIMIT 300`;
      return json({ listings: rows });
    }
    let m = path.match(/^\/listings\/(\d+)$/);
    if (m && req.method === 'GET') {
      const id = +m[1];
      const [l] = await sql`SELECT * FROM listings WHERE id = ${id}`; if (!l) return bad('not found', 404);
      const sources = await sql`SELECT source, external_id, url, source_posted_at, seen_at, last_seen_at FROM listing_sources WHERE listing_id = ${id} ORDER BY seen_at`;
      const events = await sql`SELECT id, at, kind, body FROM events WHERE listing_id = ${id} ORDER BY at DESC, id DESC`;
      return json({ listing: l, sources, events });
    }
    if (m && req.method === 'PATCH') {
      const id = +m[1]; const body = await req.json().catch(() => ({})) as any;
      const [cur] = await sql`SELECT * FROM listings WHERE id = ${id}`; if (!cur) return bad('not found', 404);
      const events: string[] = [];
      let stage = cur.stage, lost_reason = cur.lost_reason, followup_on = cur.followup_on, our_number = cur.our_number, favorite = cur.favorite;
      if (body.stage !== undefined) {
        if (!STAGES.includes(body.stage)) return bad('bad stage');
        if (body.stage !== cur.stage) {
          stage = body.stage; lost_reason = stage === 'lost' ? (body.lost_reason || 'passed') : null;
          if (stage === 'lost' && lost_reason === 'dealer') await blockDealer(sql, cur, id);
          if (stage === 'contacted') followup_on = body.followup_on ?? cur.followup_on ?? null;   // Working is the triage list; the follow-up clock starts on the first text/call
          else if (stage === 'talking' && cur.stage === 'contacted') followup_on = body.followup_on ?? isoPlus(2);
          else if (['won', 'lost', 'new'].includes(stage)) followup_on = null;
          events.push(`stage:${labelOf(stage)}${stage === 'won' && (body.our_number ?? cur.our_number) ? ` at $${Math.round(Number(body.our_number ?? cur.our_number)).toLocaleString('en-US')}` : ''}`);
        }
      }
      if (body.followup_on !== undefined && body.stage === undefined) followup_on = body.followup_on || null;
      if (body.our_number !== undefined) { our_number = body.our_number == null || body.our_number === '' ? null : Number(String(body.our_number).replace(/[^0-9.]/g, '')); if (our_number !== cur.our_number && our_number != null) events.push(`system:Our number: $${Math.round(our_number).toLocaleString('en-US')}`); }
      if (body.favorite !== undefined) favorite = !!body.favorite;
      // Human corrections to the parsed fields
      const fields = ['make', 'model', 'converter', 'shell_year', 'conv_year', 'slides', 'mileage', 'price', 'city', 'state', 'seller_name', 'contact_phone', 'contact_email'] as const;
      const set: Record<string, any> = {};
      for (const f of fields) if (body[f] !== undefined) set[f] = body[f] === '' ? null : body[f];
      const newCity = set.city ?? cur.city, newState = set.state ?? cur.state;
      const dist = (set.city !== undefined || set.state !== undefined) ? (distanceFromHome(newCity, newState) ?? null) : cur.dist_mi;
      await sql`UPDATE listings SET stage = ${stage}, lost_reason = ${lost_reason}, followup_on = ${followup_on}, our_number = ${our_number}, favorite = ${favorite},
        make = ${set.make ?? cur.make}, model = ${set.model ?? cur.model}, converter = ${set.converter ?? cur.converter}, shell_year = ${set.shell_year ?? cur.shell_year}, conv_year = ${set.conv_year ?? cur.conv_year},
        slides = ${set.slides ?? cur.slides}, mileage = ${set.mileage ?? cur.mileage}, price = ${set.price ?? cur.price}, city = ${set.city ?? cur.city}, state = ${set.state ?? cur.state},
        seller_name = ${set.seller_name ?? cur.seller_name}, contact_phone = ${set.contact_phone ?? cur.contact_phone}, contact_email = ${set.contact_email ?? cur.contact_email},
        dist_mi = ${dist}, updated_at = now() WHERE id = ${id}`;
      for (const e of events) { const [kind, ...rest] = e.split(':'); await sql`INSERT INTO events (listing_id, kind, body) VALUES (${id}, ${kind}, ${rest.join(':')})`; }
      if (body.contact_event) { await sql`INSERT INTO events (listing_id, kind, body) VALUES (${id}, 'contact', ${String(body.contact_event).slice(0, 300)})`; if (stage === 'contacted' && !followup_on) { followup_on = isoPlus(3); await sql`UPDATE listings SET followup_on = ${followup_on} WHERE id = ${id}`; } }
      const [l] = await sql`SELECT * FROM listings WHERE id = ${id}`;
      return json({ listing: l });
    }
    m = path.match(/^\/listings\/(\d+)\/comps$/);
    if (m && req.method === 'GET') {
      // Price analysis from our own data: similar coaches we've seen (any stage), asking prices, 90-day trend. No outside calls, no tokens.
      const id = +m[1]; const [l] = await sql`SELECT * FROM listings WHERE id = ${id}`; if (!l) return bad('not found', 404);
      const yr = l.conv_year ?? l.shell_year ?? null;
      const find = (sameConverter: boolean) => sql`SELECT id, conv_year, make, model, converter, price, mileage, slides, city, state, stage, lost_reason, first_seen_at, posted_at, seller_type, thumb_url,
          (SELECT json_agg(json_build_object('source', s.source, 'url', s.url)) FROM listing_sources s WHERE s.listing_id = listings.id) AS sources
        FROM listings WHERE id <> ${id} AND price IS NOT NULL AND make = ${l.make}
          AND (${!sameConverter || !l.converter}::boolean OR converter = ${l.converter ?? null} OR converter = make)
          AND (${yr}::int IS NULL OR conv_year BETWEEN ${(yr ?? 0) - 3} AND ${(yr ?? 0) + 3})
        ORDER BY abs(COALESCE(conv_year, 0) - COALESCE(${yr}, 0)), first_seen_at DESC LIMIT 40`;
      // Same converter first (a Marathon is not a Featherlite); fall back to same make ±3 years while our history is thin.
      let comps = await find(true); let loose = false;
      if (comps.length < 3) { comps = await find(false); loose = true; }
      const prices = comps.map((c: any) => Number(c.price)).sort((a: number, b: number) => a - b);
      const med = (arr: number[]) => arr.length ? (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2) : null;
      const now = Date.now(), d30 = now - 30 * 864e5, d90 = now - 90 * 864e5;
      const recent = comps.filter((c: any) => new Date(c.first_seen_at).getTime() >= d30).map((c: any) => Number(c.price)).sort((a: number, b: number) => a - b);
      const older = comps.filter((c: any) => { const t = new Date(c.first_seen_at).getTime(); return t < d30 && t >= d90; }).map((c: any) => Number(c.price)).sort((a: number, b: number) => a - b);
      const sold = comps.filter((c: any) => c.stage === 'lost' && c.lost_reason === 'gone').length;
      return json({ listing: { id: l.id, price: l.price, conv_year: yr, make: l.make, converter: l.converter, model: l.model },
        count: comps.length, min: prices[0] ?? null, median: med(prices), max: prices[prices.length - 1] ?? null,
        recent_median: med(recent), older_median: med(older), recent_n: recent.length, older_n: older.length, gone_n: sold,
        position: l.price && med(prices) ? Math.round((Number(l.price) / med(prices)! - 1) * 100) : null,
        loose, comps: comps.slice(0, 12) });
    }
    m = path.match(/^\/listings\/(\d+)\/notes$/);
    if (m && req.method === 'POST') {
      const id = +m[1]; const body = await req.json().catch(() => ({})) as any;
      const text = String(body.text || '').trim().slice(0, 2000); if (!text) return bad('empty note');
      const [e] = await sql`INSERT INTO events (listing_id, kind, body) VALUES (${id}, 'note', ${text}) RETURNING id, at, kind, body`;
      return json({ event: e });
    }
    if (path === '/listings' && req.method === 'POST') {
      // Manual entry from the UI (Wayne types a coach in himself)
      const body = await req.json().catch(() => ({})) as RawListing;
      if (!body.url && !body.title) return bad('url or title required');
      const raw: RawListing = { source: 'manual', external_id: body.url || `manual:${Date.now()}`, url: body.url || '', ...body, seller_type: body.seller_type || 'private' };
      const r = await ingest([raw], { allowDealers: false });
      return json(r);
    }

    // ---- ingest / capture / run (secret-protected) ----
    if (path === '/ingest' && req.method === 'POST') {
      if (!secretOk(req, url)) return bad('unauthorized', 401);
      const body = await req.json().catch(() => null) as any;
      const items: RawListing[] = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : Array.isArray(body?.listings) ? body.listings : null;
      if (!items) return bad('expected a JSON array of listings (or {items:[...]})');
      return json(await ingest(items));
    }
    if (path === '/capture' && (req.method === 'POST' || req.method === 'GET')) {
      const body = req.method === 'POST' ? (await req.json().catch(() => ({})) as any) : Object.fromEntries(url.searchParams.entries());
      const target = body.url || url.searchParams.get('url');
      if (!target || !/^https?:\/\//.test(target)) return bad('url required');
      const raw = await collectPage(target, { source: body.source, title: body.title, description: body.description, price: body.price, location: body.location, seller_name: body.seller_name, seller_type: 'private', photos: body.photos });
      if (!raw) return bad('could not read that page (it may require login — paste the details instead)', 422);
      raw.source = 'capture'; raw.raw = { ...(raw.raw as object || {}), captured_from: target, original_source: body.source };
      const r = await ingest([raw], { allowDealers: true }); // Wayne captured it on purpose
      if (req.method === 'GET') return new Response(null, { status: 302, headers: { location: `${siteUrl(req)}/#l=${r.ids[0] ?? ''}` } });
      return json(r);
    }
    if (path === '/run' && req.method === 'POST') {
      const body = await req.json().catch(() => ({})) as any;
      if (!secretOk(req, url)) {
        // The UI's "Run now" has no secret; allow it, but not more than once every 30 minutes.
        const [recent] = await sql`SELECT count(*)::int AS n FROM runs WHERE trigger = 'manual' AND started_at > now() - interval '30 minutes'`;
        if (recent.n > 0) return bad('A run already started in the last 30 minutes. Give it a few minutes.', 429);
      }
      // hand off to the background function (15-minute budget)
      const r = await fetch(`${siteUrl(req)}/.netlify/functions/collect-background`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET || '' }, body: JSON.stringify({ trigger: 'manual', ...body }) });
      return json({ started: r.status === 202, status: r.status });
    }
    if (path === '/admin/reset-source' && req.method === 'POST') {
      // Remove untouched New rows that came only from one source (used after fixing a parser), then re-run that source.
      if (!secretOk(req, url)) return bad('unauthorized', 401);
      const source = url.searchParams.get('source'); if (!source) return bad('source required');
      const rows = await sql`DELETE FROM listings l WHERE l.stage = 'new' AND l.favorite = false
        AND NOT EXISTS (SELECT 1 FROM events e WHERE e.listing_id = l.id AND e.kind <> 'system')
        AND NOT EXISTS (SELECT 1 FROM listing_sources s WHERE s.listing_id = l.id AND s.source <> ${source})
        AND EXISTS (SELECT 1 FROM listing_sources s WHERE s.listing_id = l.id AND s.source = ${source}) RETURNING l.id`;
      return json({ deleted: rows.length });
    }
    if (path === '/admin/enrich' && req.method === 'POST') { if (!secretOk(req, url)) return bad('unauthorized', 401); const { enrichMissing } = await import('../../src/lib/enrich.mts'); return json(await enrichMissing({ max: +(url.searchParams.get('max') || 25), force: url.searchParams.get('force') === '1' })); }
    if (path === '/admin/rescore' && req.method === 'POST') {
      if (!secretOk(req, url)) return bad('unauthorized', 401);
      const { score } = await import('../../src/lib/score.mts');
      const { parseCoach } = await import('../../src/lib/coaches.mts');
      const rows = await sql`SELECT id, posted_at, first_seen_at, seller_type, price, contact_phone, contact_email, contact_url, dist_mi, title_raw, make, converter FROM listings WHERE stage = 'new'`;
      for (const r of rows) { const tier = parseCoach([r.title_raw, r.make, r.converter].filter(Boolean).join(' '), { make: r.make, converter: r.converter }).tier; const s = score({ posted_at: r.posted_at, first_seen_at: r.first_seen_at, seller_type: r.seller_type, tier, price: r.price, contact_phone: r.contact_phone, contact_email: r.contact_email, contact_url: r.contact_url, dist_mi: r.dist_mi }); await sql`UPDATE listings SET score = ${s.score}, score_breakdown = ${JSON.stringify(s.breakdown)}::jsonb WHERE id = ${r.id}`; }
      return json({ rescored: rows.length });
    }
    if (path === '/runs' && req.method === 'GET') { const rows = await sql`SELECT id, started_at, finished_at, trigger, status, summary FROM runs ORDER BY id DESC LIMIT 20`; return json({ runs: rows }); }
    if (path === '/digest' && req.method === 'GET') { const d = await buildDigest(siteUrl(req)); return new Response(d.html, { headers: { 'content-type': 'text/html; charset=utf-8' } }); }
    if (path === '/digest' && req.method === 'POST') { if (!secretOk(req, url)) return bad('unauthorized', 401); return json(await sendDigest({ siteUrl: siteUrl(req), force: true })); }

    // ---- settings ----
    if (path === '/settings' && req.method === 'GET') { const rows = await sql`SELECT key, value FROM settings`; return json(Object.fromEntries(rows.map((r: any) => [r.key, r.value]))); }
    if (path === '/settings' && req.method === 'PATCH') { const body = await req.json().catch(() => ({})) as Record<string, unknown>; for (const [k, v] of Object.entries(body)) if (/^[a-z_]+$/.test(k)) await setSetting(k, v); return json({ ok: true }); }

    return bad('not found', 404);
  } catch (e: any) {
    console.error(e);
    return json({ error: e.message || String(e) }, 500);
  }
};

async function blockDealer(sql: any, cur: any, id: number) {
  const digits = (cur.contact_phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const name = (cur.seller_name || '').trim().toLowerCase();
  if (!digits && !name) return;
  await sql`INSERT INTO dealers (phone, name, note) VALUES (${digits || null}, ${name || null}, ${'flagged from listing ' + id})`;
  // Same phone/name elsewhere in New or Working → out too
  const sib = await sql`UPDATE listings SET stage = 'lost', lost_reason = 'dealer', seller_type = 'dealer', updated_at = now()
    WHERE id <> ${id} AND stage IN ('new','contacted') AND ((${digits} <> '' AND regexp_replace(COALESCE(contact_phone,''), '\\D', '', 'g') = ${digits}) OR (${name} <> '' AND lower(COALESCE(seller_name,'')) = ${name})) RETURNING id`;
  for (const s of sib) await sql`INSERT INTO events (listing_id, kind, body) VALUES (${s.id}, 'system', ${'Same seller as a coach Wayne marked as a dealer → Lost'})`;
  await sql`UPDATE listings SET seller_type = 'dealer' WHERE id = ${id}`;
}
function isoPlus(days: number) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function labelOf(s: string) { return ({ new: 'New', contacted: 'Working', talking: 'Talking', won: 'Won', lost: 'Lost' } as Record<string, string>)[s] || s; }

export const config: Config = { path: '/api/*', excludedPath: ['/api/apify-webhook', '/api/inbound-email'] };
