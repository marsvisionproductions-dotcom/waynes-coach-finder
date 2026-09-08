// Enrichment: listings that arrived from a list page or a feed excerpt (no photo, no phone, no location) get one
// polite fetch of their own page on the open sites, and the blanks are filled. Runs a bounded batch per day.
import { db, initDb } from './db.mts';
import { extractFromHtml } from '../collectors/page.mts';
import { normalize } from './schema.mts';
import { fetchText } from './http.mts';
import { distanceFromHome } from './geo.mts';

const OPEN_SOURCES = ['prevoststuff', 'prevostrvforsale', 'newellgurus', 'foreforums', 'capture', 'rvusa'];

export async function enrichMissing(opts: { max?: number } = {}): Promise<{ tried: number; enriched: number; errors: string[] }> {
  await initDb();
  const sql = db().sql;
  const rows = await sql`
    SELECT l.id, l.title_raw, l.seller_type, l.seller_name, s.url, s.source FROM listings l
    JOIN LATERAL (SELECT url, source FROM listing_sources s WHERE s.listing_id = l.id AND s.source = ANY(${OPEN_SOURCES}) ORDER BY s.seen_at LIMIT 1) s ON true
    WHERE l.stage = 'new' AND l.seller_type <> 'dealer' AND (l.thumb_url IS NULL OR l.contact_phone IS NULL OR l.state IS NULL)
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.listing_id = l.id AND e.body = 'Details fetched from the listing page')
    ORDER BY l.score DESC NULLS LAST, l.id LIMIT ${opts.max ?? 40}`;
  const out = { tried: 0, enriched: 0, errors: [] as string[] };
  for (const r of rows) {
    out.tried++;
    try {
      const page = await fetchText(r.url);
      if (!page.ok) { out.errors.push(`${r.url} ${page.status}`); await mark(r.id, `Listing page returned ${page.status}`); continue; }
      const raw = extractFromHtml(r.url, page.text, { source: r.source, title: r.title_raw || undefined, seller_type: r.seller_type === 'private' ? 'private' : undefined, seller_name: r.seller_name });
      const n = normalize(raw);
      const dist = distanceFromHome(n.city, n.state);
      await sql`UPDATE listings SET
          thumb_url = COALESCE(thumb_url, ${n.thumb_url ?? null}),
          photos = CASE WHEN COALESCE(photo_count,0) < ${n.photo_count} THEN ${JSON.stringify(n.photos)}::jsonb ELSE photos END,
          photo_count = GREATEST(COALESCE(photo_count,0), ${n.photo_count}),
          contact_phone = COALESCE(contact_phone, ${n.contact_phone ?? null}), contact_email = COALESCE(contact_email, ${n.contact_email ?? null}),
          city = COALESCE(city, ${n.city ?? null}), state = COALESCE(state, ${n.state ?? null}), dist_mi = COALESCE(dist_mi, ${dist ?? null}),
          mileage = COALESCE(mileage, ${n.mileage ?? null}), slides = COALESCE(slides, ${n.slides ?? null}), price = COALESCE(price, ${n.price ?? null}),
          model = COALESCE(model, ${n.model ?? null}), shell_year = COALESCE(shell_year, ${n.shell_year ?? null}),
          description = CASE WHEN length(COALESCE(description,'')) < length(${n.description ?? ''}) THEN ${n.description ?? null} ELSE description END,
          posted_at = COALESCE(posted_at, ${n.posted_at ?? null}),
          seller_type = CASE WHEN seller_type = 'unknown' THEN ${n.seller_type} ELSE seller_type END,
          updated_at = now()
        WHERE id = ${r.id}`;
      await mark(r.id, 'Details fetched from the listing page');
      out.enriched++;
    } catch (e: any) { out.errors.push(`${r.url} ${e.message}`); }
  }
  return out;
}

async function mark(id: number, body: string) { await db().sql`INSERT INTO events (listing_id, kind, body) VALUES (${id}, 'system', ${body})`; }
