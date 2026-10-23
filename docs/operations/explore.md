# Explore operations (M3)

This is a synthetic loopback preview, not a live introduction service. Read
DEC-040–043 and the M3 review evidence before changing allocation or delivery.

## Run locally

1. Start services and run `corepack pnpm setup:accounts` to apply migrations.
2. Optionally run `corepack pnpm seed:explore-venue`. This creates one explicitly
   synthetic public-centroid fixture in the local development database only.
3. Run `corepack pnpm dev` and `corepack pnpm worker` in separate terminals.
4. Complete synthetic adult profiles, preferences and approved media. Assign an
   independent operator with `corepack pnpm staff:grant <member-id> operator`.
5. Open `/ops/explore`. Prepare the full cohort or supply IDs for a concierge cohort.
   Review proposed pairs and original unserved reasons; remove/add as needed, then
   approve. Additions recheck all gates. Staff cannot curate themselves.
6. The worker delivers approved eligible pairs. Members open `/explore`, then a
   full-page introduction. The private response timer begins at delivery.

The scheduled weekly batch is Monday at 14:00 in New York. Delivery, expiry and
mail sweep every minute. A reservation expires after the configured lease even if
an operator never approves it. Empty weeks stay empty; no ineligible pair fills a
quota. The worker refuses oversized full-cohort snapshots instead of truncating.

## Authority and concurrency

Member locks and capacity ledgers are ordered by UUID. Review/approval locks the
whole involved member set in global order. `lockedExplorePair` checks fresh state,
media, explicit boundaries, travel, availability and `isDenied` at retrieval,
reservation, delivery and acceptance. Card/photo reads use `withMemberPair` and
live grants. Neither helper returns a reusable authorization token.

Every delivered pair gets two profile grants. Pass, expiry, block, restriction and
close remove them and release held capacity once. The pair history remains closed
forever. A delivered exposure remains counted even if passed. A lower personal
cap only stops new holds. Blind per-member versions avoid revealing the other's
first acceptance. Operator-curated exposures always have null propensity.

## Notification review

The batch page shows failed, sending and uncertain mail counts. A claim is saved
before external SMTP. Known pre-delivery failure retries after the configured delay;
an ambiguous send never retries automatically. A stale SENDING claim is quarantined
as UNCERTAIN after the configured interval. Verify the local Mailpit mailbox/provider
record using the internal intent ID with authorized infrastructure access. Do not
reset it to PENDING without proving no delivery occurred. Keep uncertain items held
if that proof is unavailable; the introduction remains visible in the member app.

SMTP already accepted cannot be recalled. Pair locks ensure a concurrent block is
ordered with the in-flight send. Email bodies contain only a generic account update
and the app URL. No names, photos, location, report text or choice appear in mail.
Reminders require explicit opt-in and are cancelled after response or closure.

CLIENT_VERSION shutdown stops allocation/delivery/mail for the affected running
release. Expiry cleanup and reporting/help remain available. Venue and event
shutdown enforcement stays with M4/M6; do not claim those future paths are live.

## Verification

Run `corepack pnpm check` with real Postgres/PostGIS, MinIO and Mailpit running.
`corepack pnpm benchmark:explore` prints reproducible synthetic greedy/exact results.
The benchmark is an offline cardinality comparison, not a product success measure.
Whole-process crash drills, production providers, queue alerting, retention/deletion
and real venue operations remain the later release gates in `docs/BACKLOG.md`.
