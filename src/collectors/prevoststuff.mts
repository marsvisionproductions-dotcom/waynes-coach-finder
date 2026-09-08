// Prevost-Stuff.com: open robots.txt, one dated list page. We fetch that one page a day and diff it.
// The URL of every coach page encodes the seller: 2002PrevostLibertyXLII_Johns061024.html → "Johns" (a private
// owner) vs _Goss / _TMS / _Marathon (dealers and converters). That suffix is the seller-type signal.
import { fetchText, stripTags, decodeEntities } from '../lib/http.mts';
import type { RawListing } from '../lib/schema.mts';
import type { SellerType } from '../lib/coaches.mts';

export const LIST_URL = 'https://prevost-stuff.com/used_coaches.htm';

// Dealers, converters and brokers that list on Prevost-Stuff (seen in the URL suffix). Extend as new ones appear.
const DEALER_TOKENS = /^(legacy|goss|tms|marathon|imperial|millennium|tradewinds|arizona|olympia|rvmax|featherlite|transwest|trawick|epic|epicsonora|midwest|owensbororv|superior|panterra|liberty|emerald|vantare|nashville|parliament|royale|staley|premier|creative|coachworks|luxury|motorhome|motorcoach|prevost|country|angola|newell|foretravel|buddygregg|chesaco|lamesa|campingworld|lazydays|generalrv|nirvc|pplmotor|ppl|dixie|northtrail|tmhex|coaches|picturepage)$/i;

export function sellerFromSlug(url: string): { seller_type: SellerType; seller_name?: string } {
  const m = url.match(/_([A-Za-z]+)[A-Za-z0-9]*\.html?$/);
  if (!m) return { seller_type: 'unknown' };
  const tok = m[1];
  if (DEALER_TOKENS.test(tok)) return { seller_type: 'dealer', seller_name: tok === 'TMS' ? 'The Motorcoach Store' : tok };
  // A single capitalised surname-looking token (Johns, Garrett, McIntyre, LeDoux) is a private owner.
  if (/^[A-Z][A-Za-z]{2,14}$/.test(tok) && !/rv|coach|motor|sales|auto/i.test(tok)) return { seller_type: 'private', seller_name: tok };
  return { seller_type: 'unknown', seller_name: tok };
}

/** "2002PrevostLibertyXLII_Johns061024.html" → "2002 Prevost Liberty XLII" */
export function titleFromSlug(url: string): string {
  const base = (url.split('/').pop() || '').replace(/\.html?$/, '').split('_')[0];
  return base.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/(\d{4})([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

export function parsePrevostStuff(html: string, base = LIST_URL): RawListing[] {
  const out: RawListing[] = [];
  const anchors: { idx: number; end: number; url: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]+href=["']([^"'#?]+\.html?)["'][^>]*>/gi)) {
    const href = decodeEntities(m[1]);
    if (!/^\d{4}Prevost/i.test(href.split('/').pop() || '')) continue;
    anchors.push({ idx: m.index ?? 0, end: (m.index ?? 0) + m[0].length, url: new URL(href, base).href });
  }
  const seen = new Set<string>();
  anchors.forEach((a, i) => {
    if (seen.has(a.url)) return; seen.add(a.url);
    // text belonging to this coach: from this anchor to the next *different* coach's anchor
    let j = i + 1; while (j < anchors.length && anchors[j].url === a.url) j++;
    const endIdx = j < anchors.length ? anchors[j].idx : Math.min(html.length, a.end + 2500);
    const chunk = stripTags(html.slice(a.idx, endIdx)).replace(/\s+/g, ' ').trim();
    const slugTitle = titleFromSlug(a.url);
    const lineTitle = chunk.match(/((?:19|20)\d{2}\s+Prevost\s+[A-Za-z0-9 .\-]{3,60}?)(?=\s*(?:\$|Price|New Listing|Just|Sold|Reduced|$))/i)?.[1]?.trim();
    const dateM = chunk.match(/(?:new listing|listed|added|price update|price reduced)\D{0,12}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    const posted = dateM ? new Date(dateM[1]) : null;
    if (/\bjust sold\b|\bsold\b/i.test(chunk.slice(0, 120))) return;   // sold banner sits right next to the link
    const { seller_type, seller_name } = sellerFromSlug(a.url);
    out.push({
      source: 'prevoststuff', external_id: a.url, url: a.url,
      title: lineTitle && lineTitle.length > slugTitle.length ? lineTitle : slugTitle,
      description: chunk.slice(0, 500),
      price: chunk.match(/\$\s?[\d,]{5,}/)?.[0] ?? null,
      posted_at: posted && !isNaN(posted.getTime()) ? posted : null,
      seller_type, seller_name, contact_url: a.url, photos: [], raw: { list: base, slug: a.url.split('/').pop() },
    });
  });
  return out;
}

export async function collectPrevostStuff(): Promise<{ items: RawListing[]; errors: string[] }> {
  try {
    const r = await fetchText(LIST_URL);
    if (!r.ok) return { items: [], errors: [`prevoststuff ${r.status}`] };
    return { items: parsePrevostStuff(r.text), errors: [] };
  } catch (e: any) { return { items: [], errors: [`prevoststuff ${e.message}`] }; }
}
