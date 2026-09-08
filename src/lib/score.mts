// 0–100 "best to call first" score. Weights are a starting point; tune from the settings table later.
export interface ScoreInput {
  posted_at?: Date | string | null;
  first_seen_at?: Date | string | null;
  seller_type: string;
  tier: number;                 // 0–20 from coaches.mts
  price?: number | null;
  median_price?: number | null; // median of comparable listings seen in last 90 days, if known
  price_reduced?: boolean;
  contact_phone?: string | null;
  contact_email?: string | null;
  contact_url?: string | null;
  dist_mi?: number | null;
  now?: Date;
}

export function score(i: ScoreInput): { score: number; breakdown: Record<string, number> } {
  const now = i.now || new Date();
  const posted = i.posted_at ? new Date(i.posted_at) : (i.first_seen_at ? new Date(i.first_seen_at) : now);
  const ageDays = Math.max(0, (now.getTime() - posted.getTime()) / 864e5);

  // Freshness 30: full under 24h, linear to 0 at 14 days
  const fresh = ageDays <= 1 ? 30 : Math.max(0, Math.round(30 * (1 - (ageDays - 1) / 13)));

  // Seller 25: private 25, broker 8, unknown 12, dealer 0 (dealers are filtered out before this anyway)
  const seller = ({ private: 25, broker: 8, unknown: 12, dealer: 0 } as Record<string, number>)[i.seller_type] ?? 12;

  // Tier 20
  const tier = Math.max(0, Math.min(20, Math.round(i.tier)));

  // Price 15: below median scores higher; reduced adds 5
  let price = 7;
  if (i.price && i.median_price) {
    const r = i.price / i.median_price;
    price = r <= 0.8 ? 10 : r <= 0.95 ? 9 : r <= 1.05 ? 7 : r <= 1.2 ? 4 : 2;
  }
  if (i.price_reduced) price = Math.min(15, price + 5);

  // Reachability 10: phone 10, email 7, messenger/url 4, nothing 0
  const reach = i.contact_phone ? 10 : i.contact_email ? 7 : i.contact_url ? 4 : 0;

  // Distance is a tiebreaker: up to -3 for far-away coaches
  const dist = i.dist_mi == null ? 0 : i.dist_mi <= 250 ? 0 : i.dist_mi <= 1000 ? -1 : i.dist_mi <= 2000 ? -2 : -3;

  const total = Math.max(0, Math.min(100, fresh + seller + tier + price + reach + dist));
  return { score: total, breakdown: { freshness: fresh, seller, tier, price, reach, distance: dist } };
}
