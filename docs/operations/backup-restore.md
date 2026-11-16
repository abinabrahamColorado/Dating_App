# Encrypted database backup and isolated restore

DEC-051; Spec P22. These are operator tools for synthetic development and recovery
drills. They do not implement M5 deletion tombstones or authorize real enrollment.
Never point web/worker processes at a restored database until deletion replay and
the release review are implemented and approved.

## Requirements and custody

- Use the documented Node version and `corepack pnpm` from the repository root.
- Install PostgreSQL 16 `pg_dump` and `pg_restore`; set `PG_BIN_DIR` if not on PATH.
  Windows uses the existing project-local `.local/tools/pgsql/bin` by default.
- Supply `BACKUP_DATABASE_URL` to a dedicated operator process with the privileges
  to read all required schemas. Do not grant these privileges to runtime roles.
- Generate a separate cryptographically random 32-byte base64
  `BACKUP_ENCRYPTION_KEY` and retain it in the operator's approved secret store,
  separately from the archives. Never use an example or reuse an application key.
  Supply credentials through process environment or an ignored, access-restricted
  local `.env`, not command-line arguments, source control or chat.
- Restore requires `RESTORE_CLUSTER_URL` with CREATE DATABASE and the privileges
  needed to install the restored schema/extensions/grants. Use an isolated cluster
  with no running app/worker. Provision the six `meetwell_identity`, `meetwell_app`,
  `meetwell_safety`, `meetwell_learning`, `meetwell_ops`, `meetwell_worker` group
  roles with NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION,
  NOBYPASSRLS. The tool rejects missing or overpowered groups. `pg_dump` does not
  include cluster logins or passwords. Provision login membership separately.
- Use the same reviewed migration-owner role on the restore cluster: dump ACLs and
  default privileges can refer to it. `--no-owner` makes restored objects owned by
  the restore operator. Verify role membership, grants and future migration default
  privileges before promotion; a database dump is not a cluster-security backup.

## Commands

After the variables above are supplied securely, choose a new archive filename:

```powershell
Set-Location E:\Buisness\Dating_App
corepack pnpm db:backup E:\Buisness\Dating_App\.local\recovery-drill.mwbackup
corepack pnpm db:restore E:\Buisness\Dating_App\.local\recovery-drill.mwbackup
```

Backup refuses to overwrite an existing path. The PostgreSQL custom archive is
encrypted in full with AES-256-GCM and an authenticated version header. No plaintext
dump is written to disk. The pilot limit is 256 MiB of compressed dump, held in
memory; larger databases need a reviewed streaming/container format. Protect
process memory, swap and crash dumps as well as keys. POSIX file mode is 0600;
Windows operators must verify the destination directory ACL themselves.

Restore authenticates the complete archive before creating a database or running
SQL. It always generates a new `meetwell_restore_<random UUID>` database using
`template0`, then restores in one transaction. It has no overwrite, clean, drop or
promotion option. Tampered archives/wrong keys fail without creating a target.
Other failures can leave an empty generated database: quarantine it for review.
The source database is never changed. Credentials/dump text are not logged.

Only restore trusted archives: authenticated database archives can contain SQL.
Do not run a drill against a live cluster. Outside loopback development, use a
reviewed authenticated TLS connection (`sslmode=verify-full` and configured trust)
and private network access. The tool is not a substitute for network policy.

## Verify before any promotion

1. Keep the recovered database offline from application traffic.
2. Check migration ledger checksums, expected schemas, row counts and a controlled
   decryption sample using separately recovered application keys.
3. Prove app/learning roles still cannot read safety records; audit grants and
   restore operator privileges. Do not put operator credentials into the app.
4. Reapply deletion tombstones and retention/legal-hold decisions before serving
   requests. **This M5 path is not built; production promotion is currently blocked.**
5. Reconcile separately backed-up encrypted media and queue/outbox state. Starting
   a worker can repeat previously sent notifications; do not start it during a drill.
6. Require the founder's release approval after the operational/privacy gates pass.

`tests/integration/backup-restore.test.ts` performs a real PostgreSQL fresh-database
restore, checks encrypted synthetic content and the immutable migration ledger,
checks safety-role access/app-and-learning denial, and tests wrong-key/tamper
failure before database creation. Fixtures alone are deleted by the test.

The database archive includes stored queues and encrypted columns, but not S3
objects, process secrets, encryption keys, external tombstone archives or cluster
configuration. Before launch, the founder and operations owner must choose storage,
off-host copies, schedule, RPO/RTO, alert ownership and restore-drill frequency.
Spec D14 backup expiry and deletion replay are M5 work; no automatic retention or
legal-hold policy is introduced here. Losing the separate key makes an archive
unrecoverable. The committed ignore rule excludes `*.mwbackup` from Git.
