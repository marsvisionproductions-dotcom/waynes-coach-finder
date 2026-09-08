-- Wayne's Coach Finder — initial schema
-- One row in `listings` = one physical coach as best we can tell.
-- `listing_sources` = every place we saw it. `events` = the history/notes timeline.

CREATE TABLE IF NOT EXISTS listings (
  id              bigserial PRIMARY KEY,
  fingerprint     text UNIQUE,                 -- cross-source dedupe key
  make            text,                        -- Prevost, Newell, Foretravel, Tiffin, Newmar, Entegra
  model           text,                        -- H3-45, X3-45, XLII, King Aire, Cornerstone, Zephyr, IH-45 ...
  converter       text,                        -- Marathon, Liberty, Millennium, Featherlite, Emerald, Vantare ...
  shell_year      int,
  conv_year       int,
  slides          int,
  mileage         int,
  price           numeric,
  city            text,
  state           text,
  dist_mi         int,                         -- from Bradenton, FL
  seller_type     text NOT NULL DEFAULT 'unknown',  -- private | broker | dealer | unknown
  seller_name     text,
  contact_phone   text,
  contact_email   text,
  contact_url     text,                        -- Messenger / listing contact page
  thumb_url       text,
  photos          jsonb NOT NULL DEFAULT '[]',
  photo_count     int,
  title_raw       text,
  description     text,
  posted_at       timestamptz,                 -- earliest source-reported post time
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  stage           text NOT NULL DEFAULT 'new', -- new | contacted | talking | won | lost
  lost_reason     text,                        -- passed | gone
  favorite        boolean NOT NULL DEFAULT false,
  followup_on     date,
  our_number      numeric,
  score           int,
  score_breakdown jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_stage_idx ON listings (stage, score DESC);
CREATE INDEX IF NOT EXISTS listings_seller_idx ON listings (seller_type);

CREATE TABLE IF NOT EXISTS listing_sources (
  id               bigserial PRIMARY KEY,
  listing_id       bigint NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source           text NOT NULL,              -- fb | ebay | rvt | rvtrader | prevoststuff | craigslist | newellgurus | prevostrvforsale | rvusa | capture | ...
  external_id      text NOT NULL,
  url              text,
  source_posted_at timestamptz,
  seen_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  raw              jsonb,
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS listing_sources_listing_idx ON listing_sources (listing_id);

CREATE TABLE IF NOT EXISTS events (
  id          bigserial PRIMARY KEY,
  listing_id  bigint NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL,                   -- system | stage | contact | note
  body        text NOT NULL
);
CREATE INDEX IF NOT EXISTS events_listing_idx ON events (listing_id, at DESC);

CREATE TABLE IF NOT EXISTS runs (
  id           bigserial PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  trigger      text,                           -- schedule | manual | webhook
  status       text NOT NULL DEFAULT 'running',
  summary      jsonb
);

CREATE TABLE IF NOT EXISTS settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('buyer', '{"name":"Wayne","company":"The Motorcoach Store","city":"Bradenton, FL","phone":""}'),
  ('makes', '["Prevost","Newell","Foretravel","Tiffin","Newmar","Entegra"]'),
  ('min_price', '100000'),
  ('fb_radius_mi', '500')
ON CONFLICT (key) DO NOTHING;
