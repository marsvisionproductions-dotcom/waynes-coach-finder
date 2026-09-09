// Facebook Marketplace search is location-bound with a 500-mile maximum radius.
// These 16 seeds at 500 mi cover the continental US (plus a little overlap so nothing falls in a seam).
// Slugs are Facebook's own location slugs: https://www.facebook.com/marketplace/<slug>/search?...
export interface Metro { slug: string; name: string; lat: number; lng: number }

export const METROS: Metro[] = [
  { slug: 'miami',         name: 'Miami, FL',          lat: 25.76, lng: -80.19 },
  { slug: 'atlanta',       name: 'Atlanta, GA',        lat: 33.75, lng: -84.39 },
  { slug: 'charlotte',     name: 'Charlotte, NC',      lat: 35.23, lng: -80.84 },
  { slug: 'nyc',           name: 'New York, NY',       lat: 40.71, lng: -74.01 },
  { slug: 'chicago',       name: 'Chicago, IL',        lat: 41.88, lng: -87.63 },
  { slug: 'minneapolis',   name: 'Minneapolis, MN',    lat: 44.98, lng: -93.27 },
  { slug: 'kansascity',    name: 'Kansas City, MO',    lat: 39.10, lng: -94.58 },
  { slug: 'dallas',        name: 'Dallas, TX',         lat: 32.78, lng: -96.80 },
  { slug: 'houston',       name: 'Houston, TX',        lat: 29.76, lng: -95.37 },
  { slug: 'denver',        name: 'Denver, CO',         lat: 39.74, lng: -104.99 },
  { slug: 'saltlakecity',  name: 'Salt Lake City, UT', lat: 40.76, lng: -111.89 },
  { slug: 'phoenix',       name: 'Phoenix, AZ',        lat: 33.45, lng: -112.07 },
  { slug: 'la',            name: 'Los Angeles, CA',    lat: 34.05, lng: -118.24 },
  { slug: 'sanfrancisco',  name: 'San Francisco, CA',  lat: 37.77, lng: -122.42 },
  { slug: 'seattle',       name: 'Seattle, WA',        lat: 47.61, lng: -122.33 },
];

// One query per make family. "prevost" alone catches every converter; the converter names catch titles that omit "Prevost".
export const FB_QUERIES = ['prevost', 'newell coach', 'foretravel', 'tiffin zephyr', 'newmar king aire', 'entegra cornerstone'];

export function fbSearchUrl(metro: Metro, query: string, opts: { radiusMi?: number; minPrice?: number; daysSinceListed?: 1 | 7 | 30 } = {}): string {
  // exact=true: a fuzzy 'prevost' search returns every $100k+ vehicle in the area (Mercedes, Ford…). Exact keeps it to coaches.
  const p = new URLSearchParams({ query, sortBy: 'creation_time_descend', daysSinceListed: String(opts.daysSinceListed ?? 1), radius: String(opts.radiusMi ?? 500), minPrice: String(opts.minPrice ?? 100000), exact: 'true' });
  return `https://www.facebook.com/marketplace/${metro.slug}/search?${p.toString()}`;
}

export function allFbSearchUrls(opts: { radiusMi?: number; minPrice?: number; daysSinceListed?: 1 | 7 | 30; queries?: string[]; metros?: Metro[] } = {}): string[] {
  const out: string[] = [];
  for (const m of opts.metros ?? METROS) for (const q of opts.queries ?? FB_QUERIES) out.push(fbSearchUrl(m, q, opts));
  return out;
}
