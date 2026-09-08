// Distance from Bradenton, FL. City table for the places coaches actually live; state centroid otherwise.
export const HOME = { lat: 27.4989, lng: -82.5748, name: 'Bradenton, FL' };

const STATE_CENTROIDS: Record<string, [number, number]> = {
  AL:[32.8,-86.8], AK:[64.7,-152.4], AZ:[34.3,-111.7], AR:[34.9,-92.4], CA:[37.2,-119.5], CO:[39.0,-105.5], CT:[41.6,-72.7], DE:[39.0,-75.5], FL:[28.6,-82.4], GA:[32.7,-83.4],
  HI:[20.9,-156.4], ID:[44.4,-114.6], IL:[40.0,-89.2], IN:[39.9,-86.3], IA:[42.1,-93.5], KS:[38.5,-98.4], KY:[37.5,-85.3], LA:[31.1,-92.0], ME:[45.4,-69.2], MD:[39.0,-76.8],
  MA:[42.3,-71.8], MI:[44.3,-85.4], MN:[46.3,-94.3], MS:[32.7,-89.7], MO:[38.4,-92.5], MT:[47.0,-109.6], NE:[41.5,-99.8], NV:[39.3,-116.6], NH:[43.7,-71.6], NJ:[40.2,-74.7],
  NM:[34.4,-106.1], NY:[42.9,-75.5], NC:[35.6,-79.4], ND:[47.5,-100.5], OH:[40.3,-82.8], OK:[35.6,-97.5], OR:[43.9,-120.6], PA:[40.9,-77.8], RI:[41.7,-71.6], SC:[33.9,-80.9],
  SD:[44.4,-100.2], TN:[35.9,-86.4], TX:[31.5,-99.3], UT:[39.3,-111.7], VT:[44.1,-72.7], VA:[37.5,-78.9], WA:[47.4,-120.5], WV:[38.6,-80.6], WI:[44.6,-89.9], WY:[43.0,-107.6],
};

const CITIES: Record<string, [number, number]> = {
  'bradenton,FL':[27.50,-82.57], 'sarasota,FL':[27.34,-82.53], 'tampa,FL':[27.95,-82.46], 'st. petersburg,FL':[27.77,-82.64], 'orlando,FL':[28.54,-81.38], 'miami,FL':[25.76,-80.19],
  'fort myers,FL':[26.64,-81.87], 'naples,FL':[26.14,-81.79], 'jacksonville,FL':[30.33,-81.66], 'ocala,FL':[29.19,-82.14], 'the villages,FL':[28.93,-82.00], 'lakeland,FL':[28.04,-81.95],
  'tallahassee,FL':[30.44,-84.28], 'pensacola,FL':[30.42,-87.22], 'daytona beach,FL':[29.21,-81.02], 'fort lauderdale,FL':[26.12,-80.14], 'west palm beach,FL':[26.72,-80.05],
  'atlanta,GA':[33.75,-84.39], 'savannah,GA':[32.08,-81.10], 'charlotte,NC':[35.23,-80.84], 'raleigh,NC':[35.78,-78.64], 'nashville,TN':[36.16,-86.78], 'knoxville,TN':[35.96,-83.92], 'memphis,TN':[35.15,-90.05],
  'birmingham,AL':[33.52,-86.81], 'new orleans,LA':[29.95,-90.07], 'houston,TX':[29.76,-95.37], 'dallas,TX':[32.78,-96.80], 'austin,TX':[30.27,-97.74], 'san antonio,TX':[29.42,-98.49], 'nacogdoches,TX':[31.60,-94.66],
  'oklahoma city,OK':[35.47,-97.52], 'tulsa,OK':[36.15,-95.99], 'kansas city,MO':[39.10,-94.58], 'st. louis,MO':[38.63,-90.20], 'chicago,IL':[41.88,-87.63], 'indianapolis,IN':[39.77,-86.16], 'elkhart,IN':[41.68,-85.98],
  'columbus,OH':[39.96,-83.00], 'cincinnati,OH':[39.10,-84.51], 'cleveland,OH':[41.50,-81.69], 'detroit,MI':[42.33,-83.05], 'minneapolis,MN':[44.98,-93.27], 'milwaukee,WI':[43.04,-87.91],
  'denver,CO':[39.74,-104.99], 'colorado springs,CO':[38.83,-104.82], 'salt lake city,UT':[40.76,-111.89], 'phoenix,AZ':[33.45,-112.07], 'scottsdale,AZ':[33.49,-111.93], 'tucson,AZ':[32.22,-110.97], 'mesa,AZ':[33.42,-111.83],
  'las vegas,NV':[36.17,-115.14], 'reno,NV':[39.53,-119.81], 'albuquerque,NM':[35.08,-106.65], 'los angeles,CA':[34.05,-118.24], 'san diego,CA':[32.72,-117.16], 'san francisco,CA':[37.77,-122.42], 'sacramento,CA':[38.58,-121.49],
  'portland,OR':[45.52,-122.68], 'seattle,WA':[47.61,-122.33], 'spokane,WA':[47.66,-117.43], 'boise,ID':[43.62,-116.21], 'billings,MT':[45.78,-108.50], 'fargo,ND':[46.88,-96.79], 'omaha,NE':[41.26,-95.93],
  'new york,NY':[40.71,-74.01], 'boston,MA':[42.36,-71.06], 'philadelphia,PA':[39.95,-75.17], 'pittsburgh,PA':[40.44,-79.99], 'washington,DC':[38.91,-77.04], 'richmond,VA':[37.54,-77.44], 'baltimore,MD':[39.29,-76.61],
  'myrtle beach,SC':[33.69,-78.89], 'charleston,SC':[32.78,-79.93], 'greenville,SC':[34.85,-82.40], 'louisville,KY':[38.25,-85.76], 'little rock,AR':[34.75,-92.29], 'jackson,MS':[32.30,-90.18],
  'red bay,AL':[34.44,-88.14], 'miami,OK':[36.87,-94.88], 'junction,TX':[30.49,-99.77], 'quartzsite,AZ':[33.66,-114.23], 'yuma,AZ':[32.69,-114.63], 'lake havasu city,AZ':[34.48,-114.32],
};

export function milesBetween(a: [number, number], b: [number, number]): number {
  const R = 3958.8, toR = (d: number) => d * Math.PI / 180;
  const dLat = toR(b[0] - a[0]), dLng = toR(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function distanceFromHome(city?: string | null, state?: string | null, lat?: number | null, lng?: number | null): number | undefined {
  let pt: [number, number] | undefined;
  if (lat != null && lng != null) pt = [lat, lng];
  else if (city && state) pt = CITIES[`${city.toLowerCase()},${state.toUpperCase()}`];
  if (!pt && state) pt = STATE_CENTROIDS[state.toUpperCase()];
  if (!pt) return undefined;
  return Math.round(milesBetween([HOME.lat, HOME.lng], pt));
}
