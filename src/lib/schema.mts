// The one contract every collector speaks. Anything that can produce this JSON can feed the app:
// Apify, Bright Data, eBay, an RSS poller, the capture bookmarklet, or an agent you run yourself.
import { parseCoach, detectSellerType, fingerprint, parseLocation, parseMoney, type SellerType } from './coaches.mts';
import { distanceFromHome } from './geo.mts';
import { stateFromPhone } from './areacodes.mts';

export interface RawListing {
  source: string;               // fb | ebay | rvt | rvtrader | prevoststuff | craigslist | newellgurus | prevostrvforsale | rvusa | capture | manual
  external_id: string;          // stable id within the source (listing id, or the URL)
  url: string;
  title?: string;
  description?: string;
  price?: number | string | null;
  location?: string | null;     // "Ocala, FL"
  city?: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
  posted_at?: string | Date | null;
  seller_name?: string | null;
  seller_type?: SellerType;     // a hint from the source; text still gets a say
  contact_phone?: string | null;
  contact_email?: string | null;
  contact_url?: string | null;
  photos?: string[];
  thumb_url?: string | null;
  // optional pre-parsed fields (if the source knows them, they win)
  make?: string; model?: string; converter?: string; shell_year?: number; conv_year?: number; slides?: number; mileage?: number;
  raw?: unknown;
}

export interface NormalizedListing {
  source: string; external_id: string; url: string;
  fingerprint: string;
  make?: string; model?: string; converter?: string; shell_year?: number; conv_year?: number; slides?: number; mileage?: number;
  price?: number; city?: string; state?: string; dist_mi?: number;
  seller_type: SellerType; seller_name?: string; contact_phone?: string; contact_email?: string; contact_url?: string;
  thumb_url?: string; photos: string[]; photo_count: number;
  title_raw?: string; description?: string;
  posted_at?: Date; tier: number; raw?: unknown;
}

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function normalize(r: RawListing): NormalizedListing {
  const text = [r.title, r.description].filter(Boolean).join('\n');
  const hints = { make: r.make, model: r.model, converter: r.converter, shell_year: r.shell_year, conv_year: r.conv_year, slides: r.slides, mileage: r.mileage, price: parseMoney(r.price) };
  const fromTitle = r.title ? parseCoach(r.title, hints) : undefined;
  const parsed = parseCoach(text, { ...hints, make: hints.make ?? fromTitle?.make, model: hints.model ?? fromTitle?.model, converter: hints.converter ?? (fromTitle?.make ? fromTitle.converter : undefined), conv_year: hints.conv_year ?? fromTitle?.conv_year });
  const inCity = ((r.title || '') + '\n' + (r.description || '')).match(/\bin\s+([A-Z][A-Za-z .]{2,25}?),\s*([A-Z]{2})\b/)?.slice(1, 3).join(', ');
  const locText = r.location || inCity || (r.description || '').match(/(?:[Ll]ocated in|[Ll]ocation:?|[Nn]ear)\s+([A-Z][A-Za-z .]+?,\s*(?:[A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)?))\b/)?.[1] || (r.description || '').match(/\b([A-Z][A-Za-z .]{2,25},\s*[A-Z]{2})\b(?:\s+\d{5})?/)?.[1] || (r.title || '').match(/\b([A-Z][A-Za-z .]{2,25},\s*[A-Z]{2})\b/)?.[1] || (r.description || '').match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+([A-Z]{2})\s+\d{5}\b/)?.slice(1, 3).join(', ');
  const loc = { ...parseLocation(locText), ...(r.city ? { city: r.city } : {}), ...(r.state ? { state: r.state } : {}) };
  const seller_type = detectSellerType({ title: r.title, description: r.description, sellerName: r.seller_name || undefined, sourceHint: r.seller_type });
  const phone = r.contact_phone || (r.description && (r.description.match(PHONE_RE)?.[0])) || undefined;
  if (!loc.state && phone) loc.state = stateFromPhone(phone);   // area code as a last resort (state only)
  const contactName = !r.seller_name ? (r.description || '').match(/(?:contact|call|text)\s*:?\s*([A-Z][a-z]{2,15})(?:\s+(?:at|@)\s*\(?\d{3})/i)?.[1] : undefined;
  const email = r.contact_email || (r.description && (r.description.match(EMAIL_RE)?.[0])) || undefined;
  const photos = (r.photos || []).filter(Boolean);
  const posted = r.posted_at ? new Date(r.posted_at) : undefined;
  const n: NormalizedListing = {
    source: r.source, external_id: String(r.external_id), url: r.url,
    fingerprint: '',
    make: parsed.make, model: parsed.model, converter: parsed.converter, shell_year: parsed.shell_year, conv_year: parsed.conv_year, slides: parsed.slides, mileage: parsed.mileage,
    price: parsed.price, city: loc.city, state: loc.state,
    dist_mi: distanceFromHome(loc.city, loc.state, r.lat, r.lng),
    seller_type, seller_name: r.seller_name || contactName || undefined,
    contact_phone: phone ? formatPhone(phone) : undefined, contact_email: email || undefined, contact_url: r.contact_url || undefined,
    thumb_url: r.thumb_url || photos[0], photos, photo_count: photos.length,
    title_raw: r.title, description: r.description,
    posted_at: posted && !isNaN(posted.getTime()) ? posted : undefined,
    tier: parsed.tier, raw: r.raw,
  };
  n.fingerprint = fingerprint(n);
  return n;
}

export function formatPhone(p: string): string {
  const m = p.match(PHONE_RE); if (!m) return p.trim();
  return `(${m[1]}) ${m[2]}-${m[3]}`;
}

/** Does this look like a coach we care about at all? (make recognized, or a Prevost converter named) */
export function isRelevant(n: NormalizedListing, minPrice = 0): boolean {
  if (!n.make) return false;
  if (n.price != null && minPrice && n.price < minPrice) return false;
  // Toy haulers / parts / "wanted" ads
  if (/\b(wanted|looking for|iso\b|parts only|for parts|toy hauler|trailer|fifth wheel|5th wheel|tour bus|shell only|seats|bus conversion project|market summary|weekly roundup|newsletter|price guide|buyer'?s guide)\b/i.test(n.title_raw || '')) return false;
  if (!n.conv_year && !/\b(prevost|newell|foretravel|tiffin|newmar|entegra)\b/i.test(n.title_raw || '')) return false;
  return true;
}
