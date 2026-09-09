-- Dealer blocklist: phones / names / hosts Wayne has flagged. Anything matching is dropped at ingest.
CREATE TABLE IF NOT EXISTS dealers (
  id         bigserial PRIMARY KEY,
  phone      text,          -- normalized digits
  name       text,          -- lowercased seller name
  host       text,          -- listing host (e.g. a dealer's own site)
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dealers_phone_idx ON dealers (phone);
CREATE INDEX IF NOT EXISTS dealers_name_idx ON dealers (name);
-- Where seller replies / BCC copies get parsed from (set from the app; blank = off)
INSERT INTO settings (key, value) VALUES ('capture_email', '""') ON CONFLICT (key) DO NOTHING;
