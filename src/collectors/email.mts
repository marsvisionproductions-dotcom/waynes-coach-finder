// Saved-search alert emails (RVT Auto-Notify, RVTrader, Craigslist, Autotrader, RVUniverse) forwarded to an
// inbound-parse webhook. We pull the listing URLs out of the email and fetch only those pages — no crawling.
import { collectPage } from './page.mts';
import { parseRvtraderEmail } from './rvtrader.mts';
import { decodeEntities } from '../lib/http.mts';
import type { RawListing } from '../lib/schema.mts';

const LISTING_URL_RE = /https?:\/\/(?:www\.)?(?:rvt\.com\/[^\s"'<>]+|rvtrader\.com\/listing\/[^\s"'<>]+|[a-z]+\.craigslist\.org\/[^\s"'<>]+\/\d{8,}\.html|rvs\.autotrader\.com\/[^\s"'<>]*\d{5,}[^\s"'<>]*|rvuniverse\.com\/listing[^\s"'<>]+)/gi;

export function extractListingUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const m of decodeEntities(text).matchAll(LISTING_URL_RE)) {
    let u = m[0].replace(/[),.;]+$/, '');
    // strip tracking params
    try { const x = new URL(u); [...x.searchParams.keys()].forEach(k => { if (/^(utm_|mc_|ref|src|source|cid|eid)/i.test(k)) x.searchParams.delete(k); }); u = x.href; } catch { continue; }
    urls.add(u);
  }
  return [...urls];
}

/** Accepts Resend / Postmark / Cloudflare-style inbound JSON and returns the text to mine for URLs. */
export function emailBody(payload: any): { from: string; subject: string; text: string } {
  const from = payload.from?.address || payload.from || payload.From || payload.FromFull?.Email || '';
  const subject = payload.subject || payload.Subject || '';
  const text = [payload.text, payload.TextBody, payload.html, payload.HtmlBody, payload.body, payload.raw].filter(Boolean).join('\n');
  return { from: String(from), subject: String(subject), text: String(text) };
}

export async function collectFromEmail(payload: any, maxPages = 15): Promise<{ items: RawListing[]; urls: string[]; errors: string[] }> {
  const { from, subject, text } = emailBody(payload);
  const urls = extractListingUrls(text);
  const items: RawListing[] = []; const errors: string[] = [];
  // RVTrader blocks page fetches; its alert emails carry everything we need, so parse those in place.
  const fromRvtrader = parseRvtraderEmail(text);
  items.push(...fromRvtrader);
  const skip = new Set(fromRvtrader.map(i => i.url));
  for (const url of urls.filter(u => !/rvtrader\.com/i.test(u) || !skip.has(u.replace(/\?.*$/, ''))).filter(u => !/rvtrader\.com/i.test(u)).slice(0, maxPages)) {
    try { const raw = await collectPage(url, { raw: { via: 'email', from, subject } }); if (raw) items.push(raw); }
    catch (e: any) { errors.push(`${url} ${e.message}`); }
  }
  return { items, urls, errors };
}
