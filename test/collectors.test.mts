import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, feedItemToRaw, FEEDS } from '../src/collectors/rss.mts';
import { parseSitemap } from '../src/collectors/rvusa.mts';
import { parsePrevostStuff } from '../src/collectors/prevoststuff.mts';
import { extractFromHtml } from '../src/collectors/page.mts';
import { extractListingUrls } from '../src/collectors/email.mts';
import { mapApifyItem } from '../src/collectors/apify.mts';
import { mapEbayItem } from '../src/collectors/ebay.mts';
import { allFbSearchUrls, METROS, fbSearchUrl } from '../src/lib/metros.mts';
import { normalize } from '../src/lib/schema.mts';

test('rss feed parse', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title>2009 Featherlite Vantare H3-45 - $415,000</title><link>https://www.prevostrvforsale.com/listing/123</link><guid>123</guid><pubDate>Mon, 07 Sep 2026 14:00:00 GMT</pubDate><description><![CDATA[<img src="https://x/y.jpg"> Located in Fort Myers, FL. 97,600 miles, 2 slides. Owner selling. Call (239) 555-0171]]></description></item></channel></rss>`;
  const items = parseFeed(xml); assert.equal(items.length, 1);
  const raw = feedItemToRaw(FEEDS[0], items[0])!; const n = normalize(raw);
  assert.equal(n.make, 'Prevost'); assert.equal(n.converter, 'Featherlite'); assert.equal(n.price, 415000); assert.equal(n.city, 'Fort Myers'); assert.equal(n.contact_phone, '(239) 555-0171'); assert.equal(n.photos[0], 'https://x/y.jpg'); assert.equal(n.seller_type, 'private');
});

test('forum feed skips non-sale threads', () => {
  const xml = `<rss><channel><item><title>Question about Aqua-Hot</title><link>https://www.newellgurus.com/t/1</link><description>help</description></item><item><title>For Sale: 2016 Newell 2020P</title><link>https://www.newellgurus.com/t/2</link><description>Asking $1,195,000. 48k miles. Located in Charlotte, NC</description></item></channel></rss>`;
  const raws = parseFeed(xml).map(i => feedItemToRaw(FEEDS[1], i)).filter(Boolean);
  assert.equal(raws.length, 1); assert.equal(normalize(raws[0]!).make, 'Newell');
});

test('sitemap parse', () => {
  const xml = `<urlset><url><loc>https://www.rvusa.com/rvs-for-sale/2012-prevost-marathon-h3-45-class-a-4932587</loc><lastmod>2026-09-07</lastmod></url><url><loc>https://www.rvusa.com/rvs-for-sale/2019-jayco-1</loc></url></urlset>`;
  const e = parseSitemap(xml); assert.equal(e.length, 2); assert.equal(e[0].lastmod, '2026-09-07');
});

test('prevost-stuff list page', () => {
  const html = `<table><tr><td><a href="2008PrevostMarathonH_Johns090126.html">2008 Prevost Marathon H3-45 Double Slide</a> $389,000 <b>New Listing 9/1/2026</b></td></tr><tr><td><a href="about.htm">About us</a> we sell parts</td></tr></table>`;
  const items = parsePrevostStuff(html); assert.equal(items.length, 1); assert.equal(items[0].url, 'https://prevost-stuff.com/2008PrevostMarathonH_Johns090126.html'); assert.equal(new Date(items[0].posted_at as Date).getMonth(), 8);
  const n = normalize(items[0]); assert.equal(n.price, 389000); assert.equal(n.converter, 'Marathon'); assert.equal(n.seller_type, 'private');
});

test('generic page extraction (OG + JSON-LD)', () => {
  const html = `<html><head><title>2017 Foretravel IH-45 | RVT.com</title><meta property="og:title" content="2017 Foretravel IH-45 - $698,000"><meta property="og:image" content="https://img/1.jpg"><meta name="description" content="Private Seller. Luxury Villa, 41,300 miles, three slides."><script type="application/ld+json">{"@type":"Product","name":"2017 Foretravel IH-45","offers":{"@type":"Offer","price":"698000"}}</script></head><body><div>Location: Nacogdoches, TX</div><p>Call 936-555-0188</p></body></html>`;
  const raw = extractFromHtml('https://www.rvt.com/rv/2017-foretravel-ih-45-1234567', html);
  const n = normalize(raw);
  assert.equal(raw.source, 'rvt'); assert.equal(n.make, 'Foretravel'); assert.equal(n.price, 698000); assert.equal(n.city, 'Nacogdoches'); assert.equal(n.contact_phone, '(936) 555-0188'); assert.equal(n.seller_type, 'private'); assert.equal(n.photos[0], 'https://img/1.jpg');
});

test('email url extraction strips tracking', () => {
  const urls = extractListingUrls(`New matches! <a href="https://www.rvt.com/Prevost-H3-45-Marathon-2008-Ocala-FL-ID12345678?utm_source=alert&ref=x">view</a> and https://orlando.craigslist.org/rvs/d/ocala-2008-prevost/7712345678.html. Also https://www.google.com/x`);
  assert.equal(urls.length, 2); assert.ok(!urls[0].includes('utm_'));
});

test('apify item mapping tolerates field variants', () => {
  const a = mapApifyItem({ id: '987', marketplace_listing_title: '2011 Prevost H3-45 Liberty', listing_price: { amount: '650000' }, location: { reverse_geocode: { city_page: { display_name: 'Naples, FL' } }, latitude: 26.1, longitude: -81.8 }, primary_listing_photo: { image: { uri: 'https://p/1.jpg' } }, creation_time: 1788800000, marketplace_listing_seller: { name: 'Ann M.' }, redacted_description: { text: 'Selling my coach' } })!;
  assert.equal(a.source, 'fb'); assert.equal(a.external_id, '987'); assert.equal(a.price, '650000'); assert.equal(a.location, 'Naples, FL'); assert.equal(a.photos[0], 'https://p/1.jpg'); assert.equal(a.seller_type, 'private');
  const n = normalize(a); assert.equal(n.converter, 'Liberty'); assert.equal(n.city, 'Naples'); assert.equal(n.price, 650000);
  const b = mapApifyItem({ url: 'https://www.facebook.com/marketplace/item/555/', title: '2019 Newmar King Aire', price: '$729,000', locationText: 'Tampa, FL', photos: ['https://p/2.jpg'], seller: { name: 'Bay Area RV Center', isDealer: true } })!;
  assert.equal(b.external_id, '555'); assert.equal(normalize(b).seller_type, 'dealer');
});

test('ebay item mapping', () => {
  const r = mapEbayItem({ itemId: 'v1|123|0', title: '2015 Newell 2020P Quad Slide', price: { value: '1150000.00', currency: 'USD' }, itemWebUrl: 'https://www.ebay.com/itm/123', image: { imageUrl: 'https://i/1.jpg' }, itemLocation: { city: 'Nashville', stateOrProvince: 'TN', country: 'US' }, itemCreationDate: '2026-09-07T10:00:00.000Z', seller: { username: 'coachguy', sellerAccountType: 'INDIVIDUAL' }, buyingOptions: ['CLASSIFIED_AD'] });
  const n = normalize(r); assert.equal(n.make, 'Newell'); assert.equal(n.price, 1150000); assert.equal(n.state, 'TN'); assert.equal(n.seller_type, 'unknown');
});

test('facebook url set covers the country', () => {
  assert.ok(METROS.length >= 14);
  const u = fbSearchUrl(METROS[0], 'prevost', { radiusMi: 500, minPrice: 100000 });
  assert.match(u, /facebook\.com\/marketplace\/miami\/search\?/); assert.match(u, /sortBy=creation_time_descend/); assert.match(u, /daysSinceListed=1/); assert.match(u, /radius=500/);
  assert.equal(allFbSearchUrls().length, METROS.length * 10);
});

test('rvtrader alert email parses cards without fetching', async () => {
  const { parseRvtraderEmail, parseRvtraderSearch } = await import('../src/collectors/rvtrader.mts');
  const html = `<table><tr><td><a href="https://www.rvtrader.com/listing/2008-Prevost-H3-45-Marathon-5031234567?utm_source=alert"><img src="x"></a></td><td><a href="https://www.rvtrader.com/listing/2008-Prevost-H3-45-Marathon-5031234567?utm_source=alert">2008 Prevost H3-45 Marathon</a><br>$389,000<br>Ocala, FL 34470<br>Private Seller · 118,400 miles</td></tr>
  <tr><td><a href="https://www.rvtrader.com/listing/2016-Newell-2020P-5039876543">2016 Newell 2020P</a><br>$1,195,000<br>Charlotte, NC<br>Dealer</td></tr></table>`;
  const items = parseRvtraderEmail(html);
  assert.equal(items.length, 2);
  const n = normalize(items[0]);
  assert.equal(items[0].external_id, '5031234567'); assert.ok(!items[0].url.includes('utm_')); assert.equal(n.converter, 'Marathon'); assert.equal(n.price, 389000); assert.equal(n.city, 'Ocala'); assert.equal(n.seller_type, 'private'); assert.equal(n.mileage, 118400);
  assert.equal(normalize(items[1]).seller_type, 'dealer');
  const page = `<html><script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"item":{"@type":"Product","name":"2014 Prevost H3-45 Liberty","url":"https://www.rvtrader.com/listing/2014-Prevost-H3-45-Liberty-5031112222","offers":{"price":"775000"},"sellerType":"Private Seller"}}]}</script></html>`;
  const s = parseRvtraderSearch(page); assert.equal(s.length, 1); assert.equal(s[0].external_id, '5031112222'); assert.equal(s[0].seller_type, 'private');
});
