import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrevostStuff, sellerFromSlug, titleFromSlug } from '../src/collectors/prevoststuff.mts';
import { normalize } from '../src/lib/schema.mts';

test('prevost-stuff: seller from URL suffix, title from slug, segmentation between anchors', () => {
  assert.deepEqual(sellerFromSlug('https://prevost-stuff.com/2002PrevostLibertyXLII_Johns061024.html'), { seller_type: 'private', seller_name: 'Johns' });
  assert.equal(sellerFromSlug('https://prevost-stuff.com/2014PrevostMarathonH_Goss1210051325.html').seller_type, 'dealer');
  assert.equal(sellerFromSlug('https://prevost-stuff.com/2020PrevostMillenniumX3_TMS2896061826.html').seller_name, 'The Motorcoach Store');
  assert.equal(sellerFromSlug('https://prevost-stuff.com/2013PrevostLibertyH_TMHEX5422A030724.html').seller_type, 'dealer');
  assert.equal(titleFromSlug('https://prevost-stuff.com/2002PrevostLibertyXLII_Johns061024.html'), '2002 Prevost Liberty XLII');
  assert.equal(titleFromSlug('https://prevost-stuff.com/2014PrevostMarathonH_Goss1210051325.html'), '2014 Prevost Marathon H');
  const html = `<table><tr><td><a href="2002PrevostLibertyXLII_Johns061024.html"><img src="a.jpg"></a></td><td><a href="2002PrevostLibertyXLII_Johns061024.html">2002 Prevost Liberty XLII Non Slide</a> Price Update $ 210,000 <b>New Listing 9/1/2026</b></td></tr>
  <tr><td><a href="2014PrevostMarathonH_Goss1210051325.html">2014 Prevost Marathon H3-45 Double Slide</a> $749,000</td></tr>
  <tr><td><a href="2023PrevostMarathonX3_Legacy1.html">2023 Prevost Marathon X3 Double Slide</a> Just Sold</td></tr></table>`;
  const items = parsePrevostStuff(html);
  assert.equal(items.length, 2);
  const a = normalize(items[0]); assert.equal(a.seller_type, 'private'); assert.equal(a.price, 210000); assert.equal(a.converter, 'Liberty'); assert.equal(a.model, 'XLII'); assert.equal(a.slides, 0); assert.equal(new Date(items[0].posted_at as Date).getDate(), 1);
  const b = normalize(items[1]); assert.equal(b.seller_type, 'dealer'); assert.equal(b.price, 749000); assert.equal(b.model, 'H3-45');
});
