// Facebook Marketplace via Apify's public-data actor, run on Apify's servers, logged out.
// Wayne's account is never involved. We start a run with a webhook; when it finishes, /api/apify-webhook pulls the dataset.
import type { RawListing } from '../lib/schema.mts';
import { allFbSearchUrls } from '../lib/metros.mts';

const ACTOR = process.env.APIFY_ACTOR_ID || 'apify~facebook-marketplace-scraper';
const API = 'https://api.apify.com/v2';

export function apifyToken(): string | undefined { return process.env.APIFY_TOKEN || undefined; }

// Two-step to keep the bill down. Step 1 ("search"): every metro × query, NO detail pages — cheap, gives title/price/city/photo/url.
// Our ingest keeps only real coaches we haven't seen. Step 2 ("detail"): re-run ONLY the searches that produced new coaches,
// with detail pages on and a small limit, to fill description/photos/timestamp. Typical day: step 1 ≈ $1–2, step 2 ≈ cents.
export async function startFacebookRun(opts: { siteUrl: string; radiusMi?: number; minPrice?: number; daysSinceListed?: 1 | 7 | 30; maxUrls?: number; stage?: 'search' | 'detail'; urls?: string[] }): Promise<{ runId: string; urls: number; stage: string } | { skipped: string }> {
  const token = apifyToken();
  if (!token) return { skipped: 'APIFY_TOKEN not set' };
  const stage = opts.stage || 'search';
  let urls = opts.urls || allFbSearchUrls({ radiusMi: opts.radiusMi, minPrice: opts.minPrice, daysSinceListed: opts.daysSinceListed });
  if (opts.maxUrls) urls = urls.slice(0, opts.maxUrls);
  if (!urls.length) return { skipped: 'no urls' };
  const input = {
    startUrls: urls.map(url => ({ url })),
    resultsLimit: stage === 'search' ? +(process.env.APIFY_RESULTS_PER_URL || 15) : +(process.env.APIFY_DETAIL_PER_URL || 25),   // detail re-walks a search; FB's order shifts, so go deeper than the search pass
    includeListingDetails: stage === 'detail',
  };
  const webhooks = [{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'],
    requestUrl: `${opts.siteUrl}/api/apify-webhook?secret=${encodeURIComponent(process.env.INGEST_SECRET || '')}&stage=${stage}`,
  }];
  const q = new URLSearchParams({ token, webhooks: Buffer.from(JSON.stringify(webhooks)).toString('base64'), memory: '2048', timeout: '2400', maxTotalChargeUsd: String(stage === 'search' ? (process.env.APIFY_MAX_USD || '4') : '2') });
  const r = await fetch(`${API}/acts/${ACTOR}/runs?${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  if (!r.ok) throw new Error(`Apify start failed ${r.status}: ${await r.text()}`);
  const j = await r.json() as any;
  return { runId: j.data.id, urls: urls.length, stage };
}

export async function fetchDataset(datasetId: string): Promise<any[]> {
  const token = apifyToken(); if (!token) return [];
  const r = await fetch(`${API}/datasets/${datasetId}/items?token=${token}&clean=true&format=json`);
  if (!r.ok) throw new Error(`Apify dataset ${datasetId} ${r.status}`);
  return await r.json() as any[];
}

export async function fetchRun(runId: string): Promise<any> {
  const token = apifyToken(); if (!token) return null;
  const r = await fetch(`${API}/actor-runs/${runId}?token=${token}`);
  return r.ok ? (await r.json() as any).data : null;
}

// Deep helpers for the actor's nested objects (shapes vary a little between versions).
function deepFind(o: any, keys: string[], depth = 0): any {
  if (!o || typeof o !== 'object' || depth > 5) return undefined;
  for (const k of keys) if (o[k] != null && typeof o[k] !== 'object') return o[k];
  for (const v of Object.values(o)) { const r = deepFind(v, keys, depth + 1); if (r != null) return r; }
  return undefined;
}
function photoUri(p: any): string | undefined { if (!p) return; if (typeof p === 'string') return p; return p.image?.uri || p.uri || p.url || p.image?.url || deepFind(p, ['uri', 'url']); }

/** Map an Apify FB Marketplace item (apify/facebook-marketplace-scraper) to our RawListing.
 *  Verified field names: id, itemUrl, listingTitle, customTitle, description{text}, listingPrice{amount,formatted_amount,currency},
 *  location{reverse_geocode{city,state,city_page{display_name}}}, locationText{text}, listingPhotos[{image{uri}}], primaryListingPhoto{image{uri}},
 *  timestamp (ISO), isSold/isLive/isPending, listingAttributes, facebookUrl (the search URL it came from). No seller object in this actor. */
export function mapApifyItem(it: any): RawListing | null {
  const url: string = it.itemUrl || it.listingUrl || it.url || it.link || (it.id ? `https://www.facebook.com/marketplace/item/${it.id}/` : '');
  const id = it.id || it.listingId || (url.match(/\/item\/(\d+)/)?.[1]) || url;
  if (!id) return null;
  if (it.isSold === true) return null;
  const title = it.listingTitle || it.customTitle || it.marketplace_listing_title || it.title || it.name || '';
  const desc = typeof it.description === 'string' ? it.description : (it.description?.text || it.redacted_description?.text || it.listingDescription || '');
  const priceRaw = it.listingPrice ?? it.listing_price ?? it.price;
  const price = typeof priceRaw === 'object' && priceRaw ? (priceRaw.amount ?? priceRaw.formatted_amount ?? priceRaw.formattedAmount ?? null) : (priceRaw ?? null);
  const rg = it.location?.reverse_geocode || it.location?.reverseGeocode;
  const loc = it.locationText?.text || (typeof it.locationText === 'string' ? it.locationText : undefined) || rg?.city_page?.display_name || (rg?.city && rg?.state ? `${rg.city}, ${rg.state}` : undefined) || (typeof it.location === 'string' ? it.location : undefined) || it.location?.text;
  const lat = it.location?.latitude ?? it.latitude ?? null, lng = it.location?.longitude ?? it.longitude ?? null;
  const photos: string[] = [];
  const pp = photoUri(it.primaryListingPhoto || it.primary_listing_photo); if (pp) photos.push(pp);
  for (const p of (it.listingPhotos || it.listing_photos || it.photos || it.images || [])) { const u = photoUri(p); if (u) photos.push(u); }
  const ts = it.timestamp || it.listedAt || it.postedAt || it.createdAt || null;
  const posted = it.creation_time ? new Date(it.creation_time * (it.creation_time < 1e12 ? 1000 : 1)) : (ts ? new Date(ts) : (/daysSinceListed=1\b/.test(it.facebookUrl || '') ? new Date(Date.now() - 12 * 3600e3) : null));
  const sellerName = it.marketplace_listing_seller?.name || it.seller?.name || it.sellerName || null;
  const isDealer = it.is_dealership || it.seller?.isDealer || /dealer/i.test(it.seller?.type || '');
  return {
    source: 'fb', external_id: String(id), url, title, description: desc, price: typeof price === 'string' ? price : price, location: loc, lat, lng,
    posted_at: posted && !isNaN(posted.getTime()) ? posted : null, seller_name: sellerName,
    seller_type: isDealer ? 'dealer' : 'private', // Marketplace listings are personal-profile posts unless flagged as a dealership; the text still gets a say
    contact_url: url, photos: [...new Set(photos)], raw: { id, timestamp: ts, condition: it.condition, isLive: it.isLive, isPending: it.isPending, searchUrl: it.facebookUrl },
  };
}
