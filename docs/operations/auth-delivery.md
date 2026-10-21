# Local authentication delivery and recovery

Applies to M1 and additive migration 0004; synthetic loopback development only.
The background queue is `auth.deliver`, scheduled each minute. The request path
also makes a best-effort delivery attempt after responding. Durable authority is
the encrypted `identity.magic_links` row, not a pg-boss email payload.

## Delivery contract

Each invocation attempts at most `AUTH_OUTBOX_BATCH_SIZE` eligible rows. Each row
uses its own transaction and `FOR UPDATE SKIP LOCKED`; concurrent runners can work
on other rows. Eligibility requires unsent/unconsumed/unexpired, due time reached,
and attempts below `AUTH_OUTBOX_MAX_ATTEMPTS`. Failed decryption or SMTP increments
attempts and delays the next attempt by `AUTH_OUTBOX_RETRY_SECONDS`. Success commits
`sent_at`. A DB failure propagates; no false committed-success result is emitted.

Current operational values: 10 rows, 5 attempts, 60-second delay. SMTP connection and
greeting timeouts are 5 seconds, socket idle timeout 10 seconds. These are local
pilot operational choices in `packages/config/src/accounts.ts`, not customer SLAs.
Socket idle timeout is not an absolute end-to-end deadline. The transaction holds
one row during SMTP; a future production transport needs total-deadline testing.

If SMTP accepts mail and the process or database fails before the commit is known,
the same generic link can be delivered again. Exactly-once SMTP is not claimed.
The founder explicitly accepted this documented limitation in DEC-033.
The link remains browser-bound, expiring and single-use. Failure of a later row
cannot undo the committed delivery marker of an earlier row.

## Diagnose and recover

1. Start services with `corepack pnpm services:windows:start`, apply local additive
   migrations with `corepack pnpm setup:accounts`, and run `corepack pnpm worker`.
2. Check loopback Mailpit at `http://127.0.0.1:8025`. Its contents are synthetic
   development email; never include tokens in screenshots, tickets or Git.
3. `auth.delivery.retry` logs only aggregate sent/failed counts. Inspect service
   availability and configuration without printing credentials or provider errors.
4. An authorized local operator can count due, exhausted and expired rows; do not
   export payloads, email lookups or tokens. A key mismatch is a configuration
   incident, not a reason to overwrite ciphertext or mint replacement keys.
5. Restore the service/configuration and let due rows retry. Expired/exhausted links
   require a new member request under ordinary rate limits. Do not mass-reset
   attempt counters or extend authentication expiry.

Retention cleanup remains M5. The outbox bounds attempts but does not delete
expired records or provide an operational dashboard. Whole-process termination,
slow-trickle SMTP and production provider behavior remain release tests.

## Migration and rollback

0004 only adds `next_attempt_at` and a partial index; it rewrites no payload and
does not send email. Existing unsent rows become due at migration time. Local/test
setup applied it; no production migration was run. Deploy schema before compatible
code if a production path is later approved. Keep the additive schema when rolling
code forward/recovering. Reverting to old M1 code reintroduces batch rollback and
ignores retry metadata: stop the mail runner if that rollback is unavoidable.
Never edit an applied migration checksum or drop retry metadata as an automatic rollback.
