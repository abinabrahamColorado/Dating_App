# Project status

Updated 2026-10-20. Working name: **Meetwell**.
Pilot proposal: Manhattan, New York City; ages 18–30.

Permanent checkout: `E:\Buisness\Dating_App`.
Remote: `https://github.com/abinabrahamColorado/Dating_App`.
Branch: `codex/m1-accounts-onboarding`.

M0 was reviewed and merged in PR #2. M1 implements public pages, email links,
optional passkeys, adult eligibility/consent, profiles, three-way versioned
preferences, optional weekly availability, private moderated photos, account
controls, session management and the operator audit foundation.

The founder-designated 67-page PDF is preserved byte-for-byte. Its full extracted
text and diagrams inform the implementation; DEC-024–028 record improvements.
All 193 requirements and 20 invariant mappings remain tracked, with bounded
M1 evidence distinguished from later features.

## Validation

The M1 suite contains 16 unit/property tests, 14 real PostgreSQL/PostGIS integration
tests and 7 Chromium browser tests. Browser tests use real Mailpit and private
encrypted MinIO objects, axe on every new page and a virtual passkey authenticator.
Scripted onboarding must finish in under three minutes. Typecheck, lint, formatting
and a production build are required too. Inspect final M1 PR checks before merge;
test counts describe the suite, not a production safety certification.

## Current limits and next milestone

Account APIs require local/test mode and a loopback origin. Use synthetic accounts.
Birth-date entry is not identity verification. Photo review takes place separately.
M2 reporting/safety/appeals comes after M1 review and merge. Allocation, chat, meeting
plans, feedback, erasure/restore and event Go remain later milestones. No serving
model, GPS collection or live pilot is enabled.

Founder choices before launch include name/areas, relationship vocabulary,
age-out/return policy, incident staffing, providers and privacy/retention review.
See DECISIONS.md and BACKLOG.md.

## Try the local build

```powershell
Set-Location E:\Buisness\Dating_App
corepack pnpm services:windows:start
corepack pnpm setup:accounts
corepack pnpm dev
```

Open `http://localhost:3000`. Use an address such as `member@synthetic.invalid`;
retrieve the link in `http://127.0.0.1:8025` and open it in the same browser.
Run `corepack pnpm worker` in a second terminal for retries.
See DEVELOPMENT_WINDOWS.md for a synthetic moderator and shutdown instructions.
Ignored `.env` holds generated keys; `.local/` holds services/data.
Source, tests and docs synchronize through the GitHub milestone PR.
