// Prevost-Stuff.com: open robots.txt, one dated list page. We fetch that one page a day and diff it.
// Owner ads are mixed with converter/dealer ads; the seller-type detector and the dealer name list sort them.
import { fetchText, stripTags, decodeEntities } from '../lib/http.mts';
import type { RawListing } from '../lib/schema.mts';

export const LIST_URL = 'https://prevost-stuff.com/used_coaches.htm';

export function parsePrevostStuff(html: string, base = LIST_URL): RawListing[] {
  const out: RawListing[] = [];
  const seen = new Set<string>();
  // Each coach is an anchor to a detail page; the surrounding text carries year/converter/model, price, and "New Listing m/d/yyyy".
  for (const m of html.matchAll(/<a\b[^>]+href=["']([^"'#]+\.htm[l]?)["'][^>]*>([\s\S]*?)<\/a>([\s\S]{0,400})/gi)) {
    let href = decodeEntities(m[1]);
    if (/^(mailto:|javascript:)/i.test(href)) continue;
    const url = new URL(href, base).href;
    const label = stripTags(m[2]).replace(/\s+/g, ' ').trim();
    const tail = stripTags(m[3]).replace(/\s+/g, ' ');
    if (!/prevost|marathon|liberty|millennium|featherlite|vantare|emerald|royale|parliament|country coach|newell|angola|legacy|h3|xl|x3/i.test(label + ' ' + tail)) continue;
    if (!/(19|20)\d{2}/.test(label + ' ' + tail)) continue;
    if (seen.has(url)) continue; seen.add(url);
    const dateM = (label + ' ' + tail).match(/(?:new listing|listed|added|price (?:update|reduced))\D{0,12}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    const posted = dateM ? new Date(dateM[1]) : null;
    out.push({
      source: 'prevoststuff', external_id: url, url, title: label, description: tail.slice(0, 600),
      price: (label + ' ' + tail).match(/\$\s?[\d,]{5,}/)?.[0] ?? null,
      posted_at: posted && !isNaN(posted.getTime()) ? posted : null,
      seller_type: 'unknown', contact_url: url, photos: [], raw: { list: base },
    });
  }
  return out;
}

export async function collectPrevostStuff(): Promise<{ items: RawListing[]; errors: string[] }> {
  try {
    const r = await fetchText(LIST_URL);
    if (!r.ok) return { items: [], errors: [`prevoststuff ${r.status}`] };
    return { items: parsePrevostStuff(r.text), errors: [] };
  } catch (e: any) { return { items: [], errors: [`prevoststuff ${e.message}`] }; }
}
