# Discuva — Product Strategy

> **Status:** Draft, first pass — pricing numbers and a few open questions marked below are hypotheses to validate,
> not final decisions. Technical implementation of everything here is specified in
> [`MULTI_TENANT_MIGRATION.md`](./MULTI_TENANT_MIGRATION.md).

---

## 1. Executive Summary

Discuva is a church management platform — attendance, membership, finance, small groups, events, evangelism
tracking, and a dozen other operational modules a growing church needs, in one system instead of five disconnected
spreadsheets and apps. It has been built and refined against one real congregation's actual day-to-day operation for
several months, which is a genuine asset: the feature set isn't speculative, it's been pressure-tested.

**The decision this paper documents:** Discuva launches as a single-repo, freemium SaaS product — not an
open-source, self-hosted tool. There is no benefit to asking a church's volunteer IT person to run a Postgres
instance, manage backups, and apply migrations. The value is in "sign up, your church is running in under a minute,"
not in a self-hosting story that adds ops burden to exactly the kind of organization least equipped to carry it.

Free is not a trial — it's the permanent tier for a church that only needs core operations. Paid unlocks the modules
that represent real operational sophistication (finance/accounting, SMS, facility rental, and more) once a church
has grown into needing them. This is a deliberate wedge: churches are often budget-constrained, especially small and
new ones, so a generous, uncapped free tier removes the single biggest self-serve adoption blocker (a credit card at
signup), while monetization happens exactly when a church is big enough or organized enough to afford it.

---

## 2. Market & Positioning

Existing church management software (ChMS) mostly falls into two camps:

| Category | Examples | Pricing pattern | Gap |
|---|---|---|---|
| Per-person pricing | Planning Center | Scales with member count, modular | Punishes growth — the moment a free/cheap church actually grows, the bill grows with it |
| Flat enterprise pricing | Church Community Builder, Breeze | Flat monthly, but no free tier | No low-risk way for a small or new church to try it — first touch is a sales conversation or a card number |
| Limited free tier | ChurchTrac | Free tier exists but capped/feature-thin | Free tier isn't generous enough to be a real product on its own |

Discuva's positioning: **unlimited people on the free tier, forever — pay only for advanced operational
modules.** No competitor in this space credibly offers "bring your whole congregation, any size, for free." That's
the headline, and it's true precisely because the monetization axis is *features*, not *headcount* — see §4.

---

## 3. Target Customer

Small-to-mid independent churches — not yet part of the initial launch scope, but worth naming so later decisions
don't accidentally cut them off: multi-branch denominational networks are a **staged, later expansion**, once
multi-branch rollups ship (already designed, not built — see `MULTI_TENANT_MIGRATION.md` §11). The free/Pro split in
§4 and the self-serve motion in §6 are both designed around the primary segment; the network segment will likely
need a third, higher-touch tier when it's addressed, not a retrofit of Free/Pro.

**Primary segment characteristics:**
- Single congregation, one or a handful of paid/volunteer staff running admin
- Currently on spreadsheets, a generic tool (Google Forms, WhatsApp groups), or a per-person-priced ChMS they've
  outgrown the price of
- Price-sensitive, but willing to pay once a specific operational pain (reconciling tithes, sending SMS blasts,
  managing facility bookings) becomes acute enough
- No dedicated IT staff — self-serve signup and zero-config onboarding are not nice-to-haves, they're the whole
  distribution strategy

---

## 4. Freemium Model — Feature-Gated Split

**Free tier: every core church-operations module, unlimited members and workers, no time limit.**

| Module | Why it's free |
|---|---|
| Members & Workers | Table stakes — nobody adopts a ChMS that doesn't do this |
| Departments & Admin Roles | Needed for the product to be usable by more than one person on day one |
| Attendance (check-in, history) | Core operational loop, drives daily/weekly engagement with the product |
| Events & Venues | Core operational loop |
| Announcements | Low cost to run, high perceived value, drives member-app engagement |
| Leave Requests | Small but expected for any staff-management tool |
| Sunday School / Children's Church | Core ministry operations, not "advanced" |
| Follow-Up & Evangelism (first-timer tracking) | Growth-oriented churches need this from day one — gating it would work against the churches most likely to eventually upgrade |
| Prayer Requests | Low cost, high engagement, core pastoral-care loop |
| Small Groups | Core ministry operations |
| Pastor Feedback / Notes | Low cost, expected baseline |
| Member PWA (check-in, profile) | The free tier needs to feel complete to members, not just admins |

**Pro tier — operational/advanced modules, monetizes the churches that have grown into needing them:**

| Module | Why it's Pro |
|---|---|
| **Finance & Accounting** | The flagship differentiator. Full double-entry ledger — funds, chart of accounts, budgets, journal entries with approval workflow, tithe records with bank-statement reconciliation, pledge campaigns, petty cash, external payees, accounting periods, financial reports. This is genuinely sophisticated software (on par with small-business accounting tools) that only a church with real financial operations needs — exactly the signal that a church can afford to pay. |
| **SMS Broadcast** | Has a real per-message cost regardless of plan (see §5's metering note) — gating it protects margin as much as it drives upgrades. |
| **Facility Rental** | Revenue-generating for the church itself; reasonable that Discuva takes a cut of the value it helps create. |
| **Games** (live quiz/engagement) | Nice-to-have engagement feature, natural upsell, not core operations. |
| **Volunteer Marketplace** | Operational sophistication signal — a church coordinating volunteer sign-ups at scale is past the "just getting started" phase. |
| **Asset & Inventory Management** | Operational, not ministry-critical. |
| **Incident Reports** | Governance/compliance-adjacent — the kind of feature a more organizationally mature church cares about. |
| **Audit Logs** | Classic SaaS "Team/Business tier" feature — governance, not day-to-day ministry. |
| **Service Programme / Service Session** (live production management) | Sophisticated scheduling/production tooling for churches running complex multi-service operations. |
| **Service Ratings** | Analytics/feedback tooling, not core operations. |
| **Sermon Archive** (incl. YouTube auto-detection) | Content/media operations, natural upsell. |
| **Bulk import/export, CSV exports** | Data-portability tooling — expected to matter more to organizationally mature churches. |
| **Multi-branch rollups** *(not yet built — see `MULTI_TENANT_MIGRATION.md` §11)* | Flagship feature for the network/denomination segment once that expansion happens (§3). |

**Deliberately not usage-gated.** No member cap, no worker cap, no event cap on the free tier. This is the core bet
of the whole strategy — see §2. The risk (a large free church costs more to serve without paying) is accepted
knowingly: it's a distribution cost, not a bug, and it's mitigated by the fact that a large, active church is
exactly the kind of church statistically most likely to eventually need Finance or SMS.

---

## 5. Pricing — Draft Hypothesis

> **Not validated against real willingness-to-pay data. Treat every number below as a starting point for testing,
> not a final price.**

**Flat monthly pricing, not per-person** — consistent with the "unlimited people, ever" positioning in §2. A
per-person price on the Pro tier would contradict the entire pitch.

**Price and tier count are configuration, not a launch-time architecture decision.** `MULTI_TENANT_MIGRATION.md`
§4.11's `plans` table is a free-form list, not a hardcoded two-tier assumption — adding a third tier later, or
changing what a tier includes, is a data change, not a re-architecture. The table below is the *launch* shape, not
a ceiling:

| Plan | Price | What's included |
|---|---|---|
| **Free** | ₦0 forever | Every module in §4's free list, unlimited members/workers |
| **Pro** | **draft, not priced** | Everything in Free, plus every Pro module in §4 except SMS send volume |

The $39/mo figure from the first draft of this section was a USD placeholder written before the Paystack/NGN
decision (§4.11's `plans.currency` now defaults to `NGN`) — it's deliberately removed rather than converted at a
made-up exchange rate, which would just be a different kind of fake precision. Needs a real NGN number, informed by
actual willingness-to-pay in the target segment (§3), before this table is launch-ready.

A plausible later tier, once the target segment expands per §3 — **Network** (multi-branch rollups, higher price
point, aimed at denominational orgs) — is *not* designed or priced here; it's flagged so the launch pricing table
above isn't mistaken for the final shape of the product.

**Payment processing: Paystack, not Stripe, chosen for standard Nigerian-market support Stripe currently lacks —
but abstracted behind a provider interface, not hardwired.** Proven with subscription billing itself: Paystack and
Flutterwave are both live, registered simultaneously behind `IPaymentProvider` (`PaymentProviderRegistryService`).
Adding a processor later (Kora, Stripe if the product ever expands beyond its initial market) is a new class behind
the same interface, not a rearchitecture. Full design in `MULTI_TENANT_MIGRATION.md` §4.11.

**Communication providers: platform-managed by default, bring-your-own-key as a first-class alternative, and not
limited to one provider per channel.** Two things churches specifically want that shape this: their own name as the
sender (not a shared platform identity) on SMS and email both, and the ability to add credentials for whichever
provider they already use, from their own settings — not just whatever Discuva picked. Neither is a
later/enterprise add-on; both ship at launch. Full design in `MULTI_TENANT_MIGRATION.md` §4.12. In short:
- **Platform default** — SMS debits a prepaid credit balance (by segment) through the platform's own provider
  (Termii at launch, more addable later); email sends free through the platform's own default provider. Zero setup,
  shared/generic sender identity.
- **BYOK, per provider, per channel** — a tenant can add their own credentials for any registered SMS or email
  provider (starting with Termii for SMS, Gmail/Resend for email — more providers addable without a rearchitecture,
  same "data, not code" principle as the plan tiers above) and have sends go out under their own name. No wallet
  involved for that channel, no cost to Discuva, their credential encrypted at rest, never plaintext.
- SMS needs the wallet because Termii has a real per-message cost; email doesn't, because typical church volume is a
  rounding error on providers' free tiers — no wallet built for email unless that stops being true.

**Failed-payment grace period:** a `past_due` subscription (§4.11's payment-provider webhook flow) should not
instantly revoke Pro access — a card expiring is routine, not churn intent. Recommend a **7-day grace period** with
in-app banners before downgrading a `past_due` tenant to Free-tier feature access. (Data is never deleted on
downgrade — a lapsed Pro tenant's finance records, for example, stay intact and become read-only, not gone, so
re-upgrading is lossless.)

**Open pricing questions, not blocking launch but worth flagging:**
- **What should Pro actually cost, in NGN** — no draft number exists anymore (see §5 above), let alone a
  market-tested one, for the target segment (§3).
- Is a single Pro tier enough at launch, or does a mid-tier (e.g., Finance only, without the rest) capture churches
  that want exactly one Pro module and balk at paying for all of them? Simpler pricing (one Pro tier) is the launch
  recommendation — a second tier is a "later, if data supports it" question, not a launch blocker, and the schema
  doesn't block adding one.
- Annual discount depth (2 months free is a common default, not derived from anything specific to this product).
- **Repricing an existing tier:** most payment processors' plan/price objects are immutable once created (Paystack
  included) — changing what Pro costs means creating a new plan and deciding whether existing subscribers move to
  it or stay grandfathered on their original price. Not a launch concern, but worth deciding deliberately the first
  time it comes up rather than by accident.

---

## 6. Go-to-Market

- **Self-serve is the entire initial motion.** No sales team, no demo calls. Signup → subdomain → logged in, per
  `MULTI_TENANT_MIGRATION.md` §4.8. This only works because provisioning is fast (one migration file, post-squash —
  see that doc for why this matters).
- **In-app upgrade prompts, not a separate marketing funnel for Pro.** A free-tier church hits a `PLAN_UPGRADE_REQUIRED`
  response (§4.11) when it tries to use a Pro module — that's the primary upgrade trigger, not an email campaign.
  The moment of highest upgrade intent is "I just tried to do the thing and got blocked," not a newsletter.
- **No credit card required for the free tier**, by design — removing that friction is the entire point of the
  freemium bet in §2.
- **Word of mouth within denominational/pastoral networks** is the likely primary acquisition channel for a product
  in this space, more than paid ads — worth planning content/referral mechanics around later, not a launch blocker.

---

## 7. Technical Foundation

Full technical design lives in [`MULTI_TENANT_MIGRATION.md`](./MULTI_TENANT_MIGRATION.md) — schema-per-tenant
multi-tenancy, self-serve provisioning, the platform superadmin dashboard, and the billing/plan-gating
infrastructure that enforces §4's split. That document is the source of truth for *how*; this one is the source of
truth for *why* and *what*.

Key points relevant to product decisions specifically:
- Feature gates (§4) map directly onto `PlanFeature` enum values enforced by `@RequiresPlan` — adding or moving a
  module between Free and Pro later is a one-line config change (which plan's `features` array contains that key),
  not a re-architecture.
- Self-serve signup provisions a tenant in seconds, not minutes — see the migration-squash note in that doc's §4.8.
  This is what makes the "no sales team" GTM motion in §6 actually viable rather than aspirational.
- Payment and communication (SMS/email) providers are both built behind swappable interfaces, not hardwired to one
  vendor — §4.11/§4.12. Product decisions like "add a second payment processor" or "add a new SMS provider" are
  data/config changes on the engineering side, not new integration projects.

---

## 8. Roadmap

Sequencing matches `MULTI_TENANT_MIGRATION.md` §9's build order. Product-relevant milestones:

1. **Tenant infrastructure + billing + self-serve signup** (that doc's Phases 1–4) — nothing in this paper is real
   until this ships. This is the weekend's realistic scope: finalized plans, not working code (see note below).
2. **Platform admin + dashboard** (Phases 5–7) — needed before the first paying customer, so support and billing
   operations aren't done by hand in a SQL console.
3. **Existing client migration** (Phase 8) — the current single-tenant deployment becomes tenant 1.
4. **Public launch** — self-serve signup goes live.
5. **Multi-branch rollups** (Phase 9, future) — unlocks the network/denomination segment (§3) as a later expansion,
   not part of initial launch scope.

**Honest timeline note:** the technical build described above is genuinely multi-week engineering (7+ sequential
phases touching auth, caching, queues, two frontends, and a new platform app), not a weekend of work, regardless of
who's building it. What's realistic this weekend is this paper, the finalized technical plan, and a scaffolding
start on the platform-admin module — documents and a foundation to execute against starting Monday, not a shipped
product.

---

## 9. Open Questions

Flagging honestly rather than pretending these are decided:

- **Pricing validation** (§5) — no real willingness-to-pay data yet.
- **Repricing/grandfathering policy** (§5) — decided in principle (deliberately, not by accident) but no actual
  policy written yet for when it first happens.
- **Support model** — is Pro-tier support just email, or does it include something faster (chat, priority queue)?
  Not designed yet.
- **Trial mechanics** — should a free-tier church get a time-boxed Pro trial (e.g., 14 days) to experience gated
  modules before paying, or is "hit the paywall, see exactly what you'd get" (no trial) the launch approach? Leaning
  toward no trial at launch — simpler to build, and the in-app upgrade-prompt UX (§6) already shows what's behind
  the gate without needing a trial to demonstrate it. Revisit if upgrade conversion is low.
- **Existing single-tenant client's transition** — do they get grandfathered onto Pro for free/discounted given
  they're the reference customer this whole product was built against? A relationship decision, not a technical one.
