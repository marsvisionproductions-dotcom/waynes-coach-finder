// Facebook Marketplace via Apify's public-data actor, run on Apify's servers, logged out.
// Wayne's account is never involved. We start a run with a webhook; when it finishes, /api/apify-webhook pulls the dataset.
import type { RawListing } from '../lib/schema.mts';
import { allFbSearchUrls } from '../lib/metros.mts';

const ACTOR = process.env.APIFY_ACTOR_ID || 'apify~facebook-marketplace-scraper';
const API = 'https://api.apify.com/v2';

export function apifyToken(): string | undefined { return process.env.APIFY_TOKEN || undefined; }

export async function startFacebookRun(opts: { siteUrl: string; radiusMi?: number; minPrice?: number; daysSinceListed?: 1 | 7 | 30; maxUrls?: number }): Promise<{ runId: string; urls: number } | { skipped: string }> {
  const token = apifyToken();
  if (!token) return { skipped: 'APIFY_TOKEN not set' };
  let urls = allFbSearchUrls({ radiusMi: opts.radiusMi, minPrice: opts.minPrice, daysSinceListed: opts.daysSinceListed });
  if (opts.maxUrls) urls = urls.slice(0, opts.maxUrls);
  const input = {
    startUrls: urls.map(url => ({ url })),
    resultsLimit: 40,               // per start URL — newest-first, so 40 is plenty for a daily window
    includeListingDetails: true,    // description, coordinates, timestamps, seller
  };
  const webhooks = [{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl: `${opts.siteUrl}/api/apify-webhook?secret=${encodeURIComponent(process.env.INGEST_SECRET || '')}`,
  }];
  const q = new URLSearchParams({ token, webhooks: Buffer.from(JSON.stringify(webhooks)).toString('base64'), memory: '2048', timeout: '3600' });
  const r = await fetch(`${API}/acts/${ACTOR}/runs?${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  if (!r.ok) throw new Error(`Apify start failed ${r.status}: ${await r.text()}`);
  const j = await r.json() as any;
  return { runId: j.data.id, urls: urls.length };
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

/** Map an Apify FB Marketplace item (field names vary a little between actor versions) to our RawListing. */
export function mapApifyItem(it: any): RawListing | null {
  const url: string = it.listingUrl || it.url || it.link || (it.id ? `https://www.facebook.com/marketplace/item/${it.id}/` : '');
  const id = it.id || it.listingId || (url.match(/\/item\/(\d+)/)?.[1]) || url;
  if (!id) return null;
  const title = it.marketplace_listing_title || it.title || it.name || '';
  const desc = it.description || it.redacted_description?.text || it.listingDescription || '';
  const price = it.listing_price?.amount ?? it.price?.amount ?? it.price ?? it.formattedAmount ?? it.salePrice ?? null;
  const loc = it.location?.reverse_geocode?.city_page?.display_name || it.location?.text || it.locationText || it.location || (it.city ? `${it.city}${it.state ? ', ' + it.state : ''}` : '');
  const lat = it.location?.latitude ?? it.latitude ?? null, lng = it.location?.longitude ?? it.longitude ?? null;
  const photos: string[] = [];
  const pushPhoto = (u: any) => { if (typeof u === 'string' && u.startsWith('http')) photos.push(u); else if (u?.image?.uri) photos.push(u.image.uri); else if (u?.uri) photos.push(u.uri); else if (u?.url) photos.push(u.url); };
  (it.listing_photos || it.photos || it.images || []).forEach(pushPhoto);
  if (it.primary_listing_photo?.image?.uri) photos.unshift(it.primary_listing_photo.image.uri);
  if (it.primaryPhoto) pushPhoto(it.primaryPhoto);
  const posted = it.creation_time ? new Date(it.creation_time * (it.creation_time < 1e12 ? 1000 : 1)) : (it.listedAt || it.postedAt || it.createdAt || null);
  const sellerName = it.marketplace_listing_seller?.name || it.seller?.name || it.sellerName || null;
  const isDealer = it.is_dealership || it.seller?.isDealer || /dealer/i.test(it.seller?.type || '');
  return {
    source: 'fb', external_id: String(id), url, title, description: desc, price: typeof price === 'string' ? price : price, location: typeof loc === 'string' ? loc : undefined, lat, lng,
    posted_at: posted, seller_name: sellerName, seller_type: isDealer ? 'dealer' : 'private', // Marketplace private profiles are private owners; dealership pages are flagged
    contact_url: url, photos: [...new Set(photos)], raw: it,
  };
}
