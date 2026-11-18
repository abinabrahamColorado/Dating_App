# Feedback, metrics and deletion operations

M5, Spec P13/P17/P22/P23/P26. Decisions DEC-055–058. Synthetic development only;
this runbook is not authorization to launch, promote a restore or enable Go.

## Member and operator flows

`/feedback` presents each due morning-after question once. Reviewing previous
meetings is explicit. Neither person's answer is disclosed; invitation is a
separate guarded chat action. The post-meeting safety and integrity links remain
independent of every answer. `/outcomes` handles separately consented follow-ups
and optional active-time counts. `/settings` offers success exit and deletion;
deletion signs out the member and opens `/deletion-receipt` using a private cookie.

`/ops/metrics` freezes new disjoint cohorts before observation. The worker
publishes suppressed aggregates with fixed denominators, exact definitions and
completeness. Small groups show insufficient evidence. The administrator's
readiness review expires and never changes release flags. `/ops/safety/retention`
is safety-role only, audits every row viewed, and records annual review and finite
case-specific holds. Normal operators cannot read safety narratives or hold
rationales. Do not use report counts as proof of harm or absence of harm.

## Worker and data inventory

Run `corepack pnpm worker` after local service setup. `feedback.maintain`,
`privacy.erase` and `metrics.refresh` run every five minutes;
`privacy.retain` runs hourly. Failed jobs have generic diagnostics without payloads.
Monitor queue failures and overdue deletion/review counts; a completion receipt
is written only after required cleanup succeeds.

| Store                           | Erasure / retention                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                        | Revoke sessions immediately; purge identity, consents, challenges, passkeys and keyed mail rows during erasure. Expired auth artifacts and counters expire separately.                         |
| Profiles/preferences            | Remove encrypted settings and all versions on account erasure. Flag inactive records for human review after the configured period.                                                             |
| Connections/plans               | Erase affected chats, planning preferences, options, versions and confirmations. Close opportunities and release capacity before removal.                                                      |
| Learning                        | Explicit separate exposure/decision, experience and logistics columns; no narrative, location, chat or audit demographics. Row TTLs and account erasure apply.                                 |
| Cohorts/metrics                 | Remove identity joins; preserve frozen enrollment count; invalidate and recompute aggregates. Suppress small cells and complements.                                                            |
| Media                           | Remove every object version and delete marker. Reconcile unreferenced objects after the operational grace period. Failed object cleanup keeps the job pending.                                 |
| Exports                         | Encrypted timestamped snapshots in the configured directory. Erasure and retention invalidate all copies in that directory, including a file left by a failed registry commit.                 |
| Safety                          | Isolated D9 case/appeal/hold records, annual review, 24 calendar months after closure and documented scoped holds. Serving receipts reveal no case-existence fact.                             |
| Audits                          | Preserve departing staff actor ID, action/time and opaque event/request IDs; clear optional subject links on their operator audit rows. Audit review remains explicit; case access follows D9. |
| Enforced rejoining              | Only existing keyed email lookup plus expiry in safety, for 24 calendar months from an enforced deletion request. No new denial for an unenforced member; expiry is not extended by retries.   |
| Pair denials                    | Minimal opaque keys while either identity remains, then through supported backup expiry. No reused identity IDs.                                                                               |
| CDN/cache/search/models/vendors | No public CDN, personal server cache, search index, model, embedding or identity vendor. Responses are no-store. Received external email cannot be recalled.                                   |

Raw application access/IP logs are not collected. Before hosting, configure
platform/framework/database log rotation and validate redaction; these external
logs cannot be governed by a development database job. Inactive and audit review
counts are stored in `ops.privacy_reviews` for the assigned operational owner;
do not leave an overdue review unowned or invent an indefinite blanket exception.

## Independent artifacts

`setup:accounts` generates a separate `LIFECYCLE_ENCRYPTION_KEY` and initializes
ignored local directories. It never prints the key. Keep that key recoverable
outside backups. Defaults are `.local/privacy/journal`, `.local/privacy/exports`
and `.local/privacy/backups`. Hosting must explicitly provision independent,
durable access-controlled storage and custody; same-host local files are not
off-host disaster recovery. Never nest the journal inside the export directory.
Git ignores backup, snapshot and journal artifacts even if their configured
directory is changed; this is an extra guard, not a substitute for custody controls.

```powershell
Set-Location E:\Buisness\Dating_App
corepack pnpm privacy:journal
corepack pnpm learning:export
```

The journal command verifies authenticated entries and prints only a count and
digest. Export refuses while deletion requests are pending and encrypts a
timestamped allowlisted snapshot. Do not copy decrypted snapshots elsewhere.
Any separately approved export recipient must join the deletion inventory first.
The pilot limit is 256 MiB; no learned model is trained or served.

For a new provisioned environment only, `privacy:journal --initialize` creates a
new authenticated journal. Never initialize over a lost journal to make an existing
service appear recoverable. Missing, corrupt or mismatched tombstones fail closed.
Keep minimal tombstones until the operations owner verifies coverage/expiry of
every supported backup and media copy; pruning is an explicit reviewed operation.

## Restore drill and release boundary

Use [backup and restore](backup-restore.md). Freeze the source before copying its
latest independent journal and recording its verified digest. Restore only into
a fresh `meetwell_restore_…` target. Set operator-only `RESTORE_DATABASE_URL` to
that target, recover the original application and lifecycle keys separately, and
point media cleanup at the corresponding private storage inventory.
Set operator-only `SAFETY_RESTORE_SOURCE_DATABASE_URL` to the frozen, independently
verified current safety database. It supplies the minimal email denial set with
original expiries; an old archive or the target itself cannot supply current
enforcement. Without recoverable current safety state, leave the target offline.

```powershell
corepack pnpm db:release-restore <independently-verified-current-journal-digest>
```

This replays erasure before writing database readiness. A changed digest, missing
journal, missing/changing safety source, failed purge or pending job leaves the target quarantined. Test readiness,
schema checksums, role isolation, deleted canaries and media recovery. Keep workers
off during a drill to avoid replaying external mail. Founder approval is still
required before traffic changes. A failure must never lead to bypassing readiness
or restoring the attestation row manually.

Before real users, the founder must assign legal/privacy review and incident
owners, approve retention/hold handling, choose hosting and independent journal,
backup/media/key custody, define RPO/RTO and drill frequency, and review the pilot
thresholds and staffed support promises. Monitoring remains the self-hosted Uptime
Kuma plan; no external vendor integration was added.
