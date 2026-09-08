// Coach knowledge: makes, converters, models, and how to read a messy listing title.
// Everything here is pure (no I/O) so it can be unit-tested.

export type SellerType = 'private' | 'broker' | 'dealer' | 'unknown';

export interface ParsedCoach {
  make?: string;
  model?: string;
  converter?: string;
  shell_year?: number;
  conv_year?: number;
  slides?: number;
  mileage?: number;
  price?: number;
  tier: number;          // 0–20, used by the score
}

interface MakeDef {
  name: string;
  aliases: RegExp;
  tier: number;
  models: { name: string; re: RegExp }[];
}

// Converters that build on Prevost shells. Order matters only for display.
export const PREVOST_CONVERTERS: { name: string; re: RegExp; tier: number }[] = [
  { name: 'Marathon',    re: /\bmarathon\b/i,               tier: 20 },
  { name: 'Liberty',     re: /\bliberty\b|elegant lady/i,   tier: 20 },
  { name: 'Millennium',  re: /\bmillenn?ium\b/i,            tier: 20 },
  { name: 'Featherlite', re: /\bfeatherlite\b|\bvantare\b/i, tier: 19 },
  { name: 'Emerald',     re: /\bemerald\b/i,                tier: 17 },
  { name: 'Country Coach', re: /\bcountry coach\b/i,        tier: 16 },
  { name: 'Newell',      re: /\bnewell\b/i,                 tier: 18 },
  { name: 'Parliament',  re: /\bparliament\b/i,             tier: 16 },
  { name: 'Royale',      re: /\broyale\b/i,                 tier: 16 },
  { name: 'Angola',      re: /\bangola\b/i,                 tier: 15 },
  { name: 'Legacy',      re: /\blegacy coach\b/i,           tier: 16 },
  { name: 'Epic',        re: /\bepic\b/i,                   tier: 15 },
  { name: 'Executive',   re: /\bexecutive coach\b/i,        tier: 14 },
  { name: 'Nashville',   re: /\bnashville coach\b/i,        tier: 15 },
  { name: 'Emerald',     re: /\bemerald luxury\b/i,         tier: 17 },
];

export const MAKES: MakeDef[] = [
  { name: 'Prevost', aliases: /\bprevost\b|\bprévost\b/i, tier: 18, models: [
    { name: 'H3-45',  re: /\bh\s?3[\s-]?45\b|\bh3\b/i },
    { name: 'X3-45',  re: /\bx\s?3[\s-]?45\b|\bx3\b/i },
    { name: 'XLII',   re: /\bxl\s?ii\b|\bxl2\b|\bxl-ii\b/i },
    { name: 'XL',     re: /\bxl\b(?!\s?ii)/i },
    { name: 'H3-41',  re: /\bh\s?3[\s-]?41\b/i },
    { name: 'Le Mirage', re: /\ble\s?mirage\b/i },
  ]},
  { name: 'Newell', aliases: /\bnewell\b/i, tier: 18, models: [
    { name: '2020P', re: /\b2020\s?p\b/i },
    { name: '2022',  re: /\bnewell\s+(?:coach\s+)?2022\b/i },
    { name: '2000',  re: /\bnewell\s+(?:coach\s+)?2000\b/i },
    { name: 'P50',   re: /\bp\s?50\b/i },
  ]},
  { name: 'Foretravel', aliases: /\bforetravel\b|\bfore travel\b/i, tier: 12, models: [
    { name: 'IH-45', re: /\bih[\s-]?45\b/i },
    { name: 'Realm', re: /\brealm\b/i },
    { name: 'Nimbus', re: /\bnimbus\b/i },
    { name: 'Phenix', re: /\bphenix\b/i },
    { name: 'U320',  re: /\bu\s?320\b/i },
    { name: 'U295',  re: /\bu\s?295\b/i },
  ]},
  { name: 'Tiffin', aliases: /\btiffin\b/i, tier: 12, models: [
    { name: 'Zephyr',      re: /\bzephyr\b/i },
    { name: 'Allegro Bus', re: /\ballegro\s?bus\b/i },
    { name: 'Phaeton',     re: /\bphaeton\b/i },
  ]},
  { name: 'Newmar', aliases: /\bnewmar\b|\bking aire\b|\bessex\b|\blondon aire\b/i, tier: 12, models: [
    { name: 'King Aire',   re: /\bking\s?aire\b/i },
    { name: 'Essex',       re: /\bessex\b/i },
    { name: 'London Aire', re: /\blondon\s?aire\b/i },
    { name: 'Dutch Star',  re: /\bdutch\s?star\b/i },
    { name: 'Mountain Aire', re: /\bmountain\s?aire\b/i },
  ]},
  { name: 'Entegra', aliases: /\bentegra\b|\bcornerstone\b/i, tier: 12, models: [
    { name: 'Cornerstone', re: /\bcornerstone\b/i },
    { name: 'Anthem',      re: /\banthem\b/i },
    { name: 'Aspire',      re: /\baspire\b/i },
  ]},
  { name: 'American Coach', aliases: /\bamerican (?:eagle|heritage|dream|coach)\b/i, tier: 8, models: [
    { name: 'Eagle', re: /\beagle\b/i }, { name: 'Heritage', re: /\bheritage\b/i }, { name: 'Dream', re: /\bdream\b/i },
  ]},
  { name: 'Monaco', aliases: /\bmonaco\b/i, tier: 6, models: [{ name: 'Signature', re: /\bsignature\b/i }, { name: 'Dynasty', re: /\bdynasty\b/i }] },
];

const YEAR_RE = /\b((?:19|20)\d{2})\b/g;
const SHORT_YEAR_RE = /(?:^|\s|')(\d{2})\s+(?=prevost|newell|marathon|liberty|millennium|featherlite|foretravel|tiffin|newmar|entegra)/i;

export function parseCoach(text: string, hints: Partial<ParsedCoach> = {}): ParsedCoach {
  const t = ` ${text} `.replace(/\s+/g, ' ');
  const out: ParsedCoach = { tier: 0, ...hints };

  // make
  let makeDef: MakeDef | undefined;
  for (const m of MAKES) if (m.aliases.test(t)) { makeDef = m; break; }
  // A Prevost converter name implies Prevost even when "Prevost" is missing ("2008 Marathon H3-45")
  if (!makeDef) {
    const conv = PREVOST_CONVERTERS.find(c => c.re.test(t) && c.name !== 'Newell');
    if (conv && /\bh3|x3|xl|45\b|coach/i.test(t)) makeDef = MAKES[0];
  }
  if (makeDef && !out.make) out.make = makeDef.name;
  if (out.make) makeDef = MAKES.find(m => m.name === out.make) || makeDef;   // a hint (e.g. from the title) wins
  if (makeDef) out.tier = makeDef.tier;

  // converter (Prevost shells)
  if (out.make === 'Prevost' || !out.make) {
    for (const c of PREVOST_CONVERTERS) if (c.re.test(t)) { out.converter = out.converter || c.name; out.tier = Math.max(out.tier, c.tier); break; }
  }
  if (!out.converter && out.make) out.converter = out.make; // factory-built coaches: converter = make

  // model
  const defs = makeDef?.models || [];
  for (const m of defs) if (m.re.test(t)) { out.model = out.model || m.name; break; }

  // years: "2008 Marathon" (conversion year) and "2007 shell"
  const years = [...t.matchAll(YEAR_RE)].map(m => +m[1]).filter(y => y >= 1985 && y <= 2030);
  const shellMatch = t.match(/((?:19|20)\d{2})\s*(?:shell|chassis)/i);
  if (shellMatch) out.shell_year = out.shell_year ?? +shellMatch[1];
  if (years.length && out.conv_year == null) {
    // the first year in a title is almost always the model/conversion year
    out.conv_year = years[0];
  }
  if (out.conv_year == null) { const s = t.match(SHORT_YEAR_RE); if (s) out.conv_year = 2000 + +s[1]; }
  if (out.shell_year == null && out.conv_year != null) out.shell_year = out.conv_year;

  // slides
  const sl = t.match(/\b(\d|one|two|three|four|quad|double|triple|single)\s*[- ]?slides?\b/i) || t.match(/\b(quad|triple|double|single)\s*[- ]?slide/i);
  if (sl && out.slides == null) {
    const w = sl[1].toLowerCase();
    out.slides = ({ one: 1, single: 1, two: 2, double: 2, three: 3, triple: 3, four: 4, quad: 4 } as Record<string, number>)[w] ?? +w;
  }
  if (out.slides == null && /\bno slides?\b|\bnon[- ]slide\b/i.test(t)) out.slides = 0;

  // mileage: "118k", "118,400 miles", "118400 mi"
  const mi = t.match(/\b(\d{1,3}(?:,\d{3})+|\d{2,3}(?:\.\d)?k|\d{4,6})\s*(?:miles|mi\b|mls)/i) || t.match(/(?<!\$\s?)\b(\d{2,3}k)\b/i);
  if (mi && out.mileage == null) {
    const v = mi[1].toLowerCase();
    out.mileage = v.endsWith('k') ? Math.round(parseFloat(v) * 1000) : +v.replace(/,/g, '');
    if (out.mileage < 1000 || out.mileage > 1_500_000) out.mileage = undefined;
  }

  // price: "$389,000", "$389k", "389000"
  if (out.price == null) {
    const p = t.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d{3,7}|\d{2,4}(?:\.\d)?k)\b/i);
    if (p) out.price = parseMoney(p[1]);
  }
  return out;
}

export function parseMoney(s: string | number | null | undefined): number | undefined {
  if (s == null) return undefined;
  if (typeof s === 'number') return isFinite(s) ? s : undefined;
  const v = s.toLowerCase().replace(/[^0-9.km]/g, '');
  if (!v) return undefined;
  if (v.endsWith('m')) return Math.round(parseFloat(v) * 1_000_000);
  if (v.endsWith('k')) return Math.round(parseFloat(v) * 1000);
  const n = parseFloat(v);
  return isFinite(n) ? n : undefined;
}

// ---- seller type -----------------------------------------------------------
// Private sellers are the whole point. Anything that smells like a dealership is dropped.
const DEALER_RE = /\b(dealer(?:ship)?|inventory|stock ?#|stk ?#|financing available|we finance|trade[- ]ins? welcome|call our sales|sales team|showroom|pre-?owned inventory|certified pre-?owned|rv center|rv world|rv sales|motorhome sales|coach sales|coach store|coachworks|coach works|consignment|consign|broker(?:age)?|llc|inc\.?|corp\.?|nationwide delivery available|financing|warranty available|extended warranty|tax, tag|doc fee|plus tax)\b/i;
const BROKER_RE = /\b(broker(?:age)?|consign(?:ment|ed)?|on behalf of|listed by agent|motorhome finders|national vehicle|rv agent)\b/i;
const PRIVATE_RE = /\b(private (?:owner|seller|sale)|by owner|fsbo|owner selling|selling (?:our|my)|we (?:are|'re) selling|my coach|our coach|health reasons|downsizing|retiring from|no longer (?:use|need)|bought (?:a )?new|one owner|original owner)\b/i;
const KNOWN_DEALER_NAMES = /\b(motorcoach store|pplmotorhomes|ppl motor|arizona luxury coach|liberty coach|marathon coach|millennium luxury|featherlite coaches|newell coach corp|foretravel of|la mesa rv|camping world|lazydays|general rv|national indoor rv|niRVc|dixie rv|bay area rv|north trail rv|prevost car|tradewinds coach|coach specialists|olympia luxury|buddy gregg|chesaco|holiday world|rv one|rvone|mhsrv|motor home specialist|steinbring|luxury coach & transit|premier motorcoach|creative mobile interiors|goss rv|trawick|legacy coach|nashville coach|emerald luxury coaches|american coach sales|country coach sales)\b/i;

const KNOWN_DEALER_TITLE = /\b(motorcoach store|pplmotorhomes|ppl motor ?homes|la mesa rv|camping world|lazydays|general rv|national indoor rv|mhsrv|motor home specialist|rv one\b|rvone|dixie rv|north trail rv|holiday world of)\b/i;

export function detectSellerType(opts: { title?: string; description?: string; sellerName?: string; sourceHint?: SellerType }): SellerType {
  const blob = [opts.sellerName, opts.title, opts.description].filter(Boolean).join(' \n ');
  const name = opts.sellerName || '';
  if (KNOWN_DEALER_NAMES.test(name) || KNOWN_DEALER_TITLE.test(opts.title || '')) return 'dealer';
  if (opts.sourceHint === 'dealer') return 'dealer';
  if (BROKER_RE.test(blob)) return 'broker';
  if (opts.sourceHint === 'private') return 'private';
  if (PRIVATE_RE.test(blob)) return 'private';
  if (DEALER_RE.test(name)) return 'dealer';
  // Description written like a dealership ad → dealer
  const dealerHits = (blob.match(DEALER_RE) || []).length;
  if (dealerHits >= 2) return 'dealer';
  if (dealerHits === 1 && !PRIVATE_RE.test(blob)) return 'unknown';
  return opts.sourceHint || 'unknown';
}

// ---- fingerprint -----------------------------------------------------------
// Same coach on Facebook and RVT should collapse to one row.
export function fingerprint(p: { make?: string; model?: string; converter?: string; conv_year?: number; price?: number; state?: string; city?: string }): string {
  const bucket = p.price ? Math.round(p.price / 25_000) : 0; // ±$12.5k
  return [p.make || '?', p.converter || '?', p.model || '?', p.conv_year || '?', bucket, (p.state || '?').toUpperCase()]
    .join('|').toLowerCase();
}

export const STATE_NAMES: Record<string, string> = {
  alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO', connecticut:'CT', delaware:'DE', florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID', illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA', maine:'ME', maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN', mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV', 'new hampshire':'NH', 'new jersey':'NJ', 'new mexico':'NM', 'new york':'NY', 'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK', oregon:'OR', pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC', 'south dakota':'SD', tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA', washington:'WA', 'west virginia':'WV', wisconsin:'WI', wyoming:'WY',
};

/** "Ocala, FL" | "Ocala, Florida" | "Ocala FL 34470" → { city, state } */
export function parseLocation(s?: string | null): { city?: string; state?: string } {
  if (!s) return {};
  const clean = s.replace(/\s+/g, ' ').replace(/^(?:located in|location:?|near|in|from)\s+/i, '').replace(/,?\s*(?:usa|united states)$/i, '').trim();
  let m = clean.match(/^(.*?)[,\s]+([A-Z]{2})(?:\s+\d{5})?$/);
  if (m) return { city: m[1].replace(/,$/, '').trim() || undefined, state: m[2] };
  m = clean.match(/^(.*?)[,\s]+([A-Za-z ]+)$/);
  if (m) { const st = STATE_NAMES[m[2].trim().toLowerCase()]; if (st) return { city: m[1].replace(/,$/, '').trim() || undefined, state: st }; }
  const st = STATE_NAMES[clean.toLowerCase()]; if (st) return { state: st };
  if (/^[A-Z]{2}$/.test(clean)) return { state: clean };
  return { city: clean || undefined };
}
