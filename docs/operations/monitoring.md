# Privacy-preserving operational monitoring

DEC-050; Spec P22, I-12/I-17. No external vendor, SDK or account is added.

`packages/runtime/src/monitoring.ts` accepts only a fixed event-name union and emits
three fields: `event`, a fresh random `requestId`, and an ISO `timestamp`. It accepts
no error/request/member argument. Web startup/request failures, worker lifecycle,
worker heartbeat and job failures use it. Queue wrappers rethrow only `JOB_FAILED`,
so pg-boss does not persist private exception text. Unit and real queue tests prove
the whitelist and sentinel omission while preserving successful callback results.

Run `corepack pnpm monitor` in a separate supervised process, or
`corepack pnpm monitor --once` for an exit-code health probe. It checks only
`APP_ORIGIN/api/v1/health` every 60 seconds with a 5-second timeout, refuses
redirects, requires HTTPS outside loopback, and records only up/down transitions.
It never reads or logs response bodies, URLs, headers or member identifiers.
The health endpoint establishes web-process liveness, not database/queue readiness.
The worker emits a heartbeat every 60 seconds. No endpoint exposes these logs.

The schema excludes emails, names, message/report text, photos, location, tokens,
request bodies and arbitrary error metadata. Do not add a CSP report collector or
automatic request/console breadcrumbs: they can carry private URLs or content.
Suppressing raw job errors sacrifices detailed diagnostics; reproduce a failure
with synthetic fixtures rather than adding member data to telemetry.

## Remaining decision: alert delivery and ownership

The founder has not approved an outside provider. Local events alone cannot alert
someone when the whole host is down. Choose an operator, an independent probe
location, routing/escalation, retention and access policy before launch.

- Keep this local instrumentation until hosting decisions are made (no third-party
  transfer; external downtime alerting remains open).
- Evaluate [self-hosted Uptime Kuma](https://github.com/louislam/uptime-kuma) on
  founder-controlled infrastructure. This requires hosting and maintenance; configure
  only the fixed health path and an explicitly approved notification destination.
- Evaluate hosted Sentry only after a separate privacy/vendor decision. Its
  [sensitive-data guidance](https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/)
  requires deliberate event filtering. Default SDK collection is not acceptable for
  this app; no SDK is installed in this PR.

Next's `onRequestError` hook records a generic event but cannot suppress every raw
framework stderr exception. Framework/hosting/access-log scrubbing, log access and
retention remain an explicit engineering release gate (checklist item 35). Do not
claim production logging is fully audited or send raw logs to an external service.
