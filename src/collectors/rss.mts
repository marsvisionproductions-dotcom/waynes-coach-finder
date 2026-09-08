// RSS/Atom feeds the niche sites publish on purpose. No login, no scraping — just subscribing.
import { fetchText, stripTags, decodeEntities } from '../lib/http.mts';
import type { RawListing } from '../lib/schema.mts';
import { collectPage } from './page.mts';

export interface FeedDef { source: string; url: string; seller_type?: 'private' | 'unknown'; fetchDetail?: boolean; }

export const FEEDS: FeedDef[] = [
  { source: 'prevostrvforsale', url: 'https://www.prevostrvforsale.com/feed/rss/', seller_type: 'private', fetchDetail: true },
  { source: 'newellgurus',      url: 'https://newellgurus.com/syndication.php?fid=27&limit=30', seller_type: 'private' },
  { source: 'foreforums',       url: 'https://www.foreforums.com/index.php?action=.xml;type=rss2;limit=30', seller_type: 'private' },
];

interface FeedItem { title: string; link: string; description: string; pubDate?: string; guid?: string; creator?: string }

export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const pick = (block: string, tag: string) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) return '';
    return decodeEntities(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).trim();
  };
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    let link = pick(b, 'link');
    if (!link) { const h = b.match(/<link[^>]+href=["']([^"']+)["']/i); if (h) link = decodeEntities(h[1]); }
    items.push({ title: pick(b, 'title'), link, description: pick(b, 'description') || pick(b, 'content:encoded') || pick(b, 'content') || pick(b, 'summary'), pubDate: pick(b, 'pubDate') || pick(b, 'published') || pick(b, 'updated') || pick(b, 'dc:date') || undefined, guid: pick(b, 'guid') || pick(b, 'id') || undefined, creator: stripTags(pick(b, 'dc:creator') || pick(b, 'author') || '').trim() || undefined });
  }
  return items;
}

export function feedItemToRaw(def: FeedDef, it: FeedItem): RawListing | null {
  if (!it.link) return null;
  const text = stripTags(it.description || '');
  // Skip forum threads that aren't sales ("Wanted", "Question about…")
  if (def.source !== 'prevostrvforsale' && !/\b(for sale|fs:|selling|asking|\$\s?\d)/i.test(it.title + ' ' + text)) return null;
  const img = (it.description || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  return {
    source: def.source, external_id: it.guid || it.link, url: it.link, title: it.title, description: text.slice(0, 3000),
    posted_at: it.pubDate ? new Date(it.pubDate) : null, seller_type: def.seller_type, seller_name: it.creator || null,
    photos: img ? [img] : [], contact_url: it.link, raw: { feed: def.url },
  };
}

export async function collectFeeds(defs: FeedDef[] = FEEDS): Promise<{ items: RawListing[]; errors: string[] }> {
  const items: RawListing[] = []; const errors: string[] = [];
  for (const def of defs) {
    try {
      const r = await fetchText(def.url);
      if (!r.ok) { errors.push(`${def.source} ${r.status}`); continue; }
      for (const it of parseFeed(r.text)) {
        const raw = feedItemToRaw(def, it); if (!raw) continue;
        if (def.fetchDetail) {
          // The feed only carries an excerpt; the page has price, photos, phone and the original (often Facebook) link.
          try { const page = await collectPage(raw.url, { source: def.source, seller_type: def.seller_type, external_id: raw.external_id, posted_at: raw.posted_at }); if (page) { page.title = raw.title || page.title; page.description = [raw.description, page.description].filter(Boolean).join('\n'); items.push(page); continue; } } catch { /* fall back to the feed item */ }
        }
        items.push(raw);
      }
    } catch (e: any) { errors.push(`${def.source} ${e.message}`); }
  }
  return { items, errors };
}
