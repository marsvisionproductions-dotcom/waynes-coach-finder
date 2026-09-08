// Takes RawListing[] from any collector → dedupes → gates dealers out → scores → writes rows + events.
import { db, initDb, getSetting } from './db.mts';
import { normalize, isRelevant, type RawListing, type NormalizedListing } from './schema.mts';
import { score } from './score.mts';

export interface IngestResult { received: number; relevant: number; inserted: number; updated: number; dropped_dealer: number; dropped_irrelevant: number; ids: number[] }

export async function ingest(raws: RawListing[], opts: { allowDealers?: boolean } = {}): Promise<IngestResult> {
  const res: IngestResult = { received: raws.length, relevant: 0, inserted: 0, updated: 0, dropped_dealer: 0, dropped_irrelevant: 0, ids: [] };
  await initDb();
  const minPrice = await getSetting<number>('min_price', 100000);
  const sql = db().sql;

  for (const raw of raws) {
    let n: NormalizedListing;
    try { n = normalize(raw); } catch { res.dropped_irrelevant++; continue; }
    if (!isRelevant(n, minPrice)) { res.dropped_irrelevant++; continue; }
    res.relevant++;
    // Private sellers are the whole point. Dealers never enter the table.
    if (n.seller_type === 'dealer' && !opts.allowDealers) { res.dropped_dealer++; continue; }

    // 1. Already seen this exact source listing?
    const seen = await sql`SELECT listing_id FROM listing_sources WHERE source = ${n.source} AND external_id = ${n.external_id}`;
    let listingId: number | undefined = seen[0]?.listing_id;
    let isNew = false;

    // 2. Same coach from another source?
    if (!listingId) {
      const match = await sql`SELECT id FROM listings WHERE fingerprint = ${n.fingerprint} AND stage <> 'lost' ORDER BY id DESC LIMIT 1`;
      listingId = match[0]?.id;
    }

    const median = await comparableMedian(n);
    const s = score({ posted_at: n.posted_at ?? null, seller_type: n.seller_type, tier: n.tier, price: n.price ?? null, median_price: median, contact_phone: n.contact_phone, contact_email: n.contact_email, contact_url: n.contact_url, dist_mi: n.dist_mi ?? null });

    if (!listingId) {
      isNew = true;
      const [row] = await sql`
        INSERT INTO listings (fingerprint, make, model, converter, shell_year, conv_year, slides, mileage, price, city, state, dist_mi,
          seller_type, seller_name, contact_phone, contact_email, contact_url, thumb_url, photos, photo_count, title_raw, description, posted_at, score, score_breakdown)
        VALUES (${n.fingerprint}, ${n.make ?? null}, ${n.model ?? null}, ${n.converter ?? null}, ${n.shell_year ?? null}, ${n.conv_year ?? null}, ${n.slides ?? null}, ${n.mileage ?? null},
          ${n.price ?? null}, ${n.city ?? null}, ${n.state ?? null}, ${n.dist_mi ?? null}, ${n.seller_type}, ${n.seller_name ?? null}, ${n.contact_phone ?? null}, ${n.contact_email ?? null},
          ${n.contact_url ?? null}, ${n.thumb_url ?? null}, ${JSON.stringify(n.photos)}::jsonb, ${n.photo_count}, ${n.title_raw ?? null}, ${n.description ?? null}, ${n.posted_at ?? null},
          ${s.score}, ${JSON.stringify(s.breakdown)}::jsonb)
        ON CONFLICT (fingerprint) DO UPDATE SET last_seen_at = now(), updated_at = now()
        RETURNING id`;
      listingId = row.id;
      res.inserted++;
      await sql`INSERT INTO events (listing_id, kind, body) VALUES (${listingId}, 'system', ${`Posted on ${sourceName(n.source)}`})`;
      await sql`INSERT INTO events (listing_id, kind, body) VALUES (${listingId}, 'system', ${n.source === 'capture' ? 'Captured by hand' : 'Found by the run'})`;
    } else {
      // Fill blanks, never overwrite what a human may have edited; track price drops.
      const [cur] = await sql`SELECT price, contact_phone, contact_email, thumb_url, photo_count, description, posted_at FROM listings WHERE id = ${listingId}`;
      const priceDrop = cur.price != null && n.price != null && n.price < Number(cur.price) * 0.98;
      await sql`UPDATE listings SET
          last_seen_at = now(), updated_at = now(),
          price = COALESCE(${n.price ?? null}, price),
          contact_phone = COALESCE(contact_phone, ${n.contact_phone ?? null}),
          contact_email = COALESCE(contact_email, ${n.contact_email ?? null}),
          contact_url = COALESCE(contact_url, ${n.contact_url ?? null}),
          thumb_url = COALESCE(thumb_url, ${n.thumb_url ?? null}),
          photos = CASE WHEN photo_count IS NULL OR photo_count < ${n.photo_count} THEN ${JSON.stringify(n.photos)}::jsonb ELSE photos END,
          photo_count = GREATEST(COALESCE(photo_count,0), ${n.photo_count}),
          description = CASE WHEN description IS NULL OR length(description) < length(${n.description ?? ''}) THEN ${n.description ?? null} ELSE description END,
          posted_at = LEAST(COALESCE(posted_at, ${n.posted_at ?? null}), COALESCE(${n.posted_at ?? null}, posted_at)),
          mileage = COALESCE(mileage, ${n.mileage ?? null}), slides = COALESCE(slides, ${n.slides ?? null}),
          seller_name = COALESCE(seller_name, ${n.seller_name ?? null}),
          score = ${s.score}, score_breakdown = ${JSON.stringify(s.breakdown)}::jsonb,
          stage = CASE WHEN stage = 'lost' AND lost_reason = 'gone' THEN 'new' ELSE stage END,
          lost_reason = CASE WHEN stage = 'lost' AND lost_reason = 'gone' THEN NULL ELSE lost_reason END
        WHERE id = ${listingId}`;
      if (priceDrop) await sql`INSERT INTO events (listing_id, kind, body) VALUES (${listingId}, 'system', ${`Price dropped to $${Math.round(n.price!).toLocaleString('en-US')} on ${sourceName(n.source)}`})`;
      if (!seen.length) await sql`INSERT INTO events (listing_id, kind, body) VALUES (${listingId}, 'system', ${`Also seen on ${sourceName(n.source)}`})`;
      res.updated++;
    }

    await sql`INSERT INTO listing_sources (listing_id, source, external_id, url, source_posted_at, raw)
      VALUES (${listingId}, ${n.source}, ${n.external_id}, ${n.url}, ${n.posted_at ?? null}, ${JSON.stringify(n.raw ?? null)}::jsonb)
      ON CONFLICT (source, external_id) DO UPDATE SET last_seen_at = now(), url = EXCLUDED.url`;
    res.ids.push(listingId!);
  }
  return res;
}

async function comparableMedian(n: NormalizedListing): Promise<number | null> {
  if (!n.make) return null;
  const rows = await db().sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS med
    FROM listings WHERE make = ${n.make} AND price IS NOT NULL
      AND (${n.converter ?? null}::text IS NULL OR converter = ${n.converter ?? null})
      AND conv_year BETWEEN ${(n.conv_year ?? 2010) - 3} AND ${(n.conv_year ?? 2010) + 3}
      AND first_seen_at > now() - interval '90 days'`;
  const m = rows[0]?.med; return m == null ? null : Number(m);
}

/** Listings not seen on any source for N days drift to Lost (reason: gone). Returns count. */
export async function sweepGone(days = 3): Promise<number> {
  await initDb();
  const rows = await db().sql`
    UPDATE listings SET stage = 'lost', lost_reason = 'gone', updated_at = now()
    WHERE stage IN ('new') AND last_seen_at < now() - (${days} || ' days')::interval
      AND NOT EXISTS (SELECT 1 FROM listing_sources s WHERE s.listing_id = listings.id AND s.source IN ('capture','manual'))
    RETURNING id`;
  for (const r of rows) await db().sql`INSERT INTO events (listing_id, kind, body) VALUES (${r.id}, 'system', ${`Not seen on any source for ${days} days → moved to Lost`})`;
  return rows.length;
}

export function sourceName(s: string): string {
  return ({ fb: 'Facebook Marketplace', fbgroup: 'Facebook group', ebay: 'eBay Motors', rvt: 'RVT.com', rvtrader: 'RVTrader', prevoststuff: 'Prevost-Stuff', craigslist: 'Craigslist', newellgurus: 'NewellGurus', foreforums: 'ForeForums', prevostrvforsale: 'PrevostRVForSale', rvusa: 'RVUSA', capture: 'Capture', manual: 'Manual entry' } as Record<string, string>)[s] || s;
}
