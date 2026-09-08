// eBay Motors via the official Browse API (free, 5,000 calls/day). Class A RVs category 50056.
import type { RawListing } from '../lib/schema.mts';

const MAKE_QUERIES = ['Prevost', 'Newell coach', 'Foretravel', 'Tiffin Zephyr', 'Newmar King Aire', 'Entegra Cornerstone'];
let tokenCache: { token: string; exp: number } | null = null;

async function appToken(): Promise<string | null> {
  const id = process.env.EBAY_CLIENT_ID, secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  if (!r.ok) throw new Error(`eBay token ${r.status}: ${await r.text()}`);
  const j = await r.json() as any;
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 7200) * 1000 };
  return tokenCache.token;
}

export async function collectEbay(opts: { sinceHours?: number; minPrice?: number } = {}): Promise<{ items: RawListing[]; skipped?: string }> {
  const token = await appToken();
  if (!token) return { items: [], skipped: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set' };
  const since = new Date(Date.now() - (opts.sinceHours ?? 36) * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const items: RawListing[] = [];
  for (const q of MAKE_QUERIES) {
    const filter = `buyingOptions:{FIXED_PRICE|AUCTION|BEST_OFFER|CLASSIFIED_AD},itemLocationCountry:US,itemStartDate:[${since}..],price:[${opts.minPrice ?? 100000}..],priceCurrency:USD`;
    const p = new URLSearchParams({ q, category_ids: '50056', filter, sort: 'newlyListed', limit: '50', fieldgroups: 'EXTENDED' });
    const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${p}`, { headers: { authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
    if (!r.ok) { console.warn('ebay search', q, r.status, await r.text()); continue; }
    const j = await r.json() as any;
    for (const it of j.itemSummaries || []) items.push(mapEbayItem(it));
  }
  return { items };
}

export function mapEbayItem(it: any): RawListing {
  const loc = it.itemLocation || {};
  const photos = [it.image?.imageUrl, ...(it.additionalImages || []).map((a: any) => a.imageUrl), ...(it.thumbnailImages || []).map((a: any) => a.imageUrl)].filter(Boolean);
  const business = it.seller?.sellerAccountType === 'BUSINESS';
  return {
    source: 'ebay', external_id: String(it.itemId), url: it.itemWebUrl, title: it.title, description: it.shortDescription || '',
    price: it.price?.value ? Number(it.price.value) : null,
    city: loc.city || undefined, state: loc.stateOrProvince || undefined, location: [loc.city, loc.stateOrProvince].filter(Boolean).join(', ') || undefined,
    posted_at: it.itemCreationDate || null,
    seller_name: it.seller?.username || null,
    seller_type: business ? 'dealer' : 'unknown',   // eBay doesn't tell us much; the text decides the rest
    contact_url: it.itemWebUrl, photos: [...new Set(photos)], raw: { itemId: it.itemId, buyingOptions: it.buyingOptions, seller: it.seller, condition: it.condition, itemEndDate: it.itemEndDate },
  };
}
