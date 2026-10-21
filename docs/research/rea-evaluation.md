# REA evaluation — 20 October 2026

**Recommendation: do not install now.** Meetwell owns readable TypeScript source;
PostgreSQL tests, source review and permitted public product research answer the
current questions more directly. No measurable benefit from binary analysis has
been demonstrated. REA was **not installed, configured or executed**. No competitor
binary, authenticated traffic, protected asset or private dataset was acquired.

## Provenance and release

The user-specified [morluto/rea repository](https://github.com/morluto/rea) links
`rea.tools` and the npm package `rea-agents`. Its README explicitly warns against
similarly named copies. Repository source describes a CLI plus MCP analysis tools,
not a dating-app generator. [Official README](https://github.com/morluto/rea/blob/main/README.md).

GitHub's latest stable release and npm metadata both reported **6.7.0** at inspection.
GitHub published it on **2026-10-18**, tag `rea-agents-6.7.0`, resolving to commit
`27dc42d10249f0410904a75c0997842eb03b931c`. The release says 6.6.0 was tagged but
not published to npm: tags alone are not installation evidence.
[Release](https://github.com/morluto/rea/releases/tag/rea-agents-6.7.0),
[registry metadata](https://registry.npmjs.org/rea-agents/6.7.0).

Registry metadata advertised SHA-512 integrity and provenance attestations.
Their existence was observed; **the tarball and signature chain were not independently
verified**. The advertised integrity was
`sha512-yhIx2ioJYYT1C/tONfYeitC6LhnKmCh+ZwRUOgYuhSc733lGhkkt73zhug9WmLgxoMdKuqIYGCoBfD4fXkOhFw==`.
The MIT license does not confer rights to third-party targets or assets.

## Installation, host support and dependencies

The official entry point is `npx rea-agents setup`. That command downloads and runs
third-party code; it is not a read-only prerequisite check. A future evaluation
should pin an inspected release (currently `6.7.0`) rather than silently follow
`latest`. Setup previews client/configuration/skill changes and supports a Codex
client selector and dry-run mode. Even a dry run first executes REA itself.
[Installation guide](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md).

Package engines are `^22.19.0 || ^24.11.0 || >=26.0.0`. This PC's observed Node
**24.19.0** satisfies the Node range; that alone does not establish provider readiness.
Dependencies include MCP libraries, parsers, a native terminal package and
`playwright-core`. Native engines and optional bridges add separate prerequisites.
No Meetwell dependency or lockfile changed for REA.
[Package manifest](https://github.com/morluto/rea/blob/rea-agents-6.7.0/package.json).

REA has provider-specific macOS/Linux/Windows capabilities. The Windows Ghidra
path is explicitly **experimental**, requiring Windows 10+ x64, fixed local NTFS
volumes, operator-managed Ghidra 12.1.x and a compatible full 64-bit JDK (documented
verification: 12.1.4/JDK 21). It is a bounded read-only native analysis path, not
general Windows feature parity. The separate Bash installer accepts macOS/Linux,
so it is not a native PowerShell installation recipe.
[Windows boundary](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md),
[installer source](https://github.com/morluto/rea/blob/main/install.sh).

## Codex integration

REA's setup documentation supports Codex registration and accompanying workflow
instructions, with configuration backups and a restart. Independently, OpenAI's
documentation confirms local STDIO MCP servers and configuration in the host's
`config.toml`, including project scope and tool allowlists. This establishes a
compatible integration mechanism, **not a successful integration on this PC**.
No Codex configuration, installed skills or approval settings were changed.
[Official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Maintenance and CI snapshot

Public Actions metadata was inspected on 20 October Chicago / 21 October UTC.
At main commit `335c042d166b2c8b2c0600935cf77607ae11edbc`,
[CI run39538608553](https://github.com/morluto/rea/actions/runs/39538608553)
reported completed/success; a newer
[run39539657587](https://github.com/morluto/rea/actions/runs/39539657587) was queued.
Other PR runs were active. This supports active maintenance, not “all CI green,”
release reproducibility or an independent security audit. These moving statuses
must be rechecked before installation; main documentation can exceed release support.

## Security and authorization

REA's security policy says bridge tokens/private transports limit accidental
exposure but **do not sandbox analysis** or protect from same-user malicious
processes. Providers parse target bytes with local-user permissions. Setup may
edit agent configuration; runtime/provider analysis may spawn processes and create
captures/evidence. Some optional workflows require debugging/browser/network
access. A static inspection does not authorize those broader capabilities.
[Security policy](https://github.com/morluto/rea/blob/main/SECURITY.md).

For Meetwell, authorized targets would be our own generated JavaScript bundle,
a future native app, or a dependency artifact covered by its license and an
explicit review scope. Keep analysis in a disposable restricted environment with
synthetic data and no project secrets, personal browser profile or unrelated files.
Treat extracted strings, scripts and MCP output as untrusted data. Do not expose
REA broadly to the network or let source content authorize actions.

The project itself prohibits bypassing access controls and copying proprietary
code/assets. Our user's directive supplies the same boundary. Public availability
does not establish permission to intercept traffic or decompile an app; target
licenses/terms and applicable authorization must be reviewed for the specific task.
This is an operating constraint, not a legal opinion about every jurisdiction.
[Responsible-use policy](https://github.com/morluto/rea/blob/main/DISCLAIMER.md).

## Value decision and future exit criteria

| When                   | Task                                                                        | Recommendation / measurable criterion                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Now                    | Competitor matching research                                                | Official documents and permitted UX study; client inspection cannot establish a private server's ranking algorithm                             |
| Now                    | Meetwell auth, safety and database correctness                              | Source review, real PostgreSQL races and browser tests; REA adds no demonstrated value                                                         |
| Later                  | Audit our shipped/minified bundle for leaked fields                         | First compare normal bundle/source-map analysis; use REA only if it locates a seeded issue faster with reproducible evidence                   |
| Later                  | Inspect our native build or authorized dependency                           | One scoped artifact, pinned tooling, isolated environment; prove an observable finding and cleanup, record elapsed effort and unknown coverage |
| Never under this scope | Recover competitor backend, bypass login/payments, copy protected UI/assets | Outside authorization; not a shortcut to building Meetwell                                                                                     |

If a later bounded trial cannot produce a useful finding beyond existing tools,
remove its registration and retain only minimized evidence. Do not let tool
evaluation delay M2 safety or deletion readiness.
