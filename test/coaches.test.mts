import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoach, detectSellerType, parseLocation, fingerprint, parseMoney } from '../src/lib/coaches.mts';
import { normalize, isRelevant } from '../src/lib/schema.mts';
import { score } from '../src/lib/score.mts';
import { distanceFromHome } from '../src/lib/geo.mts';

test('parses a messy Facebook title', () => {
  const p = parseCoach('06 Prevost XLII Marathon 2 slide 118k obo $389,000');
  assert.equal(p.make, 'Prevost'); assert.equal(p.model, 'XLII'); assert.equal(p.converter, 'Marathon');
  assert.equal(p.conv_year, 2006); assert.equal(p.slides, 2); assert.equal(p.mileage, 118000); assert.equal(p.price, 389000);
});

test('converter name implies Prevost', () => {
  const p = parseCoach('2008 Marathon H3-45 double slide, 118,400 miles, Series 60');
  assert.equal(p.make, 'Prevost'); assert.equal(p.converter, 'Marathon'); assert.equal(p.model, 'H3-45'); assert.equal(p.slides, 2); assert.equal(p.mileage, 118400);
});

test('factory coaches: Tiffin, Newmar, Entegra, Foretravel, Newell', () => {
  assert.deepEqual([parseCoach('2022 Tiffin Zephyr 45FZ quad slide').model, parseCoach('2022 Tiffin Zephyr 45FZ quad slide').slides], ['Zephyr', 4]);
  assert.equal(parseCoach('2019 Newmar King Aire 4553').model, 'King Aire');
  assert.equal(parseCoach('2020 Entegra Cornerstone 45B').converter, 'Entegra');
  assert.equal(parseCoach('2017 Foretravel IH-45 Luxury Villa').model, 'IH-45');
  const n = parseCoach('2015 Newell 2020P 4 slides 62k miles'); assert.equal(n.make, 'Newell'); assert.equal(n.model, '2020P'); assert.equal(n.mileage, 62000);
});

test('shell vs conversion year', () => {
  const p = parseCoach('2008 Liberty Elegant Lady H3-45, 2007 shell');
  assert.equal(p.conv_year, 2008); assert.equal(p.shell_year, 2007); assert.equal(p.converter, 'Liberty');
});

test('seller type detection', () => {
  assert.equal(detectSellerType({ title: '2008 Marathon H3-45', description: 'Selling our coach, health reasons. Always garaged.' }), 'private');
  assert.equal(detectSellerType({ title: '2008 Marathon H3-45', description: 'Stock #4471. Financing available, trade-ins welcome. Call our sales team.' }), 'dealer');
  assert.equal(detectSellerType({ sellerName: 'Bay Area RV Center', description: 'nice coach' }), 'dealer');
  assert.equal(detectSellerType({ sellerName: 'The Motorcoach Store' }), 'dealer');
  assert.equal(detectSellerType({ description: 'Listed by Motorhome Finders on behalf of the owner' }), 'broker');
  assert.equal(detectSellerType({ description: 'Nice coach, call me', sourceHint: 'private' }), 'private');
  assert.equal(detectSellerType({ description: 'Nice coach' }), 'unknown');
});

test('locations', () => {
  assert.deepEqual(parseLocation('Ocala, FL'), { city: 'Ocala', state: 'FL' });
  assert.deepEqual(parseLocation('Ocala, Florida'), { city: 'Ocala', state: 'FL' });
  assert.deepEqual(parseLocation('Nashville TN 37203'), { city: 'Nashville', state: 'TN' });
  assert.deepEqual(parseLocation('Texas'), { state: 'TX' });
  assert.ok(distanceFromHome('Ocala', 'FL')! > 80 && distanceFromHome('Ocala', 'FL')! < 130);
  assert.ok(distanceFromHome(undefined, 'AZ')! > 1500);
});

test('fingerprint collapses the same coach across sources', () => {
  const a = fingerprint({ make: 'Prevost', converter: 'Marathon', model: 'H3-45', conv_year: 2008, price: 389000, state: 'FL' });
  const b = fingerprint({ make: 'Prevost', converter: 'Marathon', model: 'H3-45', conv_year: 2008, price: 395000, state: 'fl' });
  const c = fingerprint({ make: 'Prevost', converter: 'Marathon', model: 'H3-45', conv_year: 2008, price: 450000, state: 'FL' });
  assert.equal(a, b); assert.notEqual(a, c);
});

test('money', () => { assert.equal(parseMoney('$389,000'), 389000); assert.equal(parseMoney('389k'), 389000); assert.equal(parseMoney('1.2M'), 1200000); assert.equal(parseMoney(''), undefined); });

test('normalize + relevance + dealer gate inputs', () => {
  const n = normalize({ source: 'fb', external_id: '1', url: 'https://www.facebook.com/marketplace/item/1/', title: '2012 Millennium X3-45 Prevost', description: 'Selling my coach. 84k miles, two slides. Call 941-555-0100', location: 'Sarasota, FL', price: '$565,000' });
  assert.equal(n.make, 'Prevost'); assert.equal(n.converter, 'Millennium'); assert.equal(n.contact_phone, '(941) 555-0100'); assert.equal(n.seller_type, 'private'); assert.equal(n.dist_mi! < 30, true);
  assert.ok(isRelevant(n, 100000));
  const toy = normalize({ source: 'fb', external_id: '2', url: 'x', title: 'WANTED: Prevost H3-45', description: 'looking for' });
  assert.equal(isRelevant(toy), false);
  const cheap = normalize({ source: 'fb', external_id: '3', url: 'x', title: '1995 Prevost XL Liberty', price: 45000 });
  assert.equal(isRelevant(cheap, 100000), false);
});

test('score favors fresh private coaches with a phone', () => {
  assert.equal(score({ seller_type: 'private', tier: 20, first_seen_at: new Date() }).breakdown.freshness, 15);
  const now = new Date('2026-09-08T12:00:00Z');
  const hot = score({ posted_at: new Date('2026-09-07T20:00:00Z'), seller_type: 'private', tier: 20, contact_phone: '(352) 555-0147', dist_mi: 96, now });
  const stale = score({ posted_at: new Date('2026-08-20T20:00:00Z'), seller_type: 'unknown', tier: 12, dist_mi: 2400, now });
  assert.ok(hot.score >= 85, String(hot.score)); assert.ok(stale.score < 40, String(stale.score)); assert.equal(hot.breakdown.freshness, 30);
});

test('title beats description for make; location found inside description', () => {
  const n = normalize({ source: 'rvt', external_id: 't1', url: 'x', title: '2022 Tiffin Zephyr 45FZ quad slide', description: 'Selling because we bought a Prevost. Located in Savannah, GA. 18,900 miles', price: 445000 });
  assert.equal(n.make, 'Tiffin'); assert.equal(n.model, 'Zephyr'); assert.equal(n.converter, 'Tiffin'); assert.equal(n.city, 'Savannah'); assert.equal(n.state, 'GA'); assert.equal(n.tier, 12);
  const f = normalize({ source: 'prevostrvforsale', external_id: 'f1', url: 'x', title: '2009 Featherlite Vantare H3-45 - $415,000', description: 'Located in Fort Myers, FL. 97,600 miles, 2 slides.' });
  assert.equal(f.make, 'Prevost'); assert.equal(f.converter, 'Featherlite'); assert.equal(f.city, 'Fort Myers'); assert.equal(f.mileage, 97600); assert.equal(f.price, 415000);
  const g = normalize({ source: 'fb', external_id: 'g1', url: 'x', title: 'Marathon coach', description: '2008 Prevost H3-45 Marathon conversion, Ocala FL 34470' });
  assert.equal(g.make, 'Prevost'); assert.equal(g.conv_year, 2008); assert.equal(g.city, 'Ocala');
});

test('area code fallback, contact-name capture, in-City-ST, market summary skipped', () => {
  const n = normalize({ source: 'prevoststuff', external_id: 'p', url: 'x', title: '2007 Prevost Liberty H3-45 Double Slide', description: 'The Coach Has Just Over 100k Miles On It. For Additional Information Please Contact :\nAnthony at 615-495-6843 or Email' });
  assert.equal(n.state, 'TN'); assert.equal(n.seller_name, 'Anthony'); assert.equal(n.contact_phone, '(615) 495-6843'); assert.equal(n.mileage, 100000); assert.ok(n.dist_mi! > 500);
  const f = normalize({ source: 'prevostrvforsale', external_id: 'f', url: 'x', title: '1998 Prevost Marathon XL Coach in Antioch, TN', description: 'Take a look…' });
  assert.equal(f.city, 'Antioch'); assert.equal(f.state, 'TN');
  const m = normalize({ source: 'prevostrvforsale', external_id: 'm', url: 'x', title: 'Market Summary for September 7th 2026', description: 'New listings increased from 17 to 25 this week, Prevost XL Coach in Antioch, TN' });
  assert.equal(isRelevant(m), false);
});

test('"In Durham, NC" is Durham', () => { assert.deepEqual(parseLocation('In Durham, NC'), { city: 'Durham', state: 'NC' }); });
