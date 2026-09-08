// RVTrader — the biggest private-seller inventory, and the strictest site: bot management on every page and
// a ToS that bans automated access. Two ways in, both keep Wayne's accounts out of it:
//  1. Alert emails: RVTrader's own saved-search emails carry title/price/location/link per coach. We parse the
//     email itself (no page fetch) — this path is always on. See inbound-email.mts.
//  2. Search pages through a vendor unlocker (Bright Data Web Unlocker, ScraperAPI, Zyte…): only if
//     SCRAPER_PROXY_URL is set. The vendor fetches logged-out on its own infrastructure. Off by default.
import { decodeEntities, stripTags } from '../lib/http.mts';
import type { RawListing } from '../lib/schema.mts';

export const RVTRADER_SEARCHES = [
  // make-filtered, private sellers, newest first. Verified in the browser before first run; adjust in settings if RVTrader changes params.
  'https://www.rvtrader.com/Prevost/rvs-for-sale?make=Prevost&sort=date%3Adesc&sellerType=private',
  'https://www.rvtrader.com/Newell/rvs-for-sale?make=Newell&sort=date%3Adesc&sellerType=private',
  'https://www.rvtrader.com/Foretravel/rvs-for-sale?make=Foretravel&sort=date%3Adesc&sellerType=private',
  'https://www.rvtrader.com/Tiffin/rvs-for-sale?make=Tiffin&model=Zephyr&sort=date%3Adesc&sellerType=private',
  'https://www.rvtrader.com/Newmar/rvs-for-sale?make=Newmar&model=King%20Aire&sort=date%3Adesc&sellerType=private',
  'https://www.rvtrader.com/Entegra/rvs-for-sale?make=Entegra&model=Cornerstone&sort=date%3Adesc&sellerType=private',
];

/** Parse RVTrader alert-email HTML/text: one listing per link; details from the text between this card's link and the next. */
export function parseRvtraderEmail(html: string): RawListing[] {
  const out: RawListing[] = [];
  const firstPos = new Map<string, { idx: number; url: string; slug: string }>();
  for (const m of html.matchAll(/https?:\/\/(?:www\.)?rvtrader\.com\/listing\/([^\s"'<>?#]+)/gi)) {
    const slug = decodeEntities(m[1]).replace(/\/+$/, '');
    const id = slug.match(/-(\d{6,})$/)?.[1] || slug.match(/(\d{6,})/)?.[1] || slug;
    if (!firstPos.has(id)) firstPos.set(id, { idx: m.index ?? 0, url: `https://www.rvtrader.com/listing/${slug}`, slug });
  }
  const cards = [...firstPos.entries()].sort((a, b) => a[1].idx - b[1].idx);
  cards.forEach(([id, c], i) => {
    const endIdx = i + 1 < cards.length ? cards[i + 1][1].idx : Math.min(html.length, c.idx + 3000);
    const chunk = stripTags(html.slice(c.idx, endIdx));
    const titleFromSlug = c.slug.replace(/-\d{6,}$/, '').replace(/-/g, ' ').trim();
    const price = chunk.match(/\$\s?[\d,]{5,}/)?.[0];
    const loc = chunk.match(/\b([A-Z][A-Za-z .]+,\s*[A-Z]{2})\b(?:\s+\d{5})?/)?.[1];
    const miles = chunk.match(/([\d,]{4,7})\s*(?:miles|mi\b)/i)?.[1];
    out.push({ source: 'rvtrader', external_id: id, url: c.url, title: /(19|20)\d{2}/.test(titleFromSlug) ? titleFromSlug : (chunk.split('\n').find(l => /(19|20)\d{2}/.test(l))?.trim() || titleFromSlug), description: chunk.slice(0, 800), price: price ?? null, location: loc, mileage: miles ? +miles.replace(/,/g, '') : undefined,
      seller_type: /private\s*seller/i.test(chunk) ? 'private' : /\bdealer\b/i.test(chunk) ? 'dealer' : 'unknown', contact_url: c.url, photos: [], raw: { via: 'rvtrader-email' } });
  });
  return out;
}

/** Parse an RVTrader search-results page (embedded JSON first, HTML cards as fallback). */
export function parseRvtraderSearch(html: string): RawListing[] {
  const out: RawListing[] = []; const seen = new Set<string>();
  // 1. Embedded state / JSON-LD
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const s = m[1]; if (!/"listings?"\s*:|"@type"\s*:\s*"(?:Product|ItemList)"/.test(s)) continue;
    try {
      const j = JSON.parse(s.trim().replace(/^window\.[A-Za-z_$][\w$]*\s*=\s*/, '').replace(/;$/, ''));
      const items: any[] = j?.itemListElement?.map((e: any) => e.item || e) || j?.listings || j?.results || j?.data?.listings || [];
      for (const it of items) {
        const url = it.url || it.link || (it.id ? `https://www.rvtrader.com/listing/${it.id}` : ''); const id = String(it.id || it.adId || url.match(/(\d{6,})/)?.[1] || url); if (!id || seen.has(id)) continue; seen.add(id);
        out.push({ source: 'rvtrader', external_id: id, url, title: it.name || it.title || [it.year, it.make, it.model].filter(Boolean).join(' '), description: it.description || '', price: it.offers?.price ?? it.price ?? null, location: it.location || [it.city, it.state].filter(Boolean).join(', '), mileage: it.mileage, photos: [it.image, ...(it.images || [])].filter(Boolean).map((x: any) => typeof x === 'string' ? x : x?.url).filter(Boolean),
          seller_type: /private/i.test(it.sellerType || it.seller?.type || '') ? 'private' : /dealer/i.test(it.sellerType || it.seller?.type || '') ? 'dealer' : 'unknown', seller_name: it.seller?.name || it.dealerName || null, contact_url: url, raw: { via: 'rvtrader-search-json' } });
      }
    } catch { /* not JSON */ }
  }
  if (out.length) return out;
  // 2. HTML cards
  for (const m of html.matchAll(/<a[^>]+href=["'](\/listing\/[^"']+?-(\d{6,})[^"']*)["'][^>]*>([\s\S]*?)<\/a>([\s\S]{0,1500})/gi)) {
    const id = m[2]; if (seen.has(id)) continue; seen.add(id);
    const url = 'https://www.rvtrader.com' + decodeEntities(m[1]).replace(/\?.*$/, '');
    const chunk = stripTags(m[3] + ' ' + m[4]);
    out.push({ source: 'rvtrader', external_id: id, url, title: (chunk.match(/((?:19|20)\d{2}\s+[A-Za-z][A-Za-z0-9 .\-]{3,60})/)?.[1] || '').trim(), description: chunk.slice(0, 600), price: chunk.match(/\$\s?[\d,]{5,}/)?.[0] ?? null,
      location: chunk.match(/\b([A-Z][A-Za-z .]+,\s*[A-Z]{2})\b/)?.[1], seller_type: /private\s*seller/i.test(chunk) ? 'private' : /\bdealer\b/i.test(chunk) ? 'dealer' : 'unknown', contact_url: url, photos: [], raw: { via: 'rvtrader-search-html' } });
  }
  return out;
}

export async function collectRvtrader(): Promise<{ items: RawListing[]; errors: string[]; skipped?: string }> {
  const proxy = process.env.SCRAPER_PROXY_URL; // e.g. https://api.scraperapi.com?api_key=…&url=  or a Bright Data unlocker endpoint
  if (!proxy) return { items: [], errors: [], skipped: 'SCRAPER_PROXY_URL not set — RVTrader comes in through alert emails only' };
  const items: RawListing[] = []; const errors: string[] = [];
  for (const target of RVTRADER_SEARCHES) {
    try {
      const u = proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(target)) : proxy + encodeURIComponent(target);
      const r = await fetch(u, { headers: { accept: 'text/html' } });
      if (!r.ok) { errors.push(`rvtrader ${r.status} ${target}`); continue; }
      const parsed = parseRvtraderSearch(await r.text());
      for (const p of parsed) items.push(p);
      await new Promise(res => setTimeout(res, 3000));
    } catch (e: any) { errors.push(`rvtrader ${e.message}`); }
  }
  return { items, errors };
}
