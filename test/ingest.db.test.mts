process.env.COACH_DB = 'pglite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, db } from '../src/lib/db.mts';
import { ingest, sweepGone } from '../src/lib/ingest.mts';
import { buildDigest } from '../src/lib/digest.mts';
import api from '../netlify/functions/api.mts';

const call = (method: string, path: string, body?: unknown) => api(new Request('http://x' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), {} as any).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

test('migration runs and settings seeded', async () => {
  await initDb();
  const rows = await db().sql`SELECT key FROM settings ORDER BY key`;
  assert.deepEqual(rows.map((r: any) => r.key), ['buyer', 'fb_radius_mi', 'makes', 'min_price']);
});

test('ingest: dealer dropped, private kept, same coach across two sources merges', async () => {
  const r1 = await ingest([
    { source: 'fb', external_id: '100', url: 'https://www.facebook.com/marketplace/item/100/', title: '2008 Prevost H3-45 Marathon 2 slides', description: 'Selling our coach, 118,400 miles. Health reasons. Call 352-555-0147', price: '$389,000', location: 'Ocala, FL', posted_at: new Date(Date.now() - 20 * 3600e3).toISOString(), seller_name: 'Dale R.', seller_type: 'private', photos: ['https://p/1.jpg'] },
    { source: 'ebay', external_id: 'v1|555|0', url: 'https://www.ebay.com/itm/555', title: '2019 Newmar King Aire 4553', description: 'Stock #4471. Financing available, trade-ins welcome. Call our sales team.', price: 749900, city: 'Tampa', state: 'FL', seller_name: 'Bay Area RV Center' },
    { source: 'fb', external_id: '101', url: 'x', title: 'WANTED Prevost', description: 'looking for a coach' },
  ]);
  assert.equal(r1.inserted, 1); assert.equal(r1.dropped_dealer, 1); assert.equal(r1.dropped_irrelevant, 1);
  // same coach shows up on RVT with a slightly different price → merges, adds source, no new row
  const r2 = await ingest([{ source: 'rvt', external_id: 'RVT-1', url: 'https://www.rvt.com/x-1', title: '2008 Marathon H3-45 Prevost double slide', price: 395000, location: 'Ocala, Florida', seller_type: 'private' }]);
  assert.equal(r2.inserted, 0); assert.equal(r2.updated, 1);
  const [l] = await db().sql`SELECT * FROM listings`;
  assert.equal(l.make, 'Prevost'); assert.equal(l.converter, 'Marathon'); assert.equal(l.contact_phone, '(352) 555-0147'); assert.equal(l.seller_type, 'private'); assert.ok(l.score >= 80, 'score ' + l.score);
  const srcs = await db().sql`SELECT source FROM listing_sources WHERE listing_id = ${l.id} ORDER BY source`;
  assert.deepEqual(srcs.map((s: any) => s.source), ['fb', 'rvt']);
  const ev = await db().sql`SELECT body FROM events WHERE listing_id = ${l.id} ORDER BY id`;
  assert.ok(ev.some((e: any) => /Also seen on RVT/.test(e.body)));
  // re-ingesting the same fb id is idempotent
  const r3 = await ingest([{ source: 'fb', external_id: '100', url: 'https://www.facebook.com/marketplace/item/100/', title: '2008 Prevost H3-45 Marathon', price: 379000, location: 'Ocala, FL', seller_type: 'private' }]);
  assert.equal(r3.inserted, 0);
  const [{ n }] = await db().sql`SELECT count(*)::int AS n FROM listings`; assert.equal(n, 1);
  const drop = await db().sql`SELECT body FROM events WHERE listing_id = ${l.id} AND body LIKE 'Price dropped%'`; assert.equal(drop.length, 1);
});

test('api: stats, listings, stage moves, notes, follow-ups, corrections', async () => {
  let r = await call('GET', '/api/stats'); assert.equal(r.status, 200); assert.equal(r.json.counts.new, 1);
  r = await call('GET', '/api/listings?stage=new'); const id = r.json.listings[0].id; assert.equal(r.json.listings[0].sources.length, 2);
  r = await call('PATCH', `/api/listings/${id}`, { stage: 'contacted' }); assert.equal(r.json.listing.stage, 'contacted'); assert.ok(r.json.listing.followup_on);
  r = await call('POST', `/api/listings/${id}/notes`, { text: 'wife handles the sale' }); assert.equal(r.json.event.kind, 'note');
  r = await call('PATCH', `/api/listings/${id}`, { stage: 'talking', our_number: '$355,000' }); assert.equal(Number(r.json.listing.our_number), 355000);
  r = await call('PATCH', `/api/listings/${id}`, { mileage: 120000, city: 'Ocala', state: 'FL', favorite: true }); assert.equal(r.json.listing.mileage, 120000); assert.equal(r.json.listing.favorite, true);
  r = await call('PATCH', `/api/listings/${id}`, { stage: 'won' }); assert.equal(r.json.listing.stage, 'won'); assert.equal(r.json.listing.followup_on, null);
  r = await call('GET', `/api/listings/${id}`); assert.ok(r.json.events.some((e: any) => e.kind === 'stage' && /Won at \$355,000/.test(e.body)));
  r = await call('GET', '/api/stats'); assert.equal(r.json.counts.won, 1); assert.equal(r.json.counts.new, 0);
  r = await call('PATCH', `/api/listings/${id}`, { stage: 'nonsense' }); assert.equal(r.status, 400);
  r = await call('GET', '/api/listings?stage=bogus'); assert.equal(r.status, 400);
});

test('api: manual add, ingest endpoint, dealer never appears in any tab', async () => {
  let r = await call('POST', '/api/listings', { title: '2016 Newell 2020P 4 slides 48k', price: '$1,195,000', location: 'Charlotte, NC', seller_name: 'Frank D.', contact_phone: '704-555-0144' });
  assert.equal(r.json.inserted, 1);
  r = await call('POST', '/api/ingest', [{ source: 'agent', external_id: 'a1', url: 'https://example.com/a1', title: '2020 Entegra Cornerstone 45B', description: 'Downsizing, make offer. 22,700 miles', price: 599000, location: 'Jacksonville, FL' },
    { source: 'agent', external_id: 'a2', url: 'https://example.com/a2', title: '2014 Prevost H3-45 Liberty', description: 'Pre-owned inventory. Financing available. Nationwide delivery available. Warranty available.', price: 775000, location: 'Naples, FL', seller_name: 'Some RV Center LLC' }]);
  assert.equal(r.json.inserted, 1); assert.equal(r.json.dropped_dealer, 1);
  r = await call('GET', '/api/listings?stage=new'); assert.equal(r.json.listings.length, 2);
  assert.ok(r.json.listings.every((l: any) => l.seller_type !== 'dealer'));
  const [{ n }] = await db().sql`SELECT count(*)::int AS n FROM listings WHERE seller_type = 'dealer'`; assert.equal(n, 0);
});

test('digest + sweep', async () => {
  const d = await buildDigest('https://coach.test'); assert.equal(d.fresh, 2); assert.match(d.html, /Cornerstone/);
  await db().sql`UPDATE listings SET last_seen_at = now() - interval '5 days' WHERE stage = 'new' AND make = 'Entegra'`;
  const gone = await sweepGone(3); assert.equal(gone, 1);
  const r = await call('GET', '/api/listings?stage=lost'); assert.equal(r.json.listings[0].lost_reason, 'gone');
  // if it shows up again on a source it comes back to New
  await ingest([{ source: 'agent', external_id: 'a1', url: 'https://example.com/a1', title: '2020 Entegra Cornerstone 45B', price: 599000, location: 'Jacksonville, FL', seller_type: 'private' }]);
  const [back] = await db().sql`SELECT stage FROM listings WHERE make = 'Entegra'`; assert.equal(back.stage, 'new');
});
