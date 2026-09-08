// Generic listing-page extractor: OpenGraph + JSON-LD + a few site-specific nudges.
// Used for the capture button, alert-email URLs, and sitemap hits. One page at a time, politely.
import { fetchText, stripTags, decodeEntities } from '../lib/http.mts';
import type { RawListing } from '../lib/schema.mts';

export function sourceFromUrl(url: string): string {
  const h = new URL(url).hostname.replace(/^www\./, '');
  if (/facebook\.com/.test(h)) return 'fb';
  if (/ebay\.com/.test(h)) return 'ebay';
  if (/rvtrader\.com/.test(h)) return 'rvtrader';
  if (/rvt\.com/.test(h)) return 'rvt';
  if (/craigslist\.org/.test(h)) return 'craigslist';
  if (/prevost-stuff\.com|2009prevost\.com/.test(h)) return 'prevoststuff';
  if (/prevostrvforsale\.com/.test(h)) return 'prevostrvforsale';
  if (/newellgurus\.com/.test(h)) return 'newellgurus';
  if (/foreforums\.com/.test(h)) return 'foreforums';
  if (/rvusa\.com/.test(h)) return 'rvusa';
  if (/rvuniverse\.com/.test(h)) return 'rvuniverse';
  if (/autotrader\.com/.test(h)) return 'autotrader';
  return h.split('.').slice(-2, -1)[0] || h;
}

function meta(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
  const m = html.match(re) || html.match(re2);
  return m ? decodeEntities(m[1]).trim() : undefined;
}

function jsonLd(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1].trim()); out.push(...(Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j])); } catch { /* ignore */ }
  }
  return out;
}

function absUrl(u: string, base: string): string { try { return new URL(u, base).href; } catch { return u; } }

export function extractFromHtml(url: string, html: string, hints: Partial<RawListing> = {}): RawListing {
  const source = hints.source || sourceFromUrl(url);
  const ld = jsonLd(html);
  const prod = ld.find(x => /Product|Vehicle|Car|Offer/i.test(String(x['@type'])));
  const offer = prod?.offers && (Array.isArray(prod.offers) ? prod.offers[0] : prod.offers);
  const title = hints.title || prod?.name || meta(html, 'og:title') || decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  const desc = hints.description || prod?.description || meta(html, 'og:description') || meta(html, 'description') || '';
  const price = hints.price ?? offer?.price ?? meta(html, 'product:price:amount') ?? (desc.match(/\$\s?[\d,]{5,}/)?.[0]) ?? (title.match(/\$\s?[\d,]{5,}/)?.[0]) ?? null;
  let images = [meta(html, 'og:image'), ...(Array.isArray(prod?.image) ? prod.image : prod?.image ? [prod.image] : [])].filter(Boolean) as string[];
  images = images.map(u => absUrl(u, url));
  // Plain-HTML sites (Prevost-Stuff, forums): take the page's own photos, skipping logos/icons/ads.
  if (images.length < 2) {
    const seenImg = new Set(images);
    for (const m of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+\.(?:jpe?g|webp|png)(?:\?[^"']*)?)["'][^>]*>/gi)) {
      const src = absUrl(decodeEntities(m[1]), url); const tag = m[0];
      if (/logo|icon|banner|button|spacer|pixel|avatar|badge|sprite|arrow|bullet|smilie|smiley|emoji|paypal|visa|facebook|twitter|doubleclick|\/ads?\//i.test(src + ' ' + tag)) continue;
      const w = +(tag.match(/\bwidth=["']?(\d+)/i)?.[1] || 0), h = +(tag.match(/\bheight=["']?(\d+)/i)?.[1] || 0);
      if ((w && w < 120) || (h && h < 90)) continue;
      if (!seenImg.has(src)) { seenImg.add(src); images.push(src); }
      if (images.length >= 16) break;
    }
  }
  // Body text for phone / mileage / slides / seller-type detection (trimmed so we don't store a whole site nav)
  const body = stripTags(html.replace(/<head[\s\S]*?<\/head>|<nav[\s\S]*?<\/nav>|<header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/gi, '')).slice(0, 6000);
  const locMeta = meta(html, 'og:locality') || meta(html, 'place:location') || undefined;
  const locFromText = body.match(/(?:^|\s)(?:Location|Located in|Located)\s*:?\s*([A-Za-z .]+,\s*[A-Z]{2})\b/)?.[1];
  const externalId = hints.external_id || (url.match(/(\d{6,})/)?.[1] ? `${source}:${url.match(/(\d{6,})/)![1]}` : url);
  const sellerType = hints.seller_type ?? (
    source === 'craigslist' ? (/\bby dealer\b/i.test(html) ? 'dealer' : 'private')
    : source === 'rvtrader' ? (/private\s*seller/i.test(html) ? 'private' : (/\bdealer\b/i.test(body) ? 'dealer' : 'unknown'))
    : source === 'rvt' ? (/private\s*(?:seller|listing)/i.test(html) ? 'private' : 'unknown')
    : undefined);
  return {
    source, external_id: externalId, url, title, description: desc + (desc.length < 400 ? '\n' + body.slice(0, 2500) : ''),
    price: typeof price === 'string' ? price : price, location: hints.location || locMeta || locFromText,
    posted_at: hints.posted_at ?? (prod?.datePosted || meta(html, 'article:published_time') || null),
    seller_name: hints.seller_name ?? (prod?.seller?.name || offer?.seller?.name || null),
    seller_type: sellerType, contact_url: url, photos: [...new Set(images)], raw: { extracted: true },
  };
}

export async function collectPage(url: string, hints: Partial<RawListing> = {}): Promise<RawListing | null> {
  const r = await fetchText(url);
  if (!r.ok) { console.warn('page fetch', url, r.status); return null; }
  return extractFromHtml(url, r.text, hints);
}
