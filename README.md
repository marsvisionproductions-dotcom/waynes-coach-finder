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
| `RESEND_API_KEY`, `DIGEST_TO`, `DIGEST_FROM`, `FORWARD_TO` | morning email; inbound mail; where unrecognised inbound mail is forwarded | resend.com (3,000 emails/mo free). `DIGEST_FROM` needs a verified domain, or use `onboarding@resend.dev` to test |
| `SCRAPER_PROXY_URL` | RVTrader search pages | optional. A vendor unlocker endpoint with `{url}` placeholder, e.g. `https://api.scraperapi.com?api_key=KEY&url={url}` |
| `URL` | set by Netlify | used for webhook callbacks |

Without any of these the app still runs: the feeds, Prevost-Stuff, RVUSA, capture and manual entry work with zero keys.

## Saved-search alert emails → the app

RVT.com (Auto-Notify), RVTrader, Craigslist, RVs on Autotrader and RVUniverse all email new matches. Create the saved searches under a dedicated address (e.g. `coachfinder@…`, never Wayne's personal one), then forward that mailbox to an inbound-parse webhook:

- **Resend inbound** / **Postmark inbound** / **Cloudflare Email Routing → Worker**: POST the parsed email JSON to `https://waynes-coach-finder.netlify.app/api/inbound-email?secret=INGEST_SECRET`

RVTrader emails are parsed in place (RVTrader blocks page fetches). Other links get one polite page fetch each.

## Seller replies → the app (email, no phone yet)

Netlify can't receive mail, so a mail-receiving service forwards it as a webhook. Two ways that work, both free at this volume:

1. **Resend inbound** (same account as the digest): add the domain, create an address like `leads@themotorcoachstore.com`, point its webhook at
   `https://waynes-coach-finder.netlify.app/api/inbound-email?secret=<INGEST_SECRET>`.
2. **Cloudflare Email Routing** (if the domain's DNS is on Cloudflare): route `leads@` to a tiny Worker that POSTs `{from, subject, text}` to the same URL.

Resend Inbound's webhook carries only an id; the endpoint fetches the body from Resend's API (so `RESEND_API_KEY` must be set). Anything
that is neither a coach conversation nor a listing alert (e.g. RVTrader's "confirm your saved search" email) is forwarded to `FORWARD_TO`.

Then set the address once: `PATCH /api/settings {"capture_email":"leads@…"}` (header `x-ingest-secret`). From then on the **Open in Mail** button BCCs that
address and tags the subject with `(ref 123)`. Wayne's own copy logs "Emailed" on the coach; when the seller replies (they reply-all, or Wayne
forwards it to `leads@`), the app logs the reply, moves the coach **Working → Talking**, and the header shows "N seller replies". Alert emails from
RVTrader/RVT/Craigslist sent to the same address still work — they're told apart by the `(ref …)` tag / known seller address.

## Dealer weeding

Dealers are dropped at ingest (`dropped_dealer` in every run summary). Signals, in order: source says dealer (Prevost-Stuff seller slug, RVTrader
seller type, eBay business seller) → dealer wording in the ad (stock #, financing, "our inventory", trade-ins, dealership names) → the **dealers**
blocklist (phone / seller name / site host) → the same phone number on 3+ different coaches → `…,998 / …,999` pricing with no owner language
(kept, but downgraded to "unknown seller" so it scores lower). Wayne's **Dealer** button on any card does the rest: it drops the coach, adds the
seller's phone/name to the blocklist, and sweeps any other coach with the same phone or name into Lost/dealer. Nothing gets a second chance
unless the seller changes number and name.

## Price analysis

Purely our own data — no valuation API, no tokens. The button in a coach's detail compares it with similar coaches we've seen (same make and
converter within ±3 model years; falls back to same make while history is thin): count, asking range, median, where this one sits vs the median,
last-30-day median vs the prior 60 days, and how many have since gone. It gets useful after a few weeks of daily runs. `GET /api/listings/:id/comps`.

## Facebook cost

Two-step Apify: a cheap **search** run (15 newest results per metro × 6 model queries, no details, ≤ $4) → a small **detail** run only for coaches we
had not seen before (≤ 20 URLs, ≤ $2). Typical day is well under $2; `APIFY_MAX_USD`, `APIFY_RESULTS_PER_URL` tune it.

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
