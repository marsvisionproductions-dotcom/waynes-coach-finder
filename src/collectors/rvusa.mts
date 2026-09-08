// RVUSA: robots allow everything and the inventory sitemaps carry per-listing <lastmod>.
// We read the sitemap, keep coach-like slugs changed in the last N days, and fetch just those pages.
import { fetchText } from '../lib/http.mts';
import { collectPage } from './page.mts';
import type { RawListing } from '../lib/schema.mts';

const INDEX = 'https://www.rvusa.com/sitemap_index.xml';
const SLUG_RE = /prevost|newell|foretravel|tiffin|zephyr|newmar|king-aire|entegra|cornerstone|marathon|liberty|millennium|featherlite/i;

export function parseSitemap(xml: string): { loc: string; lastmod?: string }[] {
  const out: { loc: string; lastmod?: string }[] = [];
  for (const m of xml.matchAll(/<(?:url|sitemap)>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/gi)) out.push({ loc: m[1].trim(), lastmod: m[2]?.trim() });
  return out;
}

export async function collectRvusa(opts: { days?: number; maxPages?: number } = {}): Promise<{ items: RawListing[]; errors: string[] }> {
  const errors: string[] = []; const items: RawListing[] = [];
  const cutoff = Date.now() - (opts.days ?? 2) * 864e5;
  try {
    const idx = await fetchText(INDEX);
    if (!idx.ok) return { items, errors: [`rvusa index ${idx.status}`] };
    const maps = parseSitemap(idx.text).map(s => s.loc).filter(u => /inventory/i.test(u));
    const candidates: string[] = [];
    for (const mapUrl of maps) {
      const sm = await fetchText(mapUrl);
      if (!sm.ok) { errors.push(`rvusa ${mapUrl} ${sm.status}`); continue; }
      for (const e of parseSitemap(sm.text)) {
        if (!SLUG_RE.test(e.loc)) continue;
        if (e.lastmod && new Date(e.lastmod).getTime() < cutoff) continue;
        candidates.push(e.loc);
      }
    }
    for (const url of candidates.slice(0, opts.maxPages ?? 25)) {
      const raw = await collectPage(url, { source: 'rvusa', seller_type: 'unknown' });
      if (raw) items.push(raw);
    }
  } catch (e: any) { errors.push(`rvusa ${e.message}`); }
  return { items, errors };
}
