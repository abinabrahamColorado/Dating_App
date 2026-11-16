# Connections and meeting coordination

M4 implements Spec P6/P18. It remains a synthetic, loopback-only preview. Real
enrollment is closed. See DEC-046–048 and the M4 PR for verification evidence.

Run `corepack pnpm setup:accounts` to apply migration 0013 to the local development
and test databases. Start web and worker as documented in DEVELOPMENT_WINDOWS.md.
Worker queues `connections.deliver` and `connections.maintain` carry no personal
data; they sweep durable rows and recheck current authorization.

An operator or administrator opens `/ops/venues`, enters all review fields and
explicitly confirms a human review before approval. Public coordinates refer only
to the public venue entrance. The old M3 feasibility seed is insufficient for M4
suggestions. Venue staff contacts, training and operational complaints stay in
the encrypted operator store; member narratives belong in the safety console.

The venue ID shown in the operator list can be used in `/ops/safety` by a safety
reviewer to disable a venue immediately. Disabling removes it from suggestions
and invalidates future plans, including plans already confirmed. Any venue edit
also invalidates affected plans. Lifting a switch never restores old consent.
Members must choose a current venue/time and both confirm again.

Mutual introduction cards link to `/connections/<id>`. Messaging is optional.
Members can edit their own meeting requirements, choose a shared time, inspect
the reviewed public choices and propose a plan. A change creates a new revision;
both confirmations must reference that revision. No decline/cancel reason is
required. Capacity remains the connection's single held slot until private closure.

Plan pages offer calendar download, voluntary minimal sharing and the three
manual messages. Chat and plan pages always link to "Something felt off" and
public help, including after closure. The counterpart sees only the neutral ended
state after closure/block; no block or report reason is disclosed.

Operators must never edit plan confirmations to repair an invalidated plan. Do
not restore venue approval or old choices to bypass a member's current boundary.
Use a new proposal with both confirmations. An archive suggestion does not close
a connection or label either person's intentions.

Chat text is encrypted and never sent to learning, analytics, queue payloads or
logs. Production key isolation and D11/D12 erasure/retention remain release gates;
M4 does not claim those later milestones complete. Already downloaded calendars
or voluntarily shared text cannot be recalled by the app.
