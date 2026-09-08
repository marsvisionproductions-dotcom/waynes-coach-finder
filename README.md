# Wayne's Coach Finder

A daily feed of **private-seller** luxury motorcoaches (Prevost conversions, Newell, Foretravel, Tiffin Zephyr, Newmar King Aire, Entegra Cornerstone) with a five-stage pipeline: **New → Contacted → Talking → Won / Lost**. Built for Wayne at The Motorcoach Store, Bradenton FL. Dealers never enter the database.

Live: https://waynes-coach-finder.netlify.app · Netlify project: `waynes-coach-finder`

## How it works

```
6:00 am ET  collect-scheduled  →  collect-background (15-min budget)
                                    ├─ eBay Browse API           (official, free)
                                    ├─ RSS: PrevostRVForSale, NewellGurus, ForeForums
                                    ├─ Prevost-Stuff list page   (open robots, 1 fetch/day)
                                    ├─ RVUSA sitemap lastmod     (open robots)
                                    ├─ RVTrader search           (only via SCRAPER_PROXY_URL; alert emails otherwise)
                                    └─ Facebook Marketplace      (Apify actor, logged-out, 16 metros × 500 mi → webhook)
            ingest: normalize → dedupe (source id, then cross-source fingerprint) → drop dealers → score → rows + events
            sweep: New coaches unseen for 3 days → Lost (gone); if they reappear they come back to New
            digest: Resend email, best-first, plus follow-ups due
Any time    POST /api/ingest        any JSON producer (Bright Data, an agent you run, a spreadsheet)
            POST /api/capture       the bookmarklet / "Capture" modal (URL → page extractor)
            POST /api/inbound-email saved-search alert emails (RVT Auto-Notify, RVTrader, Craigslist, Autotrader)
```

The one contract every collector speaks is `RawListing` in `src/lib/schema.mts`. Anything that can produce that JSON can feed the app.

## Environment variables (Netlify → Site configuration → Environment variables)

| Key | Needed for | Notes |
|---|---|---|
| `INGEST_SECRET` | protecting `/api/ingest`, `/api/run`, webhooks | any long random string; send as `x-ingest-secret` header or `?secret=` |
| `APIFY_TOKEN` | Facebook Marketplace | apify.com → Settings → Integrations. Actor `apify/facebook-marketplace-scraper` ($5 / 1k results, $5 free/mo) |
| `APIFY_ACTOR_ID` | optional | default `apify~facebook-marketplace-scraper` |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | eBay Motors | developer.ebay.com → create app → production keyset. 5,000 calls/day free |
| `RESEND_API_KEY`, `DIGEST_TO`, `DIGEST_FROM` | morning email | resend.com (3,000 emails/mo free). `DIGEST_FROM` needs a verified domain, or use `onboarding@resend.dev` to test |
| `SCRAPER_PROXY_URL` | RVTrader search pages | optional. A vendor unlocker endpoint with `{url}` placeholder, e.g. `https://api.scraperapi.com?api_key=KEY&url={url}` |
| `URL` | set by Netlify | used for webhook callbacks |

Without any of these the app still runs: the feeds, Prevost-Stuff, RVUSA, capture and manual entry work with zero keys.

## Saved-search alert emails → the app

RVT.com (Auto-Notify), RVTrader, Craigslist, RVs on Autotrader and RVUniverse all email new matches. Create the saved searches under a dedicated address (e.g. `coachfinder@…`, never Wayne's personal one), then forward that mailbox to an inbound-parse webhook:

- **Resend inbound** / **Postmark inbound** / **Cloudflare Email Routing → Worker**: POST the parsed email JSON to `https://waynes-coach-finder.netlify.app/api/inbound-email?secret=INGEST_SECRET`

RVTrader emails are parsed in place (RVTrader blocks page fetches). Other links get one polite page fetch each.

## Capture button

In the app: **＋ Capture** → drag "Save to Coach Finder" to the bookmarks bar. On any listing page click it; the coach lands in **New**. On a phone, paste the link into the same dialog.

## Texting and calling

No Twilio, no 10DLC. Text/Call/Email buttons are `sms:` / `tel:` / `mailto:` links with the drafted message filled in, so they go out from Wayne's own phone (or a Mac with iPhone text forwarding). The QR button encodes the same `sms:` link for use at a desk.

## Development

```bash
npm install
npm test                                  # 26 tests, incl. an in-process Postgres (PGlite) run of the real SQL
COACH_DB=pglite node scripts/dev-local.mjs   # http://localhost:8788 with the real API, throwaway DB
node scripts/seed.mjs                     # load sample listings into it
npm run build                             # copies public/ → dist/
```

`netlify dev` also works once the site is linked (`netlify link`), with the real Netlify DB.

## Deploy

The site is a Netlify project (`waynes-coach-finder`). Either connect this folder to a Git repo in the Netlify UI, or from this folder:

```bash
npx -y netlify-cli deploy --build --prod
```

Netlify DB is provisioned automatically on first deploy; migrations in `netlify/database/migrations/` run before each production deploy.

## AIHQ card

`aihq-card.html` is a drop-in card for the AIHQ portal that links to the app and shows the live "new today" count from `/api/stats`.

## Stay-safe rules baked in

- Public data only, always logged out. No staff credentials or cookies anywhere in the pipeline.
- Facebook only through a vendor running on its own servers; the app never touches facebook.com itself except for one-off capture fetches of a URL Wayne pasted.
- RVTrader, RVT, Craigslist: alert emails only (plus an optional vendor unlocker for RVTrader search pages).
- Open sites: truthful User-Agent (`CoachFinder/0.1`), 4 s between requests per host, robots honored.
- Dealers are dropped at ingest; only contact details a listing shows publicly are stored.
