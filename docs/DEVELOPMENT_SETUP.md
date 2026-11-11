# Development setup and continuity

Audit begun 2026-11-03; resumed 2026-11-11, America/Chicago. Decision: DEC-049.
This document describes development controls, not approval to launch.

## Authoritative checkout and app project

Use `E:\Buisness\Dating_App` on the founder's Windows PC. Its remote is
`https://github.com/abinabrahamColorado/Dating_App.git`. Other machines may clone
elsewhere; run commands from that clone's root. Do not copy the repository into
OneDrive or create a second working source of truth.

The sidebar project was corrected through **Project settings → Add folder →
Make primary → Save folders**. The supported project-list tool now reports
`E:\Buisness\Dating_App` and `isGitRepository: true` for the existing project ID.
The original empty OneDrive folder and existing chats/files are preserved.
The current chat retains its historical starting directory under
`C:\Users\abrah\Documents\Codex\2026-10-20\rem`. Development commands explicitly
use the authoritative checkout. The settings dialog initially loaded slowly and
then recovered; no internal app database was edited.

Use the supported app UI: open the project's **… → Project settings** (called
**Edit project** in the documentation), **Add folder**, select
`E:\Buisness\Dating_App`, then **Make primary** on that folder and save.
If the dialog stays stuck in a future session, close it and reopen the app after
the run finishes. Verify the primary path and Git repository recognition.
Do not remove chats or delete either older folder. New chats should start in the
primary folder; an existing chat's historical directory is not rewritten manually.
[Official project-folder behavior](https://learn.chatgpt.com/docs/projects).

## AI settings and task boundaries

The visible chat picker was verified as **GPT-6 Astra · Extra High**. It was not
changed. `.codex/config.toml` records `gpt-6-astra` and `xhigh` for trusted future
project sessions; the current chat's model picker can override defaults.
Use stronger reasoning or parallel work only for a clear benefit. Concurrent code
changes use separate worktrees; database/service ports and generated output must
also be isolated. Ordinary sequential tasks do not need extra agents.

Resume by reading `AGENTS.md`, the authoritative architecture PDF/extracted text,
`CODEX_PROMPTS.md`, `docs/DECISIONS.md`, and `docs/PROJECT_STATUS.md`.
No setting or green check overrides an explicit founder merge boundary.

## Reproducible commands

- Node **24.19.0** is pinned in `.node-version` and selected by both CI runners.
- Corepack **0.35.0** is installed locally and pinned in CI.
- `package.json` pins pnpm **12.11.2**. Use `corepack pnpm`; plain `pnpm` in this
  chat's PATH resolves to the bundled **11.25.0** fallback. No global PATH was changed.
- Install with `corepack pnpm install --frozen-lockfile`. Do not regenerate the
  committed lockfile unless an authorized dependency change needs it.
- `corepack pnpm check:toolchain` fails early for a different Node or pnpm version.
  `corepack pnpm check` invokes it before the existing sequential quality gates.
- Follow `docs/DEVELOPMENT_WINDOWS.md` for real PostgreSQL/PostGIS, MinIO and Mailpit.
  Start services before the check, stop them afterwards, and preserve local data.

The audit verified `.env`, `.local/`, `node_modules/`, `.next/` and test artifacts
are ignored. Only `.env.example` is tracked. Ignoring a file does not make its
contents safe to print or upload. Keep all development records synthetic.

## GitHub workflow and evidence

The repository is **public**, unchanged. `main` was verified at `010a80b`, with
`protected: false` and no repository rulesets. The connector can work with PRs but
cannot administer branch protections. Its successful CI check contexts are exactly
**verify**, **windows**, and **dev-services**, all produced by **GitHub Actions**
(integration ID 15368). Each appeared green in both PR and push runs for M4.

The authorized target configuration is prepared in
`docs/operations/main-ruleset.json`; this file alone does not activate protection.
The browser session was signed out, so activation requires repository-owner sign-in.

After sign-in, use repository **Settings → Rules → Rulesets → New branch ruleset**:

1. Name: **Protect main**; enforcement: **Active**; target: `main` only.
2. Keep the bypass list empty. Enable **Restrict deletions** and **Block force pushes**.
3. Enable **Require a pull request before merging** with **0 required approvals**.
   Allow **merge commits**. Do not require code-owner or last-push approval,
   linear history, signed commits or a merge queue.
4. Require **verify**, **windows**, and **dev-services**, selecting GitHub Actions
   as their source. Require the branch to be up to date before merging.
5. Save, then verify the active rules apply to `refs/heads/main` and that an open
   PR displays these required checks. Do not test by force-pushing/deleting main.

Zero required reviewers keeps a solo maintainer able to merge; founder approval
remains required by the project workflow. No bypass is needed for ordinary reviewed
merges. See [GitHub ruleset guidance](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

## Permissions recommendation

The current chat was verified as **Full access**, with shell approvals disabled.
Those settings have not been changed. Recommend **workspace access + Approve for me**
after correcting the primary folder, with the repository as the write root and
temporary/cache access needed by the supported runtime. This limits unrelated-file
writes while allowing ordinary edits/builds/tests within the project.

Package downloads, Git access, protected `.git` writes and local PostgreSQL/MinIO/
Mailpit/Playwright networking can need additional permission. Permit the required
loopback services and task-specific destinations when requested; do not grant all
drives or unrestricted network access merely to avoid an interruption. Workspace
mode is expected to support this workflow, but a full check under that mode must
verify Windows process/network behavior before claiming it proven.

In the composer permissions menu, check whether **Approve for me** is available.
It requires an interactive approval policy and an enforceable workspace boundary;
it cannot provide review while approvals are set to `never`. It may deny legitimate
operations or require human help. Computer Use and connector permissions are
separate. It does not replace founder approval for merging or deployment.
[Official automatic-review guidance](https://learn.chatgpt.com/docs/sandboxing/auto-review),
[workspace permission profiles](https://learn.chatgpt.com/docs/permissions).

## Milestone checkpoint and launch boundary

PR #6 merged at `010a80b` with green main CI. M4 PR #8 passed 127 local tests
and all six CI checks at `85761dd`. With explicit founder approval on 2026-11-11,
it merged at `cc6ecf1`. Main CI 42974176138 passed all three jobs.
This setup change is based on the merged M4 main baseline. Its full local
`corepack pnpm check` passed all 127 tests plus typecheck/lint/format/build;
frozen installation preserved the lockfile. The pinned Playwright browser was
reinstalled after its cache was missing. Local services were stopped afterwards.

Finish setup verification and the separate authorized security hardening PR.
Neither new PR may merge without founder approval. M5 is not authorized.
M5 retention/deletion/tombstone replay, staffed safety operations,
real venue review and release privacy/accessibility gates remain outstanding.
No real users, Go, deployment or algorithm research build card is authorized here.
