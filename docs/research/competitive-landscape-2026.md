# Competitive landscape — 20 October 2026

Status: research evidence and experiment hypotheses, **not approved product changes**.
Baseline: authoritative architecture v0.2, P3, checked 11 October 2026. This review
updates the relevant product descriptions; it does not replace the PDF.

## Method and evidence limits

All links below were checked on **2026-10-20, America/Chicago** (some retrievals
occurred on 21 October UTC). `C` means a company describes a feature; `O` means
public documentation or metadata was observed; `I` means our engineering inference;
`U` means unresolved. Observing a published claim is not independently verifying
its implementation, safety, ranking quality, adoption, or causal outcomes.
No authenticated competitor account, payment, app binary, private API, user dataset,
or proprietary model was inspected. No independent outcome study was established
for any product in this review. Prices, city inventory and experiments vary by
market; lack of documentation is not proof a feature does not exist.

“Reciprocal” below separates **mutual consent to connect** from **bilateral eligibility
before exposure**. They are different requirements. A mutual-like interface does
not prove atomic capacity reservations, permanent pair closure, or blind decisions.

## Product dossiers

### Breeze — closest Explore comparison

- **Audience/markets (C):** dating oriented toward actual meetings. Its city directory
  explicitly includes New York City, alongside markets in the UK, Netherlands,
  Belgium, France, Germany and Ireland. NYC neighborhood liquidity is U.
  [City directory](https://www.breeze.social/about).
- **Discovery/reciprocity/cadence (C):** a small daily selection, mutual match, then
  coordinated date. Exact per-person count is variable. **Communication/logistics:**
  availability collection, partner-bar reservation and final confirmation; logistical
  chat opens four hours before the date for five hours. **Revenue:** date tokens.
  **Safety/feedback:** private contact blocking, venue staff assistance, post-date
  feedback and mutually agreed number exchange. Cancellation/replanning can cost
  tokens or account standing. [FAQ](https://www.breeze.social/faq).
- **Published ranking model (C):** hard filters, one optional additional dealbreaker,
  interaction/profile inputs and predictions in both directions. It describes
  travel-related features, numerical representations of profile text, and popularity
  signals for cold starts. It can resurface a declined profile once and supports a
  history reset. Selection volume varies with liking behavior and available supply.
  These are disclosed mechanisms, **not recovered code or verified model weights**.
  [Recommender explanation](https://www.breeze.social/en/recommender-explanation).
- **Location/privacy/verification (C):** policy lists GPS, preferred dating cities,
  availability, communications, date feedback and selfie-verification data; it
  describes biometric consent and data processors. This is materially different
  from collecting no precise location. [Privacy statement](https://www.breeze.social/privacy).
- **UX/strengths (I):** a legible next step and operational ownership of booking can
  reduce scheduling effort. **Weaknesses/risks (I):** late chat can restrict time to
  ask questions; penalties can discourage voluntary cancellation; venue staffing
  and availability become core product dependencies. These are hypotheses, not
  measured user harm or performance claims.
- **Meetwell overlap:** finite introductions, reciprocal interest, feasibility,
  public venues and feedback. **Potential difference:** multiple explicit active
  hard boundaries, permanent closed pairs, blind decisions and versioned joint
  plans. Different policy is not automatically a better outcome.
- **Evidence/unknowns:** O = documents read; C = operation as described; independent
  outcome verification = none. U = actual model/objective implementation, full
  bilateral hard-filter enforcement, exposure distribution, NYC support capacity,
  cancellation exceptions, marginal coordination cost and measured meeting quality.

### Thursday

- **Positioning/audience/markets (C):** singles meeting through events in cities
  internationally; the current site emphasizes bookable bars, dinners and trips.
  Do not describe today's product solely as an old one-day swipe app. Exact live
  NYC inventory was not purchased or tested. [Current product](https://www.thursday.com/).
- **Discovery/reciprocity/cadence:** event selection and attendance, with recurring
  weekly positioning; number of personal introductions is not specified. No
  pairwise romantic agreement follows from buying a ticket (I).
- **Messaging/coordination/venues:** the event supplies place/time; current site
  does not establish a universal private-chat or individualized matching contract (U).
  **Revenue/UX:** ticketed experiences and a short city → booking → attendance flow (C).
- **Privacy/verification/safety:** an official incident policy describes reporting
  and handling event misconduct. Its indexed text was available, but opening it
  redirected to an unrendered page; precise location collection, mandatory identity
  checks and venue-level staffing remain U.
  [Incident policy](https://www.getthursday.com/issue-at-an-event),
  [published privacy notice](https://events.getthursday.com/privacy-policy/).
- **Strength/weakness/overlap (I):** concentrated availability can solve a local
  coordination problem; attendance balance and host quality can dominate results.
  Relevant to event Go, not proof of individual reciprocal eligibility.
- **Evidence:** O public site/indexed policy; C features; independent outcomes none.
  U includes attendee mix, privacy behavior in-app and cancellation economics.

### Timeleft

- **Positioning/audience/markets (C):** friendship and social gatherings rather than
  romantic pair matching; company describes a multinational city network.
  A quiz and chosen city/date/format feed groups of roughly four to six.
  [Matching explanation, 18 September 2026](https://timeleft.com/blog/how-timeleft-matches-you/).
- **Reciprocity/cadence:** participants choose an event, not each tablemate. Age
  grouping is approximate; gender ratio is not selectable and availability can
  broaden the mix. This must not be copied as a romantic hard-boundary policy.
  [Matching help](https://help.timeleft.com/hc/en-150/articles/28530361837212-How-Does-Timeleft-Match-Me-With-a-Group).
- **Communication/meeting/venue/UX (C):** coordinated venue and timing, followed by
  Connect, Repeat and + 1 functions for continued friendship. Specific mutual
  authorization semantics of Connect were not tested.
  [Product description](https://timeleft.com/about/).
- **Revenue/privacy/safety (C/U):** subscription-based access, food/drink separately;
  published US pricing is market-specific. Public venues and reporting are described;
  no universal identity-verification guarantee was established. Fine-grained device
  location retention remains U.
  [How it works](https://www.timeleft.com/blog/how-does-timeleft-work/),
  [Community guidelines](https://www.timeleft.com/community-guidelines/).
- **Strength/weakness/overlap (I):** logistics ownership and repeat encounters are
  useful references; cancellations can destabilize a group. Meetwell should learn
  venue operations without treating a group booking as dating consent.
- **Evidence:** O documents; C matching/safety/outcome assertions; independent
  outcomes none. Company incident percentages lack an independently checked
  denominator here and are not adopted as evidence of safety. Model weights,
  local staffing, exclusions and unit economics remain U.

### Hinge

- **Positioning/audience/markets:** relationship-oriented dating; US-facing support
  and international localized documentation observed. Full current country list U.
  **Discovery/reciprocity/cadence (C):** Discover plus a Most Compatible suggestion,
  attempted daily when available, using mutual preferences and interaction patterns.
  That suggestion expires in 24 hours; it is not a strict cap on all discovery.
  [Most Compatible, 27 July 2026](https://help.hinge.co/hc/en-us/articles/360011233073-What-is-Most-Compatible).
- **Communication/UX (C):** Your Turn Limits restricts new likes when too many
  conversations await a reply. Exact current threshold is U.
  [Your Turn Limits](https://help.hinge.co/hc/en-us/articles/31662181659027-What-is-Your-Turn-Limits).
- **Meeting/venue/feedback:** private We Met asks about meeting and interest in
  another date, and can route reports. A venue-booking or same-version bilateral
  plan guarantee was not established.
  [We Met, 22 January 2026](https://help.hinge.co/hc/en-us/articles/360010692913-What-is-We-Met).
- **Privacy/safety/verification (C):** video-selfie verification; required Face Check
  varies by region. A badge does not establish safety. Location processing was not
  fully audited. [Verification](https://help.hinge.co/hc/en-us/articles/10303221435539-What-is-Selfie-Verification).
- **Revenue:** paid subscriber experiences appear in official support; local pricing
  and current entitlement matrix U. **Strength/weakness/overlap (I):** prompts,
  attention limits and private outcomes are strong reference patterns; chat still
  requires coordination. None is a novel Meetwell invention.
- **Evidence:** O help pages; C behavior; independent outcomes none. U = algorithm,
  real enforcement of all reciprocal constraints, local pricing and booking coverage.

### Tinder

- **Positioning/audience/markets (C):** broad adult dating across many markets.
  **Discovery/cadence:** the March product announcement describes curated daily
  Chemistry recommendations alongside other modes; it is not evidence of universal
  rollout or removal of the broader discovery flow. **Reciprocity:** mutual matching
  is the ordinary connection model; full bilateral eligibility U.
  [Tinder Sparks, 12 March 2026](https://www.tinderpressroom.com/2026-03-12-Tinder-Debuts-Inaugural-Product-Keynote-Tinder-Sparks-2026-Start-Something-New).
- **Messaging/meetings/venues:** messaging and group/date modes exist in support;
  Share My Date distributes member-entered plan details. This is not a confirmed
  reservation or both-parties agreement.
  [Product guide](https://www.help.tinder.com/hc/en-gb/categories/115000755686-A-guide-to-Tinder),
  [Share My Date](https://www.tinderpressroom.com/2024-04-22-SHORTCUT-YOUR-DATING-ADMIN-THANKS-TO-TINDERS-SHARE-MY-DATE).
- **Location/privacy/revenue (C):** Passport permits chosen cities/pins and is sold
  separately or within subscriptions. Precise retention was not audited.
  [Passport, 1 September 2026](https://www.help.tinder.com/hc/en-us/articles/115004490423-Passport-Mode).
- **Safety/verification:** Face Check and conversation interventions are described
  with rollout qualifications. [Dated feature sheet](https://www.tinderpressroom.com/image/Tinder_Sparks_Feature_Cheat_Sheet_vF.pdf).
- **UX/strengths/weaknesses/overlap (I):** familiar consent-to-chat and plan sharing
  are useful baselines; optional camera-roll inference is outside Meetwell's scope.
  Daily curation is already part of incumbent product strategy.
- **Evidence:** O official documents; C launches/feature claims; independent
  outcomes none. U = per-account availability, model weights, local active supply,
  meeting conversion and whether all stated boundaries are hard gates.

### Bumble

- **Positioning/audience/markets:** adult dating with differentiated conversation
  controls; international support with regional exceptions, exact coverage U.
  **Discovery/cadence (C):** Discover documentation describes a 9am refresh and four
  highlighted recommendations. This does not establish a product-wide finite cap.
  [Discover, 31 March 2026](https://support.bumble.com/hc/articles/28423668110621-Using-the-Discover-tab).
- **Reciprocity/messaging:** Opening Moves permits replies regardless of whose turn
  it is; California has a distinct requirement. Avoid the universal “women always
  message first” shorthand. [Opening Moves, 1 April 2026](https://support.bumble.com/hc/articles/28776942830365-Setting-Opening-Moves).
- **Meeting/venues:** a universal booking workflow was not established (U).
  **Privacy/location:** Incognito is described as hiding location/limiting visibility;
  backend location processing and deletion behavior remain U.
  [Profile controls](https://support.bumble.com/hc/sections/28055400878877-Profile-setup-and-editing).
- **Verification/safety (C):** photo/ID verification and explicit-image blurring.
  [Safety center](https://safety.bumble.com/en_US).
  **Revenue/UX:** subscriptions and Spotlight paid reach are documented.
  [Paid visibility](https://support.bumble.com/hc/articles/28938370080925-Standing-out-on-Bumble).
- **Strength/weakness/overlap (I):** explicit conversation choices and reporting
  affordances matter; paid reach conflicts with Meetwell's exposure policy.
  Evolving features require market-specific checks before drawing UX conclusions.
- **Evidence:** O support; C features; independent outcomes none. U = announced
  redesign rollout, backend eligibility, booking adoption and city-level outcomes.

### Coffee Meets Bagel

- **Positioning/audience/markets (C):** relationship-focused dating, with separate
  US/Canada and Worldwide apps/support. Do not transplant Worldwide entitlements
  into the Manhattan benchmark without testing.
  [US/Canada introduction](https://coffeemeetsbagel.zendesk.com/hc/en-us/articles/360019599254-What-is-Coffee-Meets-Bagel).
- **Discovery/reciprocity/cadence:** daily noon Suggested batch, mutual connection,
  additional Discover and Likes You. No universal fixed daily count established.
  **Revenue/UX:** Worldwide Premium/Platinum expands supply and visibility; core
  matching/chat is described as free.
  [Subscription description, 17 August 2026](https://help.ww.coffeemeetsbagel.com/hc/en-us/articles/37686466167315-What-s-included-in-CMB-Premium-and-Platinum-subscriptions).
- **Messaging/meeting/venue:** Worldwide help describes a seven-day chat timer with
  continuation when both message recently; paid reopening is available. Venue
  reservations and joint plan versioning U.
  [Chat expiry, 30 July 2026](https://help.ww.coffeemeetsbagel.com/hc/en-us/articles/33825542408339-How-do-I-extend-a-chat).
- **Location/privacy/safety (C):** US policy describes permission-based GPS and
  usage information; mandatory verification coverage U. Worldwide guidelines
  describe reporting and bans.
  [US privacy](https://www.coffeemeetsbagel.com/privacy),
  [Guidelines](https://help.ww.coffeemeetsbagel.com/hc/en-us/articles/53244233680915-Coffee-Meets-Bagel-Community-Guidelines).
- **Strength/weakness/overlap (I):** predictable batches are useful; paid expansion
  means “finite” is not necessarily a uniform attention policy. Chat timers can
  pressure activity rather than validate feasible meetings.
- **Evidence:** O documents; C behavior; independent outcomes none. U = exact
  local counts, regional parity, reciprocal constraint guarantees and model quality.

### Happn

- **Positioning/audience/markets:** local dating through crossed paths; worldwide
  positioning, exact current city/age inventory U. **Discovery/cadence:** geography
  and shared places, not a documented finite batch. **Reciprocity/messaging (C):**
  Crush interactions, pre-match FlashNotes and calls are described; full bilateral
  hard-boundary enforcement U.
  [Premium features](https://info.happn.com/onboarding_premium_en).
- **Location/privacy (C):** claims to conceal another person's current position,
  while retaining crossing points and geolocation. Hiding a location is not the
  same as never collecting it.
  [Data explanation](https://www.happn.com/article/your-data-your-love-life),
  [Trust charter](https://www.happn.com/legal/trust-charter).
- **Meetings/venues:** CrushPoints adds shared favorite venues; a venue suggestion
  is not a mutually confirmed reservation.
  [CrushPoints, 29 November 2024](https://www.happn.com/press/happn-is-incorporating-over-20-million-locations-into-its-crushpoints-feature).
- **Safety/verification/revenue:** blocking and trust commitments are described;
  exact compulsory identity checks U. Premium sells additional features.
- **UX/strengths/weaknesses/overlap (I):** shared public context can start a
  conversation; crossing histories increase inference risk. Meetwell can use
  venue context while prohibiting person-location histories.
- **Evidence:** O pages; C handling claims; independent outcomes none. U = current
  implementation of spatial obfuscation, regional retention changes and actual
  meeting outcomes. This review did not probe location endpoints.

### The League

- **Positioning/audience/markets (C):** curated dating marketed to busy, ambitious
  adults; US metros and international cities. **Discovery/reciprocity/cadence:**
  5pm local batches; company says preferences are considered in both directions.
  Counts depend on subscription, available pool and preferences, not a universal
  three- or five-person guarantee.
- **Messaging/meeting/venue:** matching/chat are supported; concierge assistance
  is described, but guaranteed venue booking and shared plan versioning remain U.
  **Privacy/verification:** LinkedIn or alternative education/work verification;
  coworker hiding is described. Device-location retention U.
- **Revenue/UX (C):** membership tiers, curated batches and application gating;
  its FAQ describes reduced priority for non-communication and a flakiness score.
  [Current FAQ](https://www.theleague.com/faqs-en/).
- **Strength/weakness/overlap (I):** finite presentation and reciprocal selection
  are relevant. Status screening and engagement-based penalties conflict with an
  inclusive service where rejecting, pausing and leaving are legitimate.
- **Evidence:** O FAQ; C operational claims; independent outcomes none.
  U = screening accuracy, mandatory safety checks, exact ranking, local pricing,
  staffing and which concierge services actually operate in NYC.

### Meetup

- **Positioning/audience/markets (C):** international interest-based groups and
  events, including friendship/community activities. **Discovery/cadence:** search
  by interest and place, recurring organizer calendars; no fixed introduction
  count or romantic reciprocity contract.
  [Current product](https://www.meetup.com/).
- **Messaging/meeting/venues:** messaging/event chats and organizer-selected time
  and venue. **Location/privacy (C):** current policy includes GPS where enabled,
  visible group memberships and participation data; organizers may process data
  independently. **Safety:** reporting/moderation is described; universal identity
  verification or venue inspection is not established.
  [Current privacy policy](https://help.meetup.com/hc/en-us/articles/360044422391-Privacy-Policy).
- **Revenue/UX:** organizer-managed group dues and event fees; exact platform
  subscription rates U. [Group charges](https://help.meetup.com/hc/en-us/articles/39238167287053-Why-was-I-charged-by-a-Meetup-group-How-to-stop-charges-or-request-a-refund).
- **Strength/weakness/overlap (I):** recurring shared context and organizer tools
  are useful; quality varies with hosts, and an RSVP can reveal sensitive interests.
  Never import attendees into Meetwell dating discovery without separate opt-in.
- **Evidence:** O product/current policy; C operation; independent outcomes none.
  U = organizer quality, moderation response times and local attendance reliability.
  The search-indexed 2023 policy was explicitly outdated and was replaced in this
  analysis by its linked current version.

### Eventbrite

- **Positioning/audience/markets:** international event discovery, ticketing and
  organizer operations. **Discovery/cadence/reciprocity:** event inventory and
  schedules, not a finite dating batch or pairwise consent contract.
  **Communication/logistics:** ticket notifications and organizer management;
  venues/times are supplied by organizers. **UX:** clear booking and cancellation
  details are transferable patterns.
- **Revenue (C):** paid-ticket fees vary by country/currency; free tickets have no
  ticketing fees. [Ticketing fees](https://www.eventbrite.com/help/en-us/articles/755615/how-much-does-it-cost-for-organizers-to-use-eventbrite/).
- **Location/privacy/safety:** event addresses are distinct from private origins.
  Organizer data handling requires scrutiny. Detailed current privacy/verification
  behavior remains U because direct policy retrieval returned HTTP429; no bypass
  was attempted. [Policy reference](https://www.eventbrite.com/help/en-us/articles/460838/eventbrite-privacy-policy/),
  [Data-protection guidance](https://www.eventbrite.com/help/en-us/articles/363929/eventbrite-data-protection/).
- **Strength/weakness/overlap (I):** mature ticket operations are a reference for
  event logistics; ticket ownership does not establish identity, safety or dating
  consent. A marketplace listing is not an approved Meetwell public venue.
- **Evidence:** O indexed official help; C fee/operations descriptions; independent
  outcomes none. U = current full privacy terms, specific identity checks, local
  host quality, refunds in edge cases and pairwise matching (not established).

### Additional discovery: 222

- **Positioning/markets/cadence (C):** curated public group experiences; partner
  site lists 21 markets including NYC, dinners followed by larger gatherings.
  Questionnaire-based grouping and managed venues/logistics; not romantic mutual
  matching. No public per-member invitation count established.
  [Partner product](https://partners.222.place/).
- **Messaging/UX/verification (C):** app listing emphasizes no profiles/DMs/swipes
  and claims vetting. Vetting accuracy U.
  [Developer's app listing](https://apps.apple.com/us/app/222-find-your-people/id6450612690).
- **Privacy/revenue:** partner page advertises check-in attribution/location tracking
  and charges per attendee sent; consumer price U.
  [Privacy notice, 22 June 2026](https://222.place/legacy/privacy.html).
- **Strength/weakness/overlap (I):** orchestrated evenings are a logistics reference;
  opaque grouping and venue attribution could conflict with minimization. Exact
  tracking behavior, outcomes and costs U. O documents, C claims, no independent
  verification. Relevant emerging alternative competing for the same evening.

### Additional discovery: Dine / D³

- **Positioning/market (C):** Japanese meeting-first dating. The Dine service page
  announces a rename to D³ and links its successor. US availability U.
  **Discovery/cadence/coordination:** legacy page describes daily recommendations,
  matching schedules and restaurant-reservation assistance. Current D³ parity,
  private decision semantics, messaging, exact counts and live safety controls U.
  [Official legacy service page](https://dineapp.co.jp/web/service),
  [linked successor](https://dthree.app/).
- **Privacy/verification/revenue:** not established in accessible successor text;
  do not infer them from a similarly named app. **UX/strength/weakness/overlap (I):**
  meeting coordination is an established product pattern; reservation labor and
  cancellation economics need validation. O rename/link and legacy documentation,
  C former feature descriptions, no independently verified outcomes. Treat as an
  adjacent design lead, not a verified current Manhattan competitor.

## Comparison matrix

Entries summarize company documentation above, not independently tested behavior.
`U` = not established; `N/A` = not part of the described group/event model.

| Product    | Presentation                    | Reciprocal contract established           | Meeting mechanism              | Feedback                 | Key Meetwell distinction to test                      |
| ---------- | ------------------------------- | ----------------------------------------- | ------------------------------ | ------------------------ | ----------------------------------------------------- |
| Breeze     | Small daily selection           | Mutual match; reverse-interest prediction | Coordinated partner venue      | Date feedback            | Closed pairs, explicit boundaries, joint plan consent |
| Thursday   | Event calendar                  | N/A pairwise                              | Shared place/time              | U                        | Separate dating opt-in and event privacy              |
| Timeleft   | Scheduled group                 | Participation, not each pair              | Managed gathering              | Company-described inputs | Hard romantic eligibility, private choices            |
| Hinge      | Feed plus daily recommendation  | Mutual preferences in recommendation      | Member coordination            | Private We Met           | Feasibility and reserved capacity                     |
| Tinder     | Multiple discovery modes        | Mutual connection                         | Plan sharing; booking U        | U                        | No paid reach/camera-roll inference                   |
| Bumble     | Multiple tabs; daily highlights | Mutual connection; full gates U           | Booking U                      | U                        | Bounded introductions and policy authority            |
| CMB        | Daily batch plus extras         | Mutual connection; full gates U           | Chat-led                       | U                        | Uniform finite allocation without paid expansion      |
| Happn      | Crossings/shared places         | Crush; full gates U                       | Venue context                  | U                        | No member coordinates or crossing histories           |
| The League | Tier-dependent daily batch      | Bilateral preferences claimed             | Concierge scope U              | U                        | No status ranking or silence penalties                |
| Meetup     | Groups/event inventory          | N/A pairwise                              | Organizer-led                  | Group mechanisms vary    | RSVP is not dating consent                            |
| Eventbrite | Event inventory                 | N/A pairwise                              | Ticket/organizer-led           | U                        | Reviewed venues, not merely listings                  |
| 222        | Curated group invitations       | N/A pairwise                              | Managed experiences            | U                        | Explicit consent and minimized attribution            |
| Dine/D³    | Legacy daily suggestions        | Current contract U                        | Legacy scheduling/reservations | U                        | Current regional behavior requires recheck            |

## Engineering conclusions

**A — Credible baseline:** accurate profile context, intelligible eligibility,
report/block access, secure authentication, workable cancellation, clear time and
place, reliable updates, private feedback and accessible recovery states. A working
meeting path matters more than a compelling ranking demo.

**B — Potential improvements:** hard boundaries that remain hard across every mode;
closed-pair memory; reservations that cannot overbook either participant; the same
plan version confirmed by both people; explicit location revocation; truthful
empty states; clearly separated safety narratives and matching observations.
These require adversarial tests and user evidence, not merely feature checkboxes.

**C — Reject copying:** paid exposure advantages, like inboxes, activity penalties,
silence treated as rejection/no-show, camera-roll or contact-graph inference,
crossing histories, public desirability/reliability scores, automatic reintroduction
after a No, and venue claims that imply guaranteed safety.

**D — Plausible differentiation:** a trusted Manhattan operation that consistently
turns feasible reciprocal intent into voluntary meetings with low coordination
effort, while preserving refusal and privacy. The combination may matter; no moat
or superiority is proven. Operator cost and unserved eligible members can defeat it.

**E — Unsupported novelty:** finite batches, predicting mutual interest, going
offline, date scheduling, public venues, feedback, privacy controls, an event
availability toggle and “leave the app” positioning already have precedents.
No claim that REA can reveal competitors' remote matching services is justified.

**F — Smallest experiments (proposed; no recruitment or outreach performed):**

| Hypothesis                                      | Smallest useful design                                                                                                       | Success / failure signal                                                                                                                                              | Limits / gate                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Boundaries and private decisions are understood | 6–8 consented adult usability sessions using synthetic profiles, including keyboard/screen-reader users                      | Proposed: all participants can find report/cancel; at least 80% correctly distinguish boundary, preference and expiry; any false safety expectation triggers revision | Comprehension only, not outcome lift; approve research protocol         |
| A local pool supports finite introductions      | Synthetic eligibility graph now; consented concierge cohort of 50–100 only after safety/deletion/ops gates                   | PDF P23 coverage at 14 days, inspect who is unserved and why; stop expansion if supply fails                                                                          | No invented profiles; selection bias; human staffing required           |
| Shared planning reduces effort                  | Observe a small number of consented planning sessions with a frozen task; later randomized coordination workflow if feasible | Time to agreed plan, abandonment, cancelability; proposed improvement threshold set before data collection                                                            | Script timing is not human effort; no causal claim from before/after    |
| Existing-match event Go adds value              | After Explore works, randomize eligible events/time blocks with adequate washout and explicit opt-in                         | PDF incremental wanted meetings per 100, support burden, revocation/privacy failures; any serious privacy defect stops experiment                                     | Interference, repeated members and small samples; inconclusive is valid |
| Operations are viable                           | Record aggregate minutes per completed plan, venue availability failures and support cases                                   | Costs fit an approved pilot budget; no skipped safety work to improve economics                                                                                       | No price or staffing budget approved yet                                |

Use fixed enrollment cohorts, optional meeting reports with provenance, missingness
categories and suppressed small cells. Track reciprocal acceptance, plans, reported
meetings, mutual positive follow-up, attention effort, coverage/exposure fairness,
report resolution and venue cost. Safety report rates need reporting/completeness
context; a lower count alone is not success. No demographic inference or causal
advantage claim from this desk research. See the roadmap and architecture review
for implementation gates.
