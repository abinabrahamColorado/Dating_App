# Decisions and unresolved questions

Date: 2026-10-16. Status: M0 review proposals unless explicitly a founder-supplied fact. Source authority: AGENTS.md, architecture v0.2, then the uploaded milestone prompts and founder launch facts. No product behavior beyond infrastructure is implemented in M0.

| ID      | Question / ambiguity                                                                                                    | Choice and reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Source / follow-up                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| DEC-001 | Earlier preview uses Vinext/D1; repository requires a different stack.                                                  | Start the production repository foundation with Next.js App Router, PostgreSQL16/PostGIS, TypeScript, pnpm and pg-boss. Keep the preview outside this repository as design reference only. It is not production evidence.                                                                                                                                                                                                                                                                 | AGENTS §3; Spec P22/P23; founder supplied exact M0 sequence         |
| DEC-002 | M0 asks for area centroids while I-17 prohibits raw location.                                                           | Store static public area/venue reference geography only; never member device coordinates or inferred origins. Eight broad provisional Manhattan areas are chosen in config. Public reference data must not be mistaken for a member fix. User-selected area and plan context are still sensitive and excluded from learning/logs/queues.                                                                                                                                                  | Spec P9/P18/P22; M0 launch facts; founder review of area list       |
| DEC-003 | Ages18–30: what happens on the31st birthday?                                                                            | No new introductions outside the configured cohort; existing consensual connections can close/report/access own records. No automatic harmful disclosure or erasure. Admission and age refresh use New York local date. Final continuing-chat policy is an M1 founder question.                                                                                                                                                                                                           | Spec P4/P5; founder age range; no invented date of birth            |
| DEC-004 | Go activation says free capacity but existing matches already hold slots.                                               | Existing-match Go reuses the held connection slot. New-person Go requires new bilateral slots. Last-slot acceptance never self-cancels.                                                                                                                                                                                                                                                                                                                                                   | Spec P5/P6 overrides an overly broad reading of M6; I-06            |
| DEC-005 | M7 says no personal data in logs/backups; P22 describes encrypted sensitive backups and a possible7-day raw-IP maximum. | Collect no ordinary raw access/IP logs in MVP. Logs/queues/exports use allowlists with no narrative, personal location or message content. Backups may contain authorized encrypted product data, never plaintext sensitive fields; restore must replay tombstones before service. A blanket claim that encrypted backups contain no personal data would be false.                                                                                                                        | Spec P21/P22; I-12/I-17/I-18; counsel validates production policies |
| DEC-006 | P22 discusses learned models and sensitive audit demographics beyond the milestone scope.                               | No models, embeddings, training jobs, demographic collection or model registry in M0–M7. Record time-valid allowlisted outcomes only. Dormant retention maxima in config do not enable collection.                                                                                                                                                                                                                                                                                        | Spec P14/P24/P29; founder milestone instructions                    |
| DEC-007 | Permanent pair exclusion versus deletion and anti-evasion.                                                              | Account IDs are never reused. Retain only the necessary restricted pair-denial key while either identity remains; remove personal payload and joins on schedule. Once both identities and all restore risk are gone, the old pair cannot be recreated because its IDs cannot return. New-account evasion remains a reviewed safety risk, not an excuse for biometrics/contact ingestion or indefinite unrestricted records. Tombstones survive until covered copies are verified expired. | Spec P5/P10/P20/P22; I-05/I-18; retention/legal review before M5    |
| DEC-008 | Paused messaging is optional in the spec; other prompts can imply total suspension.                                     | Pause blocks new discovery and Go. M1 offers an explicit retain-existing-chat choice and retained-plan reminder preference. Cancellation, exit, block/report and appeal remain available.                                                                                                                                                                                                                                                                                                 | Spec P5; I-13                                                       |
| DEC-009 | Under21 members and alcohol-first venues.                                                                               | The founder's requested product rule excludes alcohol-primary venues for any pair with a member under21; every proposed venue must have a non-drinking option. This is a conservative product requirement, not a legal compliance assertion.                                                                                                                                                                                                                                              | Founder instruction; Spec P18; M4                                   |
| DEC-010 | Numeric defaults missing from the spec: exact morning, small-cell suppression, audit review interval.                   | Proposed local feedback hour10, minimum aggregate cell10, audit retention review every90days. Centralize and mark as M0 hypotheses. Do not turn review into an indefinite retention permission. Schedule/rate/idempotency windows not needed by M0 remain explicitly unresolved until their implementing milestone.                                                                                                                                                                       | Spec P17/P22/P26; founder review                                    |
| DEC-011 | Hard exclusion when a candidate's attribute is unknown.                                                                 | Unknown cannot satisfy a required known boundary. Members may explicitly choose a different setting; the allocator cannot impute or relax it. Strong/flexible unknowns are omitted from both heuristic numerator and denominator.                                                                                                                                                                                                                                                         | Spec P11/P12; M3                                                    |
| DEC-012 | Response extensions versus expiry and closed-pair permanence.                                                           | Only an explicit bounded policy may extend a still-live offer before expiry, with held capacity and updated version. Expired pairs remain closed; no unilateral resurrection or timer-refresh reward. Exact accommodation policy needs founder review in M3.                                                                                                                                                                                                                              | Spec P6; I-05/I-08/I-09                                             |
| DEC-013 | Append-only audit versus personal-data deletion.                                                                        | Use minimal opaque subject handles, action/purpose and request IDs; no narrative payload. Runtime cannot update/delete events. A separately audited retention/deletion principal can purge expired partitions and identity links subject to justified holds.                                                                                                                                                                                                                              | Spec P20/P22; I-18/I-20                                             |
| DEC-014 | Requirement to test every invariant versus M0 prohibition on product features.                                          | Map all invariants now and implement their tests in the assigned milestones. M0's safety-role probe demonstrates only the access foundation; no fake passing product invariant test or empty feature stub is added.                                                                                                                                                                                                                                                                       | M0 explicit scope; AGENTS §4/§7                                     |
| DEC-015 | Safety screens in M2 require chat/plans not built until M4.                                                             | M2 establishes reusable safety controls and context authorization; integrate each later surface with its reachability/race tests as that milestone adds it. A public pilot cannot launch between incomplete milestones.                                                                                                                                                                                                                                                                   | Spec P17/P20/P23; milestone dependency                              |
| DEC-016 | M0 environment lacks Docker and maps only UID0, so PostgreSQL cannot run as its required non-root service user.         | Supply a real Ubuntu native installer and Compose setup. Run database gates on real PostgreSQL16/PostGIS in GitHub CI. No SQLite/in-memory substitute and no fabricated local pass. CI failures remain blocking for merge.                                                                                                                                                                                                                                                                | AGENTS §3; environment evidence; M0 validation report               |
| DEC-017 | Latest stable Next/Vitest patches were younger than the24h dependency-age guard.                                        | Pin the preceding mature stable patch (Next16.4.1, Vitest5.0.4) and exact direct versions; lock transitive resolution. Upgrade deliberately after review. No stack change.                                                                                                                                                                                                                                                                                                                | Registry metadata checked2026-10-16; dependency hygiene             |
| DEC-018 | MinIO's latest release no longer has the old downloadable Linux binary endpoint.                                        | Build official release RELEASE.2025-10-15T17-29-55Z from pinned commit9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a in Compose/native setup. Mailpit v1.31.6 archive is checksum-verified.                                                                                                                                                                                                                                                                                                     | Official upstream release metadata; exact pins in scripts; dev only |
| DEC-019 | Product name and eight areas were not included in an exact filled-in M0 file.                                           | Use Meetwell as an explicitly provisional working name. Choose Lower East Side, East Village, Greenwich Village, Chelsea, Midtown, Upper West Side, Upper East Side and Harlem. Coordinates are approximate reference inputs, not validated routing data.                                                                                                                                                                                                                                 | Founder-supplied Claude plan; M0 permits chosen centroids           |
| DEC-020 | Safety schema readability vs operational staff and serving enforcement.                                                 | Only the case-authorized safety role reads narrative/evidence. Operator/admin roles receive no implicit safety membership. Serving uses a synchronized minimal deny projection; migration/break-glass capabilities are isolated from runtime and audited operationally.                                                                                                                                                                                                                   | Spec P20/P22; I-12/I-19/I-20                                        |

## Toolchain compatibility (DEC-021)

2026-10-16: Pin TypeScript 6.0.3, the latest stable 6.0 patch, because the current stable typescript-eslint 8.71.2 explicitly rejects TypeScript 7 and requires `<6.1.0`. This preserves strict TypeScript and a supported lint pipeline. Upgrade the compiler after the linter supports its API. Source: installed package peer requirements and official npm registry version metadata. Approve only the reviewed esbuild installer with pnpm's per-package build policy; do not enable arbitrary dependency scripts.

## Local recovery and Windows development (DEC-022)

2026-10-20: The founder selected `E:\Buisness\Dating_App` as the permanent local
checkout and authorized organizing and continuing the project locally and on GitHub.
Recover the unpublished M0 files from the previous chat's Git tree payload and final
patches. Preserve the existing repository specification and instructions. Re-run checks
locally; historical passes do not certify this checkout.

The Windows machine has Node/Git but no Docker or installed PostgreSQL/WSL distribution.
Add a project-local native Windows setup using official pinned PostgreSQL/PostGIS
binary distributions, a pinned Go compiler for the existing MinIO source build, and
Mailpit. Keep the apt-based Linux and Compose paths. This adds an installation method
without changing the specified database or application stack. Bind services to loopback,
use port 55432 to avoid the default database port, and preserve existing `.env` and data.
Checksums/provenance are documented in DEVELOPMENT_WINDOWS.md.

## Reproducible migrations and worker startup (DEC-023)

2026-10-20, Spec P22: Enforce LF text files so immutable migration hashes agree across
Windows/Linux. Close the dedicated migration session on every completion/failure,
releasing its advisory lock even when explicit unlock is impossible, and always close
the pool. Test concurrent replay, checksum drift, real durable jobs, and safety access
under every unrelated runtime role. Start the worker from the repository root so the
documented `.env` is loaded. Keep Next type generation and builds sequential.

The first real database run exposed pg-boss attempting `CREATE SCHEMA` with a
restricted role. Configure `createSchema: false` because migration 0001 already creates
the queue schema. Verify that real jobs execute while the worker still lacks database
CREATE privilege; do not fix initialization by widening runtime privileges.

## Authoritative source and local release gate (DEC-024)

2026-10-20, Spec P4/P22/P23/P31: The founder explicitly designated the supplied
67-page PDF as the main architecture and authorized justified improvements.
The supplied PDF and `docs/architecture-v0.2.pdf` are byte-identical (SHA-256
`c4c27ec3560cee9855d4129e06769e10330e87e0dff86935d4206740c77dd4a0`).
All 32 parts of the extracted text were read; the state-machine diagram (page 12)
and architecture diagram with its continuation (pages 61–62) were inspected visually.
Preserve the original PDF and text. The PDF governs if extraction differs.

M1 permits accounts only with explicit local/test mode and a loopback application
origin. The web server binds to loopback. Use synthetic data; production enrollment
remains disabled until safety, erasure/restore, operations and legal review are ready.
Development terms/privacy are versioned acknowledgements, not launch-ready legal
documents. Birth-date entry is self-asserted adult eligibility, not identity verification.

## Explicit preferences and state authority (DEC-025)

2026-10-20, Spec P4/P5/P11/P12: Use provisional, explicitly stated gender,
relationship intention/structure, smoking and interest options from
`packages/config/src/accounts.ts`. No attribute is inferred. Optional smoking
supports unknown; unknown fails a hard exclusion. Who-to-meet is a required
structural eligibility choice. Age, intention, structure and smoking expose all
three exact preference labels. Store immutable encrypted USER revisions, prior
version and future-introduction scope. Richer taxonomies need pilot review.

`app.members` owns account state/version/policy epoch; identity owns credentials,
birth date and consent. A single state authority avoids competing cross-schema
copies. Mutation receipts and row locks protect retries and racing edits.
Activation/resumption recheck age, profile/preferences and reviewed photos.
Removing any photo moves an active account back to onboarding, conservatively
requiring a fresh readiness check. Exit has no self-service restoration in M1.
Deletion immediately disables authority and revokes sessions; M5 performs erasure.

## Authentication, encryption and local adapters (DEC-026)

2026-10-20, Spec P8/P21/P22: Magic links are short-lived, single-use, browser-bound
and explicitly submitted after opening. Keep tokens in URL fragments to avoid
request/referrer logging. Pending email uses an encrypted identity outbox; failures
retry through pg-boss. SMTP retries may duplicate a generic email, never a login.
Optional resident passkeys require user verification and bound one-time challenges.
Sensitive operations require recent authentication. Active sessions can be inspected
and revoked. Passkey removal/recovery management remains a release-hardening item.

Use AES-256-GCM envelope encryption with random per-record data keys, separate
identity/profile/media wrapping keys, and authenticated row/field context. Lookup
tokens use a separate keyed HMAC; random session/link tokens are hashed. Generated
keys and role passwords stay only in ignored `.env`. These local keys are not a
production KMS or tested key-rotation deployment. MinIO and Mailpit are local adapters;
MinIO development root credentials are confined to loopback synthetic storage.
Production purpose-scoped object credentials, mail transport and key custody require
review before the local gate is changed.

New operational limits live in `packages/config/src/accounts.ts`; spec-supplied
numeric pilot hypotheses remain in `pilot.ts`. Dependency release-age enforcement
was retained: AWS S3 client 3.1152.0 was selected because 3.1153.0 was too new.

## Private media and staff controls (DEC-027)

2026-10-20, Spec P4/P20/P21/P22: Decode uploaded images, bound bytes/pixels,
reject animation, orient and re-encode to JPEG without metadata, then encrypt before
private S3 storage. Random object IDs never authorize retrieval. Owners may preview
their uploads; photo reviewers receive only the pending queue and audited reads.
Operators/admins may review; safety-reviewer status alone grants no photo access.
Audit-log reads require admin. Exited/restricted staff lose role authorization;
moderators cannot approve their own uploads. No public staff-assignment endpoint.

Real PostgreSQL tests showed media row locking requires UPDATE privilege.
Forward migration 0003 adds a narrow owner-media locking function instead of
granting the application role permission to approve photos. The removal function
can only mark REMOVED. Audit/preference/consent histories are append-only to runtime.
S3 write and database commit cannot be one transaction: ordinary failures compensate,
but a crash may leave an encrypted orphan. M5 must reconcile orphans and deletion.

## Verification scope and remaining gates (DEC-028)

2026-10-20: M1 tests use real PostgreSQL/PostGIS, a private test bucket, Mailpit,
synthetic images and Chromium's virtual authenticator. Scripted onboarding latency
does not measure human comprehension or moderation turnaround. Axe and keyboard/
mobile checks provide automated evidence, not a completed assistive-technology audit.
The full I-19 route matrix and I-20 case-access controls expand with later milestones.
No report, allocator, chat, plan, feedback, erasure job, event-Go or serving model
is claimed implemented by this milestone. Review and merge M1 before M2.

## Founder questions before live enrollment (still open)

1. Keep **Meetwell** as the working name, and keep all eight provisional areas? A narrower catchment may be easier to operate.
2. Confirm ages18–30 inclusive and the proposed policy when an active member turns31.
3. Who owns incident response, and what support hours can actually be staffed? Go remains off until this is resolved.
4. Which relationship intentions and structures are supported first, and which optional boundaries are appropriate for the pilot? Never infer these.
5. Are the repository and architecture intended to stay public? GitHub currently reports this repository as public; M0 contains source and synthetic test data only.
6. What production hosting, email and private object-storage providers will be reviewed later? No vendor commitment is made by development MinIO/Mailpit.
7. Who reviews privacy/retention and venue accessibility before live enrollment? Confirm case-hold and age-out decisions before implementation.

These questions do not block a synthetic scaffold. Unresolved operational choices block the relevant live feature, not reporting, cancellation or deletion access.
