# Security hardening review

Scope: the founder's separate 2026-11-11 hardening request after M4. No M5,
matching research card, vendor integration or deployment is included. The exact
[49-item register](../security/checklist.md) distinguishes code coverage from open
hosting/operational decisions and absent features.

## Boundary changes

- Web responses now receive a fresh nonce in both request CSP (for Next's rendered
  scripts) and response CSP. Incoming nonce/CSP headers cannot choose the value.
  The root is dynamic; HTML is private/no-store. Scripts have no unsafe-inline;
  development alone permits unsafe-eval. Style attributes remain allowed for React.
  Nonlocal HSTS and existing headers apply through Next configuration and Proxy.
- Web wrapper, direct Next startup and worker startup share configuration checks.
  Nonlocal SMTP requires verified implicit TLS or mandatory STARTTLS. Encryption
  keys must be independent canonical 256-bit values; passwords must be at least
  24 characters and not published examples. No value is included in diagnostics.
- CI scans complete fetched history with pinned, checksum-verified gitleaks and
  tests discovery of a synthetic key removed by a later commit. The only allowlist
  is an architecture-test source fingerprint. Production dependency audit fails
  on advisories; weekly Dependabot updates still require human review.
- Operational events have only fixed names, generated request IDs and timestamps.
  Queue errors are generic before persistence. Health checks ignore bodies and
  refuse redirects. External alert delivery and framework/hosting log scrubbing
  remain open; no outside service was added.
- Encrypted archives authenticate before restore SQL. Restore creates a fresh
  isolated database and preserves role grants and migration ledger. It cannot
  promote the database or implement deletion replay; that is still M5.

## Verification record

Focused tests verify plaintext SMTP is refused before AUTH/MAIL/DATA; direct Next
startup rejects invalid TLS; untrusted HTML script is blocked while sign-in
hydration works; spoofed nonce headers are replaced; queue error output omits a
private sentinel; and a real fresh PostgreSQL restore recovers encrypted synthetic
data while denying app/learning access to safety records. Tamper/wrong-key cases
create no database. Browser assets are checked for source maps/configured secrets.

Initial full-history gitleaks findings were four historical source-fingerprint
literals in `tests/unit/safety-architecture.test.ts`, manually inspected as code
hashes. After the exact path-and-line exception, the full-history scan found no
leaks. No issued credential was identified and no history was rewritten.
`corepack pnpm audit --prod` reported no known vulnerabilities at verification time.

One independent read-only bypass review found two confirmed paths: PostgreSQL
query parameters could override a checked userinfo password, and native URL parse
errors could retain a malformed monitoring origin. Nonlocal database URLs now
reject query overrides (only `sslmode` is supported); monitor parsing replaces the
native error with a value-free diagnostic. Encoded override and private-origin
regressions were added. The reviewer confirmed both paths closed and reported no
other concrete surviving bypass in the scoped candidate; this is not a full
repository penetration test.

Full required `corepack pnpm check` passed on 2026-11-11: typecheck, lint,
formatting, **46 unit/property/architecture + 74 real PostgreSQL integration +
18 Chromium/axe tests = 138**, plus the production build. All existing M0–M4
workflows pass under the CSP. The production dependency audit found no advisories.
Final published-head CI is recorded on
[PR #11](https://github.com/abinabrahamColorado/Dating_App/pull/11) before handoff. Setup PR #10 is
separate and is not included in this branch.

DEC-050/051 record the scope and protective choices. Existing enrollment remains
loopback/synthetic only. This review does not establish readiness for real users.
