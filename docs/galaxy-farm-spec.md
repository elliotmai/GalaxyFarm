# Galaxy Farm — Product & Architecture Specification

**Version 1.4 · August 2026 · Status: Approved for build — decision log in §12**

---

## 1. Overview

Galaxy Farm is a local-first progressive web app for managing a family beef-cattle operation and homestead near Fort Worth, TX, designed to grow into a show-calf boarding and training business. It manages registered cattle (Maine-Anjou, Chianina, Shorthorn), laying flocks, a garden, farm equipment, pets, and — later — client calves and horses.

The app serves three surfaces from one codebase: a full admin experience on desktop and mobile, touch-first kiosk screens mounted in the barn, and a scaffolded customer portal for the future boarding business.

**Non-negotiable qualities**, in priority order:

1. **Local-first / offline-capable.** Barn connectivity is spotty. Every read and write happens against an on-device store instantly; a sync engine reconciles with the server when signal returns.
2. **Clean architecture with obsessive modularization.** Each farm domain is an isolated module with pure domain logic, so new domains (horses, quail, a second property) bolt on without touching existing ones.
3. **Portability.** Cloud-hosted frontend forever; cloud-hosted Postgres now, migrating to self-hosted Postgres at the farm later, with zero application code changes.

## 2. Guiding principles

- **The domain layer knows nothing about the web, the database, or the cloud.** Entities and use cases are pure TypeScript, testable without any infrastructure.
- **Speak only standard Postgres to the database.** No provider-proprietary APIs (no Supabase client SDK, no vendor auth). This is what makes the future move to a self-hosted box a `pg_dump | pg_restore`, not a rewrite.
- **One Animal model, many species.** Cattle, chickens (as flocks), pets, client calves, and future horses share a kernel (identity, location, photos, instructions, health) and extend it per species. The boarding business reuses the same entities with an `owner` attached — no parallel system.
- **Derive, don't duplicate.** Calving due dates derive from breeding records; feed run-out dates derive from feeding plans; rule deadlines (bull ring by 8 months) derive from birth dates; the housesitter guide derives from live data. Manual entry is for facts, not for consequences of facts.
- **Everything spatial is one component.** The property map (pens/pastures) and the garden layout designer are the same SVG editor with different palettes.
- **Nothing is a dead end.** Every record a user can create, they can also find, edit, and remove — with validated input on the way in and a confirmation on the way out. This is a hard requirement, not a per-screen decision; the full contract is §4.5.

## 3. Stack

Your Next.js/React inclination is the right call — it's the strongest option for a PWA with three distinct surfaces, deploys first-class on Netlify, and has the deepest library ecosystem for the odd requirements here (SVG editors, e-signatures, PDF generation).

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 15+ (App Router) + TypeScript** | Route groups map perfectly to `/admin`, `/account`, `/kiosk` surfaces; Netlify has a first-party Next runtime |
| Monorepo | **pnpm workspaces + Turborepo** | Enforces module boundaries at the package level |
| Database | **PostgreSQL** (managed now → self-hosted later) | The portability requirement decides this outright |
| ORM / migrations | **Drizzle** | SQL-first, zero runtime magic, generates plain migration SQL that any Postgres accepts — ideal for the self-host move |
| Local store | **Dexie (IndexedDB)** + custom sync engine | Full control, no vendor coupling; see §5 |
| Validation | **Zod** | One schema per entity shared by client forms, sync payloads, and API handlers |
| Auth | **Auth.js v5** with credentials + Postgres adapter | Users live in *your* database, so auth migrates with it |
| Service worker / PWA | **Serwist** | Maintained Workbox successor for Next.js; app shell + asset caching |
| Photos & documents | **Cloudflare R2** via presigned URLs | 10 GB free, zero egress fees, S3-compatible (swappable to a home NAS/MinIO later) |
| Email | **Resend** | Free tier (~3,000/mo) covers alerts for years |
| UI | **Tailwind + shadcn/ui** + custom design system package | Professional look fast, fully ownable components |
| Charts | **Recharts** | Egg trends, feed spend, herd growth |
| PDF (housesitter guide, liability snapshots) | **@react-pdf/renderer** + print stylesheets | |
| Testing | **Vitest** (domain/use cases) + **Playwright** (smoke e2e) | |

Alternatives considered: SvelteKit (great, but smaller ecosystem for e-sign/PDF/PWA tooling); Supabase client SDK (fast start but couples auth/storage to a vendor, fighting the self-host goal); off-the-shelf sync services like PowerSync or ElectricSQL (excellent, revisit if the custom engine ever feels limiting — the repository pattern makes them drop-in replaceable).

## 4. System architecture

### 4.1 Monorepo layout

```
galaxy-farm/
├── apps/
│   └── web/                      # Next.js — presentation + composition root ONLY
│       └── app/
│           ├── (public)/         # landing, /book, /login
│           ├── (admin)/admin/    # full management UI
│           ├── (account)/account/# customer portal (scaffold)
│           ├── (sitter)/sitter/  # housesitter limited view
│           └── (kiosk)/kiosk/    # barn touch screens
├── packages/
│   ├── core/                     # shared kernel: base Animal, Zone, Task,
│   │                             #   value objects, domain events, Result type
│   ├── modules/
│   │   ├── cattle/               # each module contains ONLY:
│   │   ├── feed/                 #   domain/       entities, services, ports
│   │   ├── poultry/              #   application/  use cases, queries, DTOs
│   │   ├── garden/
│   │   ├── equipment/
│   │   ├── business/             # scaffold (schema + rules, thin UI)
│   │   ├── pets/
│   │   ├── horses/               # placeholder (roadmap active)
│   │   └── housesitting/
│   ├── infrastructure/
│   │   ├── db/                   # Drizzle schema, migrations, Postgres repos
│   │   ├── local/                # Dexie schema, IndexedDB repos
│   │   ├── sync/                 # outbox, cursors, conflict resolution
│   │   ├── storage/              # R2 adapter
│   │   ├── email/                # Resend adapter
│   │   └── quickbooks/           # port defined now, adapter later
│   ├── ui/                       # design system, SpatialEditor, charts, kiosk kit
│   └── config/                   # shared tsconfig/eslint/tailwind presets
```

**Dependency rules (lint-enforced):**
- `modules/*/domain` imports only `core`. Nothing else. Ever.
- `modules/*/application` imports its own domain + `core`.
- Modules never import each other; they communicate through IDs and domain events (e.g., `CalvingRecorded` → feed module offers a creep plan; business module listens to `AnimalAgeThresholdReached`).
- `infrastructure/*` implements repository ports defined in domain layers.
- `apps/web` is the only place everything meets (dependency injection at the route level).

The payoff: when the database moves home, only `infrastructure/db`'s connection string changes. If the API later moves home too, the application packages lift into a standalone Node service unchanged, with the Netlify frontend reaching it over Tailscale or a reverse proxy.

### 4.2 Offline-first sync engine (`infrastructure/sync`)

- **Reads:** UI always reads from IndexedDB via live queries — instant, works with zero bars in the barn.
- **Writes:** every mutation is a command written atomically to the local store *and* an **outbox** (ULID id, entity, field patch, timestamp, deviceId).
- **Push:** when online, the outbox drains to `/api/sync/push`; the server applies patches with **field-level last-write-wins** and records every superseded value in an audit log (so a rare conflict is recoverable, not silent). Ties on an identical timestamp break on the higher deviceId — arbitrary, but deterministic, which is what matters when every device has to reach the same answer without talking to the others. The audit is a **field-level change log rather than a conflict-only log**: see decision 23.
- **Pull:** per-entity `updatedAt` cursors via `/api/sync/pull`; deletions ship as tombstones.
- **Photos/documents:** compressed client-side, queued, uploaded to R2 via presigned URLs when online; records store the key immediately and render a placeholder until synced.
- **Conflict reality check:** two writers (you two) plus kiosks, mostly appending records — real conflicts will be vanishingly rare. LWW-per-field + audit log is the right amount of machinery.

A nice side effect: because reads never wait on the network, a scale-to-zero database with cold starts (see §12) is invisible to daily use.

### 4.3 Auth, roles, permissions

Roles from day one, cheap to add now and painful later:

| Role | Access |
|---|---|
| `owner` | Everything, user management, settings |
| `member` | Everything operational (the two of you are both owners; this exists for future family/employees) |
| `customer` | `/account` only — their animals, milestones, forms, invoices |
| `housesitter` | `/sitter` only — care guide, today's chores (check-off), emergency info; time-boxed access window |
| `kiosk` | Device-scoped token; read + whitelisted quick actions (log eggs, complete chores, move animals between pens). PIN unlock for anything else |

Permission checks live in the application layer (use cases declare required capability), not in UI conditionals.

**Accounts are invited, never issued with a password.** There is no public sign-up: an owner adds somebody by name, email, and role from `/admin/settings`, and the account is created with *no* password and a single-use invitation link (256-bit token, stored only as a SHA-256 hash, good once, lapsing after a week). They set their own password at `/invite/[token]`. A password chosen on somebody's behalf is a password two people know, it travels over whatever channel is to hand, and it is almost never changed afterwards. The same action re-issues a link, which makes it the password-reset path as well — and re-issuing invalidates whatever came before it. Until acceptance the account exists, holds its role, appears in the list, and cannot sign in: "invited and never accepted" and "switched off" are different states with different answers, and one `active` flag would say the same thing about both. A `housesitter` cannot be saved without both ends of an access window, because access that never lapses is the one thing the role exists to prevent.

### 4.4 Kiosk mode

Barn screens pair via a one-time code and hold a long-lived device token. Kiosk home offers preset boards: **Pen Board** (property map + who's where + care instructions), **Calendar**, **Today's Chores**, **Egg Quick-Entry** (big +1 buttons per coop/color/size), **Program Day Sheet** (today's show-program schedule as a calf × activity grid — tap to check off rinses, exercise, and training slots as they happen), and **Housesitter Mode**. Large touch targets, high contrast, auto-refresh on sync, screen-wake hints. Any screen can be locked to a single board from settings.

### 4.5 Data operations contract (non-negotiable)

Every entity in this specification is subject to the following contract. It is not a per-screen design decision and not a "nice to have for v2" — a feature is not complete until it satisfies all four clauses, and CI enforces them (§11.1).

**1. Full CRUD, everywhere it applies.** Every entity a user can create, they can also list/read, update, and delete. No write-only screens, no records that can only be fixed by editing the database directly. Concretely, each entity ships all of: a **list** view with search/filter appropriate to its volume, a **detail** read view, a **create** form, an **edit** form, and a **delete** action.

*The applicability exceptions are enumerated, closed, and small.* Anything not on this list gets full CRUD:

- **Derived read models** — projected `CalendarEvent`s, per-animal and herd P&L, feed run-out dates, a zone's effective safety level, resolved care instructions, dressing percentage, ADG. These have no CRUD of their own because they are recomputed from their sources; you edit the source record and the derivation follows. This is the "derive, don't duplicate" principle (§2) — a derived value that could be edited directly would be a second source of truth.
- **Immutable legal and audit records** — signed liability-form PDF snapshots (§5.7), sync audit-log entries (§4.2), and the outbox history. These are create-and-read only. Corrections happen by superseding entry (a new signed version, a compensating record), never by mutation, and never by deletion.
- **System-owned rows** — schema migration history, device pairing tokens (revocable, not editable).

Everything else — every log, every record, every plan, every template, every join like `ZoneAssignment` — is fully CRUD-able by a user with the capability for it. Where an entity maintains a running total from an append-only log (flock headcount via its adjustment log, feed on-hand via purchases and consumption), the *log entries* carry the CRUD and the total re-derives; the total itself is never directly editable.

**2. Validated input at every boundary.** One Zod schema per entity is the single definition of what valid data is, and it is shared by the client form, the sync payload, and the API handler — the same schema, imported, not three copies that drift. Validation runs at every boundary crossing, including the sync push handler: data arriving from a local store is not trusted just because it came from our own client. Domain invariants that Zod cannot express (a calving date cannot precede its breeding date; a `ZoneAssignment.to` cannot precede its `from`; straw count cannot go negative) live in the domain layer as pure functions and are enforced in the use case, not in the form. Errors surface per-field on the control that caused them, never as a single opaque "invalid input."

**3. Confirmation before every destructive action.** No delete, anywhere, on any surface, happens on a single unconfirmed tap. The confirmation must state **what** is being deleted by name, and **what else it affects** — "Delete pen *North Trap*? 4 animals are currently assigned to it." A generic "Are you sure?" does not satisfy this clause. Three tiers:

| Tier | Applies to | Interaction |
|---|---|---|
| Standard | Ordinary records — a log entry, a task, a photo | Confirmation dialog naming the record; undo toast afterward |
| Elevated | Records with dependents, or anything on a kiosk | Dialog naming the record *and* listing dependents; on kiosk, PIN unlock |
| Typed | Whole-aggregate deletes — an animal with history, a zone, a contact, a property | User types the record's name to enable the confirm button |

Bulk deletes state the exact count and are always at least Elevated. The same rule governs other irreversible actions that are not technically deletes: terminating a boarding agreement, voiding an invoice, revoking a kiosk device, clearing a sync queue.

**4. Soft delete, restore, and purge.** Deletes write a tombstone (§4.2) rather than removing the row: `deletedAt`, `deletedBy`, and reason where the UI collects one. Deleted records leave the normal lists and the sync read path but remain restorable from a **Trash** view for a configurable retention window (default 30 days). Permanent purge is a separate, `owner`-only, Typed-tier action. This is what makes the confirmation dialogs honest — the answer to "what if I confirm by mistake" is always "restore it from Trash," and it is what lets deletions replicate safely to kiosks and other devices instead of resurrecting on the next pull.

**Referential integrity is a declared decision, never an accident.** Every relationship declares its delete behavior — `restrict` (block the delete and say what is in the way), `cascade` (delete dependents, listed in the confirmation), or `detach` (null the reference and keep the dependent). A relationship with no declared behavior is a build-time error, not a runtime surprise.

**Offline behavior.** Deletes are ordinary mutations: confirmed locally, written to the local store and the outbox together, drained when signal returns. The confirmation dialog never waits on the network, and a delete performed in the barn with zero bars behaves exactly like one performed at the kitchen table.

## 5. Domain model

Field lists below are the significant ones, not exhaustive schemas. All entities carry `id (ULID)`, `propertyId`, `createdAt`, `updatedAt`, soft-delete tombstones, and audit metadata. Everything hangs off `propertyId` so multiple locations later is a query filter, not a migration.

### 5.1 Shared kernel (`core`)

**Property** — name, address, timezone, growingZone (auto-suggested from ZIP against the USDA dataset, editable — dynamic per property as requested), map imagery (§8: Google satellite online, cached NAIP snapshot offline).

**BrandingConfig** — the farm name and the business name are **global variables, never strings in code**: stored in settings (env-var fallbacks) and injected into every page title, navigation header, email template, PDF (housesitter guide, liability form), kiosk board, and the customer portal. Both names are undecided today — set them in one place whenever you land on them and the entire app updates. One deliberate exception: signed liability-form PDF snapshots retain the business name as it read at signing, because those are immutable legal records.

**Zone** — the universal "place": `type: pen | pasture | coop | barn | stall | garden_area | working_facility` (the last added v1.3 — the tub and chute hold cattle under handling but nothing lives there, so they must not render on the Pen Board as though something did), name, `indoor/outdoor`, capacity, polygon geometry for the map, **baseline safetyLevel** (hazards of the place itself — electric fence, footing, equipment; see *Safety levels* below), **waterSourceIds** referencing **WaterSource** records (added v1.3 — see below; feeds the freeze alerts in §6), **customInstructions** (rich text — group-level care instructions live here), active flag. Nine zones seeded — **Pasture, Hay Field, West Pen, Pen 1, 2nd Pen, Pen A, Pen B, Tub/Chute, and Randy's pasture** (the neighbour's, used on and off); see `docs/property-layout.md`. Fully editable as the layout changes. Note three open modelling questions recorded there: tanks are shared between zones, one tank is seasonal, and the tub needs a zone type that is not `pen`.

**WaterSource (added v1.3)** — a trough, tank, or natural water as its own record: name, `type: auto_refill | static_tank | pond | creek`, `hasHeater`, `cover: none | off | on` (added v1.4), `active`, notes. Zones reference sources many-to-many, because **tanks are shared**: on this property four tanks serve eight zones, one of them serving three. Modelling water as a boolean on Zone would fire the §6 ice-breaking chore once per *zone* — eight chores for four tanks, sending someone to the same trough three times, and a chore list that does that stops being trusted. One chore per tank; the heater is a property of the tank rather than of every zone drinking from it; `active` is false while a seasonal tank is stowed, so it raises nothing. **Covers, not heaters, are the mitigation in use here** — no tank on the place is heated and none is wanted — so the cover carries three states rather than a boolean: "there is none" and "it is off" lead to different work, and only the second is something to go and do. A cover slows ice; it does not stop it, so a fitted cover never clears the morning check.

**Pasture care (added v0.7)** — land upkeep tracked per zone. **PastureCareLog**: action (`seed | overseed | fertilize | spray | mow | drag | soil_test`), product/variety (e.g., winter rye), rate (lbs or units per acre), cost, date, attachments (soil-test results), notes. Seed, fertilizer, and chemical stock live in the supplies module, so costs flow into whole-farm operating reports and per-pasture cost history. A pasture can be marked **resting** — it renders dimmed/hatched on the Pen Board, and moving an animal into a resting pasture prompts a confirmation. Seasonal work (overseed rye every fall, fertilize each spring) uses recurring task templates tied to the zone, so the reminder shows up on the calendar and chore list when the season comes around.

**Animal** (base) — species, name, tagNumber, sex, dob (or estimate), status (`active | sold | deceased | processed | boarding | departed`), ownership (`own | client` + optional ownerId), **safetyLevel + safetyNotes** (see *Safety levels* below), photos[], **customInstructions** (animal-level), notes.

**ZoneAssignment** — animalId, zoneId, from, to. Current location is the open assignment; history is free. Client calves can hold *two* concurrent assignments tagged `inside` and `outside`.

**CareInstruction resolution** — any animal's effective instructions = its own instructions + its current zone's instructions + any group instructions, displayed merged on the Pen Board and in the housesitter guide.

**Safety levels (added v0.5)** — a farm-wide handling/difficulty scale so helpers know what they can safely interact with. Five levels with configurable labels, defaults:

| Level | Color | Default meaning |
|---|---|---|
| 1 | Green | Safe for anyone — gentle, halter-broke |
| 2 | Lime | Safe with basic caution |
| 3 | Yellow | Confident handlers only |
| 4 | Orange | Owners only |
| 5 | Red | Do not handle / do not enter |

Every animal carries a level plus **safetyNotes** stating *why* ("kicks when cornered," "protective with calf at side"). Every zone carries a baseline level for the place itself, and its **effective level is derived: max(zone baseline, highest-level animal currently inside)** — so a green pen turns red the moment the bull is moved into it, automatically, everywhere at once. Smart default: a dam is auto-suggested to an elevated level from calving until you clear it (protective mommas). Badges render on Pen Board zones (border color) and animal chips, stall cards, rosters, and profiles; the housesitter guide and `/sitter` view lead every pen section with its level and list what a helper may and may not interact with.

**FeedingPlan** — target (`animal | zone | group`), lines of `{feedTypeId, quantity, unit, frequency, timeOfDay}`, special notes. Per-cow custom mixtures are just an animal-targeted plan that overrides/extends the group plan.

**Contact** — one CRM for everyone the farm touches: tags (`vet | ai_tech | customer | buyer | seller | feed_vendor | supply_vendor | processor | hauler | emergency | friend_family`), multiple phones/emails, address, company, notes, and **linked history** — animals bought from or sold to them, treatments they administered, feed and supply purchases from them, egg dispositions, and (Phase 5) bookings, agreements, and invoices. Business customers are a Contact plus a portal login; the emergency-tagged subset auto-populates the housesitter guide. Route: `/admin/contacts`.

**Attachment** — polymorphic file link (registration papers, manuals, receipts, signed forms) → R2 key.

**Task / ChoreTemplate** — recurring templates (daily, weekly, cron-ish) generate dated instances; completable from kiosk; assignable; overdue state feeds notifications.

**CalendarEvent** — mostly *projected* from other modules (calving windows, withdrawal ends, maintenance due, rule deadlines, planting windows, drop-offs) plus manual events. The calendar is a read model, so nothing is entered twice.

**Roadmap** (generic aggregate) — used by cattle, horses (active now), and equipment. Items: `type: goal | milestone | wishlist | planned_action`, title, detail, targetDate/season, priority, budgetEstimate, status. Cattle adds structured PlannedMatings (§5.2); equipment adds wishlist costing (§5.6).

**PurchaseCandidate** (generic aggregate, added v1.1) — the specific thing you are *actually looking at*, as opposed to the wishlist item saying you want one. A Roadmap wishlist entry says "truck, need, ASAP"; a PurchaseCandidate is "2018 F-250, 96k miles, $34,500, listed here." Many candidates hang off one wishlist item, and the point of the aggregate is to line them up next to each other when a large amount of money is about to move.

Shared fields, identical across every domain: `roadmapItemId` (optional — the want this would satisfy), title, **status** (`watching | contacted | inspected | offer_made | purchased | passed | gone`), askingPrice, **listingUrl**, seller → **Contact** (the CRM already holds vendors, sale barns, and private sellers), location + one-way distance, listedDate, firstSeen, expiresAt or sale date, photos[], attachments[] (listing snapshot, inspection report, papers), **pros[] / cons[]**, notes.

**Costs are itemised, not guessed.** `additionalCosts[]` of `{label, amount}` covers hauling, inspection, immediate repairs, commission, and anything else that only shows up after you say yes. **Total acquisition cost = askingPrice + Σ additionalCosts** is derived and is the number the comparison view sorts on, because the sticker price is the one number that never decides anything. Against the parent wishlist item's `budgetEstimate` the app shows over/under.

**Comparison view** — the real feature. Candidates for one wishlist item side by side as a table: the shared fields, the domain-specific fields below (§5.2, §5.6, §5.9), total acquisition cost, distance, days on market, and your own pros and cons. Sortable, exportable, printable — a decision this size gets discussed away from the screen.

**Planned → actual.** Marking a candidate `purchased` converts it into the real record — an `Equipment` (§5.6) or an `Animal` (§5.1) — carrying over the price, seller contact, photos, and attachments as the acquisition record. Same pattern as PlannedMating → BreedingRecord and PlannedPlanting → Planting: the plan becomes the fact in one tap, and nothing is typed twice. Marking one `passed` keeps it, with the reason — the record of what you turned down and why is worth as much next year as the record of what you bought.

**Notifications** — sale or auction date approaching, listing expiring, a candidate sitting in `watching` past a configurable age, and total acquisition cost crossing the wishlist item's budget.

### 5.2 Cattle module

**CattleProfile** extends Animal — breed composition as percentages (e.g., ½ Maine-Anjou ¼ Chi ¼ Shorthorn — show cattle are rarely purebred), polled/horned, color/markings, **registrations[]**: `{association: Maine-Anjou | Chianina | Shorthorn | Angus | other, regNumber, tattoo, registeredName, epdSnapshot?}` — an animal can be papered in multiple associations. Registries are named by the breed whose herdbook they keep, not by the association's initials: `ASA` is the American Shorthorn Association here and the American Simmental Association elsewhere, and the two herdbooks have overlapping numbers.

**Pedigree** — sire/dam references resolving to either an on-farm Animal or an **ExternalAnimal** (name, regNumber, association, own sire/dam refs). External ancestors chain recursively, giving "all the way back" depth without requiring every ancestor to be a farm record. Pedigree view renders the standard 3/4/5-generation tree with drill-down.

**SemenInventory** — sire (ExternalAnimal or own bull), strawsOnHand, tank/canister/cane location, source, pricePerStraw, purchase date. Decremented by AI breeding records.

**SyncProtocol** — named templates (e.g., 7-day CO-Synch + CIDR) as day-offset steps; applying one to a cow projects each step onto the calendar with notifications.

**HeatRecord** — cow, observed datetime, intensity, notes; supports 21-day return predictions.

**BreedingRecord** — dam, method (`AI | natural | ET`), sire/straw or bull, embryo details if ET, date, technician, linked protocol, **pregCheck** {date, result, method}, projected due date = breed-configurable gestation (default 283 days) → creates a *calving window* calendar event two weeks out with notification.

**CalvingRecord** — dam, date, birthWeight, calvingEase (1–5), vigor, notes, assist details; **creates the calf as a new Animal** with pedigree pre-wired to dam + service sire.

**WeightRecord** — animal, date, weight, context (`birth | weaning | yearling | other`). Birth weights are the reliable ones; weaning/yearling fields exist and, when present, the system computes ADG between any two weights and unadjusted 205-day weaning weight. (Association age-of-dam adjustments: future enhancement.)

**HealthRecord** — animal, type (`vaccination | treatment | exam | injury | deworming`), product → MedInventory, dose/route, administeredBy, vet contact, cost, **withdrawalDays → computed withdrawalEndDate** with a hard flag on the animal until it passes (critical for beef). Vaccination protocols can schedule boosters.

**MedInventory** — product, qty, unit, expirationDate (expiry alerts), cost, defaultWithdrawalDays, storage location.

**AcquisitionRecord / SaleRecord** — counterparty contact, date, price, type (`private | sale_barn | auction | breeding_stock | show`), transport notes. 

**ProcessingRecord** (packer) — processor contact, dates, **liveScaleWeight, hangingWeight (HCW), computed dressing %**, processing cost, payment received, and **CutLine[]**: `{cut, pounds, disposition: kept | sold, pricePerLb?, buyer?, total}`. Rolls up: revenue from sold cuts, pounds kept for the freezer, and full per-animal picture.

**Per-animal P&L** (read model) — acquisition/breeding costs + allocated feed (§5.3) + health costs + processing costs vs. sale/packer/cut revenue. Herd-level rollups feed Reports.

**CattleCandidate** (extends PurchaseCandidate, §5.1) — breeding stock and show prospects under consideration. Adds: breed composition, sex, DOB or age, **registration status** (association + number, or "unpapered"), EPD snapshot where published, pedigree reference — which may point at an existing **ExternalAnimal**, so a sire you already track in someone else's pedigree resolves without re-entry — bred/open and service sire if bred, sale type (`private | sale barn | auction | online sale | production sale`), lot number, and sale date. Sale dates project onto the calendar; auction lots are a deadline, not a browse.

**HerdRoadmap** — Roadmap + **GeneticGoal** (trait, direction, notes), target herd-size milestones by year (1 → 20 over 5 years), and **PlannedMating**: `{dam or dam-criteria, planned sire (semen inventory link), target season, rationale, status}` — one tap converts a planned mating into a real BreedingRecord when it happens.

### 5.3 Feed module (cross-species)

**FeedType** — name, category (`hay | grain | mineral | creep | supplement`), unit (`round_bale | square_bale | bag | bulk_lb | bulk_ton | block`), estWeightPerUnit, currentUnitCost, reorderLeadDays, reorderThreshold.

**FeedPurchase** — feedType, qty, unitCost, vendor, date, receipt attachment → inventory in.

**Inventory & projections** — on-hand = purchases − consumption. Daily demand is *derived from active FeedingPlans* (Σ quantity × frequency across assigned animals/groups), correctable by manual consumption entries (a torn bag, an extra bale). **Run-out date = onHand ÷ dailyDemand**, with a "buy more" notification at `runOutDate − reorderLeadDays`.

**Cost per head** — consumption valued at purchase cost, allocated to animals directly (animal plans) or split by headcount (group/zone plans), rolled into per-animal P&L and the feed-spend report. Client calves' allocations flow to their boarding invoices later.

### 5.4 Poultry module

**Flock** — species (`chicken | quail | ...` — quail is a dropdown value, not a new module), coop (Zone), breed mix, headCount maintained by an **adjustment log** (`added | died | predator | culled | sold`, qty, note) so count history is auditable.

**EggLog** — date, flock/coop, total count, optional breakdown rows by `{color, size, count}`. Kiosk quick-entry: tap +1 buttons at the coop; detailed breakdown optional on the same screen.

**EggDisposition** (lightweight, optional) — date, qty, `kept | given | sold`, contact, price. Keeps the door open for real sales without pretending it's a business.

Hatching/incubation: not built; the module boundary leaves a clean seam if that changes.

### 5.5 Garden module

**Bed** — a child of a garden Zone: shape/position from the layout designer, type (`raised_bed | row`), dimensions, soil notes.

**Crop / Variety** — name, **family (for rotation logic)**, daysToMaturity, spacing, source. **SeedInventory** — variety, qty, packedForYear, source, germination notes.

**Planting** — bed, variety, method (`direct_sow | transplant`), optional indoor start date, plantedDate, expectedHarvestDate (derived), status. **CareLog** — bed/planting, action (`fertilize | water | weed | pest_treatment | amend`), product, notes.

**SeasonPlan → planting notifications.** A per-season plan of **PlannedPlanting** entries: `{variety, method (indoor_start | direct_sow | transplant), target bed, window}` — the window auto-derives from the property's growing zone + the variety's timing, or is set manually. When a planned window opens, a notification fires (*"start tomatoes indoors this week," "direct-sow okra window opens Friday"*), and one tap converts the plan into a real Planting record — the same planned→actual pattern as PlannedMating → BreedingRecord. Notifications fire only for what's *in the plan*, not the whole seed catalog; the general planting calendar remains browseable for everything else.

**Rotation guard** — each bed keeps its crop-family history; planting the same family in a bed within a configurable window (default 3 years) raises a visible warning in the designer.

**HarvestLog** — planting, date, qty, unit. **PreservationLog** — method (`canned | frozen | dried | fermented`), qty, date, storage location — your pantry inventory.

**Planting calendar** — derived from the property's growing zone (dynamic; Fort Worth ≈ 8b today, but it's a property setting): per-crop sow/transplant windows and frost dates projected onto the unified calendar.

### 5.6 Equipment module

**Equipment** — name, category (`vehicle | trailer | implement | tool`), make/model/year, VIN/serial, photos, purchase info, status, attachments (manuals, receipts). Seeded: gooseneck cattle trailer, hay bale buggy.

**MaintenanceRule** — per equipment: trigger `every N engine-hours | N miles | N months` (any combination), task, parts. **MeterReading** — hours/miles logs drive due calculations. **MaintenanceLog** — date, task, cost, parts, meter snapshot. **FuelLog** — date, gallons, cost, meter → consumption and cost-of-operation stats.

**EquipmentCandidate** (extends PurchaseCandidate, §5.1) — a specific unit you are evaluating. Adds: category, make, model, **year**, **mileage** and/or **engine hours**, VIN/serial, condition, title status (`clean | rebuilt | lien | bill of sale only`), service history available, warranty remaining, known faults, and tyre/track or implement condition where it matters. Where both mileage and hours are known the comparison view shows **price per mile and per hour**, which is the only honest way to compare a low-hour expensive unit against a high-hour cheap one.

**EquipmentRoadmap** — Roadmap items with priority + budgetEstimate. Seeded: truck (**need, ASAP**), tractor (want), ATV (want). Candidates hang off these items, so the truck wishlist entry accumulates the actual trucks you looked at.

### 5.7 Business module (scaffold — full schema + rules now, UI in Phase 5)

**Customer** — user (role `customer`) + contact + QuickBooks customer id (nullable).

**BookingRequest** (`/book`, public) — customer details, calf details (dob, sex, breed, weaned?, visible ID?), requested drop-off, services → **admin approve/decline**. Approval runs the eligibility rules and creates the agreement + client animal records.

**BoardingAgreement** — customer, rates {dailyBoard, feedRate}, packages[] (`halter_breaking | hair_growing | showing_service | ...` with prices), startDate, estPickupDate, liabilityFormId, status, termination record (date, reason) for the behavior clause.

**ProgramEnrollment** — the training/showing program is **decoupled from ownership**: any Animal, `own` or `client`, can be enrolled, so your own show calves run through the identical pipeline as customers'. Fields: animal, **halterColor** (every calf in the program has one — **defaults to black**, rendered as a color swatch on the Pen Board chip, program roster, stall cards, and profile header, so anyone in the barn can match calf to halter at a glance), startDate, targetEndDate, inside + outside zone assignments, feeding requirements (FeedingPlan), packages/goals. **Client enrollments additionally carry**: owner, dropOffDate, estPickupDate, the BoardingAgreement, invoice lines, and owner-responsibility notes (medical/vaccines are the owner's per your rules — tracked as owner-provided records, not your vet workflow). Own-animal enrollments skip billing, liability, and the drop-off eligibility rules. The program roster shows everything enrolled regardless of ownership — which is also your real capacity picture, since your own calves occupy the same pens and hours.

**TrainingLog & Milestones** — dated entries per **enrollment** (so they apply equally to your own calves); milestone flags: `haltered, leads, sets_up, washed_blown, loads` with achieved dates. Milestones are what customers see for their animals; your own calves' progress stays internal.

**ProgramSchedule (added v0.6)** — the show barn's daily rhythm as data. A program-wide **default template** of time-slotted activities — `morning_chores | rinse | blow_dry | exercise | training | evening_chores | feeding | custom` — where any activity can repeat (rinse at 10:00 *and* 4:00; hair-growing season means more slots). Each enrollment can **override the template** (this calf rinses 3×, that one gets extra stick work), and packages can imply schedule additions (the hair-growing package adds rinse/blow slots automatically). The schedule generates **daily checklist instances per calf** that merge into the farm-wide chore system — checkable from the kiosk, with completion logged per calf per slot so you can see at 2 p.m. exactly who's had their second rinse and who hasn't. Missed-slot alerts follow the normal overdue-chore path.

**ShowEntry** — customer-created (their transport, their supplies): show name, date, location, and a `requestUsToShow` flag that triggers your approval + the extra fee on the invoice.

**LiabilityForm** — versioned template (adapted from your existing form), **e-signature** (typed/drawn name, timestamp, IP, form version) with an immutable PDF snapshot attached; visible in both admin and customer views; unsigned form blocks drop-off.

**RuleEngine** — your rules encoded as first-class, testable policy objects, evaluated at booking and continuously against DOB (**client enrollments only** — your own calves bypass eligibility gates):

| Rule | Enforcement |
|---|---|
| Must be weaned at drop-off (no pairs unless cow is here for breeding) | Booking checklist gate |
| Under 6 months old at drop-off | Hard validation from DOB |
| Tagged / visible ID | Booking checklist gate |
| Bulls ringed by 8 months | Auto deadline event + escalating notifications |
| Bulls depart by 10 months | Auto deadline + pickup scheduling prompt |
| Heifers/steers depart by 12 months | Auto deadline + pickup scheduling prompt |
| Behavior termination clause | Manual action with documented incident log |
| Owner pays feed & supplies | Feed allocations flow to invoice lines |
| Owner liability for damages / no responsibility assumed / owner handles medical | Encoded in liability form text + agreement record |

**Invoice** — line items (board days, feed allocation, packages, showing fee, damages); **QuickBooks Online adapter** behind an `InvoicingProvider` port (OAuth + customer/invoice sync when you launch — the port exists from day one so nothing needs restructuring).

### 5.8 Pets module

**Pet** — Animal subtype (species `dog | cat`), reusing HealthRecord (vaccines, meds), FeedingPlan, vet visits (Contact), photos, and free-form notes. Pets appear in the housesitter guide automatically.

### 5.9 Horses module (placeholder)

Module skeleton with stub routes for herd / pens / feeding / breeding ("coming soon" shells so navigation and permissions are already real), plus an **active HorseRoadmap** and **HorseCandidate** now — the latter extending PurchaseCandidate (§5.1) with breed, age, sex, height, training level and discipline, soundness and vet-check status, temperament notes, and registration. Horses are the purchase furthest out and the one most worth researching slowly, so the shopping surface is live long before the module is — same Roadmap aggregate as cattle, so goals, target acquisitions, and budget planning start today. When horses arrive, the build is filling in a prepared module, not designing one.

### 5.10 Housesitting module

**CareGuide** — a composed document: auto-sections pulled *live* (animals grouped by pen **with each pen's effective safety level leading its section and per-animal safety badges/notes**, merged care instructions and feeding plans; today's/weekly chores; emergency contacts; vet info; equipment quirks) + custom sections you write. Three outputs from the same source: **print-perfect PDF**, **`/sitter` limited login** (read + chore check-off, time-boxed), and **kiosk Housesitter Mode**. Update a feeding plan anywhere and every format is already current.

### 5.11 Supplies module (added v0.3)

Everything the ranch runs on that isn't feed, medicine, or engine-bearing equipment — from shavings to show sticks.

**SupplyItem** — name, kind (`consumable | durable`), category (`bedding | show_and_fitting | tack | pen_hardware | feeding_gear | pasture_seed_chem | poultry | general`), unit, qtyOnHand, reorderThreshold, storageLocation, photo. Seeded from your list: shavings, nesting pads, Revive and other fitting/hair-care products (consumables); panels, gates, feed pans, bunks, halters, neck ties, show halters, show sticks, combs (durables).

**SupplyPurchase** — item, qty, unitCost, vendor (Contact), date, receipt attachment — the same purchase/cost pattern as feed, so every dollar the ranch spends lands in one reporting model.

**SupplyUsage** (consumables) — qty, date, optional target (animal or zone); decrements stock and triggers a **low-stock notification** at the reorder threshold. Usage tagged to a client calf flows straight onto its boarding invoice lines in Phase 5 — this is the mechanism behind your "owners pay for all feed and supplies" rule.

**Durable tracking** — count (24 panels), condition, optional assignment to a zone or animal (which show halter lives with which calf), and a retired/lost/damaged log.

Route: `/admin/supplies`. Builds in Phase 2.

## 6. Cross-cutting services

**Unified calendar** (`/admin/calendar`, kiosk board) — projected events from every module: breeding protocol steps, preg checks due, calving windows, withdrawal-period ends, booster schedules, med expirations, feed run-out, maintenance due, rule deadlines (bull ring / departures), drop-offs & est. pickups, planting windows, chores, manual events. Filter by module; month/week/agenda views.

**Chores** — cross-farm daily checklist generated from templates; kiosk check-off; overdue escalation.

**Notifications** — email now (Resend), web push later behind the same `Notifier` port. Default triggers: vaccine/booster due · withdrawal ending · preg check due · calving window opening · sync-protocol step today · feed run-out approaching · med expiring · maintenance due (hours/miles/date) · bull ring due · bull/heifer/steer departure approaching · new booking request · liability form unsigned near drop-off · drop-off/pickup reminders · planting window opening (per season plan, indoor & outdoor) · chore overdue · low semen inventory · supply low-stock · purchase-candidate sale date approaching · candidate listing expiring · frost warning · tank-freeze warning · calving watch (pressure drop / full moon / cold snap inside a due window). Per-trigger opt-out and lead-time settings.

**Weather, moon phases & calving watch** — a `WeatherProvider` port with two adapters: **Open-Meteo** (free for non-commercial use, no API key, hourly forecasts including surface pressure) as primary and the **National Weather Service API** (free, official US watches/warnings) for alerts. A scheduled function polls forecasts for the property's coordinates and projects onto the calendar and notifications:

- **Frost warnings** for the garden: forecast low below a configurable threshold (default 36 °F) during the growing season.
- **Tank-freeze alerts:** when forecast lows cross a hard-freeze threshold (default 28 °F, or sustained sub-32), you're alerted the evening before, and a *"break ice / verify tank heaters"* chore is auto-injected for each freeze day — **one per active WaterSource**, naming every zone it serves, with heaterless sources called out as the vulnerable ones. Per §5.1 the chore is derived per tank, never per zone: tanks are shared, and one chore per zone would send someone to the same trough more than once. The evening-before alert carries a second, earlier list: **the covers to put on** (added v1.4) — every active tank whose cover exists and is off, raised once for the first freeze in the forecast rather than once per freeze day, because nobody puts the same cover on three nights running. It is the only piece of freeze work that is useless done late.
- **Calving watch:** for every cow inside her calving window (due date ± 14 days, configurable), the dashboard shows a watch card and notifications fire when the window coincides with a **full moon** (± 1 day — computed locally with an astronomy library, so moon phases render on the calendar indefinitely and offline), a **rapid barometric fall** (default ≥ 4 hPa / ~0.12 inHg within 24 h) or forecast low-pressure trough, or a **cold snap** (calf-chill threshold, default 20 °F). Example alert: *"Front arriving Thursday night + full moon Friday — Dolly is at day 279."*
- Licensing seam: Open-Meteo's free tier is non-commercial; when the boarding business launches, its inexpensive commercial plan or a full switch to NWS closes the gap — both sit behind the same port.

**Reports** — cost per head · per-animal & herd P&L · feed spend and consumption trends · **supply spend by category & whole-farm operating cost** · egg production trends (by coop/color/size) · herd inventory growth vs. roadmap targets · processing yields (dressing %, $/lb realized) · equipment cost of ownership · **capital planning — open wishlist items, their budgets, and the candidates under consideration against them** · business revenue (Phase 5). All exportable to CSV.

## 7. Route map

```
/                               landing (public, later)
/book                           public booking request (Phase 5)
/login
/invite/[token]                 set a first password from a single-use invitation; public by
                                necessity, since the account cannot be signed in to yet

/admin                          dashboard: today's chores, alerts, calving countdowns, run-outs
/admin/map                      property map — draw pens/pastures over aerial photo,
                                drag animal chips between zones, tap for instructions
/admin/pastures                 care logs (seed/overseed, fertilize, spray, mow), rest status,
                                seasonal reminders, per-pasture cost history
/admin/calendar                 unified calendar
/admin/chores                   templates + today
/admin/reports
/admin/contacts                 CRM: vets, buyers/sellers, vendors, customers + linked history

/admin/cattle                   herd list
/admin/cattle/[id]              profile tabs: overview · pedigree · breeding · health ·
                                weights · feeding · finance · photos
/admin/cattle/breeding          heat log, sync protocols, semen tank, breedings, preg checks
/admin/cattle/calving
/admin/cattle/health            treatments, withdrawal board, med inventory
/admin/cattle/weights           weights, ADG, unadjusted 205-day
/admin/cattle/supplies          semen tank, medicine fridge, sync protocols
/admin/cattle/feed              feeding plans per animal & group
/admin/cattle/sales             acquisitions, sales, processing records
/admin/cattle/roadmap           genetic goals, target size, planned matings
/admin/cattle/candidates        breeding stock & show prospects under consideration
/admin/cattle/ancestors         external animals: ancestors on paper that are not ours
/admin/cattle/catalogue         search the crawled association herdbooks; bring an animal across
/admin/cattle/risks             eight checks across the herd: open cows, rebreeds, losses, defects

/admin/feed                     inventory, purchases, run-out projections, cost per head
/admin/supplies                 ranch supply inventory: consumables, show/fitting gear, hardware
/admin/chickens/flock           flocks & headcount log
/admin/chickens/eggs            logs + trends
/admin/garden/layout            visual designer (beds/rows, rotation warnings)
/admin/garden/plantings         + care logs
/admin/garden/seeds
/admin/garden/harvest           + preservation
/admin/equipment                fleet · /admin/equipment/[id] · /admin/equipment/roadmap
/admin/equipment/candidates     purchase candidates: compare units, true cost, links, decision log
/admin/pets
/admin/horses                   what is live and what is coming · /admin/horses/roadmap (active)
/admin/horses/herd              shell (§5.9) — who is here and what each is like to handle
/admin/horses/pens              shell — which horse is in which trap
/admin/horses/feeding           shell — rations, and what a horse costs to keep
/admin/horses/breeding          shell — covers, foaling dates, what a cross was for
/admin/horses/candidates        horses under consideration (active)
/admin/business/*               scaffold: bookings · clients · program roster (own + client,
                                halter colors) · day schedule · forms · invoices
/admin/housesitter              guide builder + PDF + access management
/admin/settings                 branding (farm & business names), users/roles, property & zones,
                                feed types, breeds/gestation, notification prefs, kiosk devices, integrations
/admin/settings/trash           deleted records, restore, owner-only purge (§4.5 clause 4)

/account                        customer portal (scaffold): animals, milestones, forms, invoices, shows
/sitter                         housesitter view
/kiosk                          pen board · calendar · chores · egg entry · housesitter mode
```

## 8. UI/UX notes

### Design language (locked v0.8) — "Midnight Nebula / Bluebonnet Linen"

One brand, two modes sharing the same hue anchors. **Theme per surface:** `/admin` and `/kiosk` render Midnight Nebula (dark); `/account`, `/book`, `/sitter`, and public pages render Bluebonnet Linen (light). The neutrals mirror: admin's starlight text is the customer's linen sky, and the customer's violet ink is the admin's night surface.

| Role | Bluebonnet Linen (light) | Midnight Nebula (dark) |
|---|---|---|
| Canvas | `#F8F5EC` linen | `#0E1026` midnight |
| Panel / card | `#FFFFFF` | `#191C3C` |
| Text | `#24243A` ink | `#F2EFE6` starlight |
| Action — bluebonnet blue | `#35569E` | `#8CA3E8` |
| Identity — nebula purple | `#5F45B0` | `#9D85E8` |
| Calm — sage green | `#67805F` | `#A3BC9C` |

Role assignments: **bluebonnet blue** = every primary action, link, and interactive control on both sides; **nebula purple** = brand and identity moments (star mark, constellation pedigree lines, milestones, headers); **sage green** = calm states (resting pastures, signed forms, quiet confirmations). Sage is deliberately gray-leaning so the **safety scale (unchanged, saturated green→red, always numbered)** never competes with it. Brass gold `#C9A24B` is held in reserve as an optional "champion" accent for wins (show results, milestones) — currently unused. Signature elements: the **Double M brand logomark** and **pedigrees drawn as constellations** (ancestors as stars, descent as connecting lines — at full glory in dark mode). Typography across both modes: **Zilla Slab** for headings, **Inter** for UI and body, tabular figures wherever numbers carry meaning (weights, tags, straw counts).

- **Design system first** (`packages/ui`): tokens above, then components. Clean, professional, generous whitespace; no template feel. Distinct density modes: desktop (data-dense tables + side panels), mobile (card stacks, bottom nav, one-thumb logging), kiosk (oversized type + targets).
- **The Pen Board is the heart of the app** — the property map with live animal positions, merged instructions, halter-color swatches, and **safety-level color coding** (pen borders show effective level; chips show each animal's) is what you'll glance at ten times a day and what barn screens show by default.
- **SpatialEditor** (one component, two skins): property mode (satellite/aerial background, free polygons, animal chips) and garden mode (grid snap, bed shapes, planting chips, rotation warnings).
- **Property imagery — hybrid Google + owned (resolves v0.1 Q4):** pens are stored as real lat/lng polygons, so they render over any base layer. **Online**, the editor loads the **Google Maps JavaScript API satellite layer** and you trace/adjust pens directly over live imagery; Dynamic Maps includes 10,000 free map loads per month (a Google Cloud billing account must be on file), and this household's usage won't approach 5% of that. **Offline and on barn kiosks**, Google's terms don't permit storing its tiles, so the identical polygons render over an **owned, cached background**: a georeferenced **USDA NAIP** aerial image of the property — public-domain imagery covering the continental US at roughly 0.3–0.6 m resolution, refreshed on a 2–3-year cycle, downloadable free (USGS EarthExplorer / USDA Geospatial Data Gateway) — stored once in R2 and cached by the service worker. One data model, two interchangeable backgrounds, no terms-of-service risk, and the Pen Board works with zero bars in the barn.
- **Logging must be fast**: every frequent action (egg count, weight, treatment, chore) reachable in ≤2 taps from its context, with smart defaults (today's date, last-used product).

## 9. Hosting & cost options (decided: Option B — see below)

Prices verified August 2026; treat as estimates and re-verify before committing.

| | Option A — Free start | Option B — Usage-based (recommended) | Option C — Bundled |
|---|---|---|---|
| Frontend | Netlify free | Netlify free | Netlify free |
| Postgres | Supabase Free *used as plain Postgres* (500 MB DB — years of farm records; daily use avoids the 7-day pause) | **Neon Launch** — pure usage-based, no monthly minimum, ~$0.106/CU-hr + $0.35/GB-mo, scale-to-zero | Supabase Pro $25/mo (8 GB DB, bundled storage, always-on compute) |
| Photos/docs | Cloudflare R2 free (10 GB) | R2 free → pennies | Supabase storage (100 GB incl.) |
| Email | Resend free | Resend free | Resend free |
| **Est. total** | **$0/mo** | **~$1–8/mo** at your traffic | **~$25/mo** |
| Trade-off | Hard free-tier cutoffs; upgrade path is simply switching connection string | Bill scales with actual use; cold starts hidden by local-first reads | Simplest mentally; pays for capacity you won't use for years |

**Decision (v0.9): Option B across the board.** Netlify (frontend) + **Neon Launch** (usage-based Postgres, no monthly minimum, card on file required) + **Cloudflare R2** (photos/documents) + **Resend** (email). Expected bill at your scale: roughly $1–8/month, dominated by Neon compute; scale-to-zero cold starts are invisible because the local-first client never waits on the database for reads. The Google Maps satellite layer (§8) sits on its own Google Cloud billing account within its 10k-free-loads tier. Because everything speaks plain Postgres and S3-compatible storage, the eventual self-host migration (§10) remains a connection-string change.

## 10. Self-hosting migration path (later)

1. Postgres in Docker on a small home server/NUC; nightly `pg_dump` to R2 or a second disk from day one of self-hosting.
2. `pg_dump` from cloud → `pg_restore` at home. Change `DATABASE_URL`. Done — Drizzle migrations are plain SQL, Auth.js users live in the same DB.
3. Expose to the Netlify frontend via **Tailscale Funnel** or a Cloudflare Tunnel (no port-forwarding, no static IP needed).
4. Optional later: move the API itself home (application packages run unchanged in a Node container beside the DB); optional MinIO to bring photos home too. Kiosks on the barn LAN then work even when the internet is out entirely.

## 11. Build roadmap

**Phase 0 — Foundation (build first).** Monorepo + module skeletons, design system, Auth.js + roles, PWA shell, **sync engine** (the hard part — built and tested before features pile onto it), Property + Zones + SpatialEditor property mode, base Animal + photos, kiosk pairing.

**Phase 1 — Cattle core.** *Your cow is bred — this phase races her due date.* Cattle profiles + registrations, pedigree (incl. external ancestors), breeding records + due-date projection + calving-window alerts, calving flow (creates the calf), health + withdrawal tracking + med inventory, weights, feed module (types, purchases, plans, run-out, cost/head), pen board with live assignments, herd roadmap + planned matings, **purchase candidates** (the shared aggregate plus the cattle extension), semen inventory, sync protocols, **calving watch** (weather + moon monitoring for cows in a due window — pulled forward from Phase 3 because it applies to this pregnancy).

**Phase 2 — The rest of the daily farm.** Chickens (flocks, egg logs, kiosk egg entry), equipment (fleet, maintenance rules, fuel, roadmap — get the truck on the wishlist — and **equipment purchase candidates**, so the trucks you are actually looking at line up against each other), **horse candidates**, **supplies inventory**, **contacts CRM**, pets, chores, unified calendar, email notifications, **tank-freeze alerts** (rides on the Phase 1 weather service, lands before winter), **pasture care logs** (in time for fall overseeding), sales/processing records.

**Phase 3 — Garden.** Layout designer, seeds, plantings + care logs, rotation guard, harvest + preservation, zone-aware planting calendar, **season plan + planting notifications**, frost-warning notifications.

**Phase 4 — Sharing the farm.** Housesitter guide (PDF + `/sitter` login + kiosk mode), reports suite, settings polish, push notifications.

**Phase 5 — Business launch (~1 yr+).** Booking flow + approval, customer portal, e-signature liability forms, training milestones UI, show entries, invoicing + QuickBooks OAuth. (Schema, rules, and routes already exist from Phase 0/1 scaffolding.)

### 11.1 Quality gates (CI)

Every push and pull request runs the full gate, and **every check blocks the merge**. Nothing here is advisory. The gate exists because this is a two-person project with a real cow on a real due date — the pipeline is the code reviewer that is always available.

| Gate | What it enforces |
|---|---|
| Lint | Style and correctness rules across every package |
| Typecheck | `tsc --noEmit` on the whole workspace, no `any` escape hatches in domain code |
| **Architecture boundaries** | The §4.1 dependency rules, checked mechanically — `modules/*/domain` imports only `core`; modules never import each other; domain never reaches for infrastructure, React, or Next; only `apps/web` composes |
| **Route-map conformance** | Every route in §7 exists in the app, and every route in the app appears in §7 — the spec and the router cannot drift apart silently |
| **Data-operations conformance** | The §4.5 contract: every registered entity declares a Zod schema, a full CRUD surface, and a delete behavior for each relationship; every delete path routes through the confirmation wrapper. An entity that skips a clause fails the build unless it is on the enumerated exception list |
| Unit tests + coverage | Domain and application logic under Vitest, with coverage thresholds that fail the build when they drop |
| Build | The production Next.js build compiles |
| E2E | Playwright smoke pass over the primary surfaces |

The point of expressing §4.1 and §4.5 as *executable* checks rather than prose is that architectural rules which are merely written down decay under deadline pressure. These do not decay; they fail the build.

## 12. Decision log

**v0.2 — v0.1 open questions resolved:**

1. **Registry data → manual entry.** All three associations run on Digital Beef, which exposes nothing programmatically. Registrations are entered by hand; a low-priority backlog item covers CSV import if Digital Beef's exports ever become worth parsing.
2. **Gestation → flat 283-day default** for all breeds, editable in settings. No Chi-influence adjustment needed.
3. **QuickBooks Online** confirmed for the Phase 5 invoicing adapter.
4. **Mapping → hybrid Google Maps + owned NAIP imagery** (full design in §8): live Google satellite for online pen editing, public-domain USDA aerial imagery cached for offline/kiosk rendering.
5. **Weather → yes**, including the full-moon and low-pressure calving watch (full design in §6), with calving watch pulled forward into Phase 1.

**v0.3 additions:**

6. **Tank-freeze alerts** with auto-injected ice-breaking chores, driven by per-zone water/heater flags (§6).
7. **Whole-ranch supplies module** (§5.11) — consumables and durable gear with purchases, usage, low-stock alerts, and client-calf usage flowing to future boarding invoices.
8. **Season plan → planting notifications** (§5.5) — indoor-start and outdoor windows alert only for planned varieties.
9. **Contacts expanded to a full CRM** (§5.1) with tags and linked buy/sell/vet/vendor/booking history at `/admin/contacts`.
10. **Farm & business names as global BrandingConfig** (§5.1) — undecided names set once in settings later, propagated everywhere; signed liability PDFs keep their as-signed name.

**v0.4 additions:**

11. **Program decoupled from ownership** (§5.7) — ProgramEnrollment replaces ClientAnimal, so personal herd calves run through the same training pipeline, roster, and milestones as customer calves; billing, liability, and eligibility rules attach only to client enrollments.
12. **Halter color per enrolled calf** (§5.7) — a required field on every enrollment, own or client, shown as a color swatch on Pen Board chips, the roster, stall cards, and profiles.

**v0.5 additions:**

13. **Safety/difficulty levels** (§5.1) — five-level, color-coded scale on every animal (with safety notes explaining why) and a baseline level on every pen/coop; a zone's effective level derives from max(baseline, most dangerous occupant), so moving an animal recolors the map instantly. Surfaced on the Pen Board, kiosks, rosters, and prominently in the housesitter guide and `/sitter` view so helpers know exactly what they may and may not interact with. Dams auto-suggest an elevated level from calving until cleared.

**v0.6 additions:**

14. **ProgramSchedule** (§5.7) — the show program's daily routine as a time-slotted template (morning chores, repeatable rinses, blow-outs, exercise, training, evening chores) with per-calf overrides and package-driven additions; generates per-calf daily checklists in the chore system, checkable from a new **Program Day Sheet** kiosk board (§4.4).
15. **Halter color defaults to black** (§5.7).

**v0.7 additions:**

16. **Pasture care** (§5.1) — per-zone logs for seeding/overseeding, fertilizing, spraying, mowing, dragging, and soil tests with rates and costs; seed/chem inventory in supplies; a resting status that dims the pasture on the map and challenges animal moves into it; seasonal recurring reminders (fall rye, spring fertilizer). Lands in Phase 2 ahead of fall overseeding.

**v0.8 additions:**

17. **Design language locked** (§8) — "Midnight Nebula" dark theme for `/admin` and `/kiosk`, "Bluebonnet Linen" light theme for `/account`, `/book`, `/sitter`, and public pages; shared bluebonnet-blue / nebula-purple / sage-green hue anchors at mode-tuned stops; mirrored neutrals (starlight ↔ linen, ink ↔ midnight); safety scale untouched; gold reserved as an optional champion accent; Zilla Slab + Inter with tabular figures; Double M brand logomark and constellation pedigrees as signature elements.

**v0.9 additions:**

18. **Hosting decided: Option B for everything** (§9) — Netlify + Neon Launch (usage-based Postgres) + Cloudflare R2 + Resend, est. $1–8/mo, with Google Maps on its own free-tier Google Cloud account; self-host path unchanged.

**v1.0 additions:**

19. **Data operations contract made non-negotiable** (§4.5) — full CRUD on every entity against a small, closed list of exceptions (derived read models, immutable legal/audit records, system-owned rows); one shared Zod schema per entity validating client forms, sync payloads, and API handlers alike; a three-tier confirmation requirement on every destructive action, naming the record and its dependents; soft delete with a restorable Trash and an owner-only purge; and a declared delete behavior on every relationship. Applies retroactively to every entity in §5 and forward to every entity added later.
20. **Quality gates are blocking** (§11.1) — lint, typecheck, architecture-boundary checks, route-map conformance against §7, data-operations conformance against §4.5, unit tests with coverage thresholds, production build, and Playwright e2e all run on every push and pull request, and all of them block. The §4.1 and §4.5 rules are expressed as executable checks rather than prose specifically so they cannot decay.

**v1.1 additions:**

21. **Purchase candidates** (§5.1, §5.2, §5.6, §5.9) — a generic aggregate for tracking the specific things under consideration before a large purchase, separate from the Roadmap wishlist item that says one is wanted. Shared fields (status pipeline, asking price, listing URL, seller from the CRM, distance, dates, photos, attachments, pros and cons) plus itemised `additionalCosts[]` so the comparison sorts on **total acquisition cost**, not sticker price. Extended per domain: equipment adds year, mileage, hours, VIN, title status and derived price-per-mile/hour; cattle adds breed composition, registration, EPDs, pedigree reference and sale/lot dates; horses add training level and soundness. Marking a candidate `purchased` converts it into the real Equipment or Animal record, the same planned→actual pattern used by PlannedMating and PlannedPlanting. Routes at `/admin/equipment/candidates`, `/admin/cattle/candidates`, `/admin/horses/candidates`.
22. **Logomark chosen: Flying Double M Connected** (§8) — two M's sharing a leg, with a crest on each outer shoulder, read outside in and top to bottom the way a registered brand is. Drawn in livestock-brand grammar, one colour and one stroke width in both variants, identity carrying the whole mark. Narrowed from thirteen candidates against the Texas & Southwestern Cattle Raisers Association's published grammar; the shared leg and the outward turn of the crests are both load-bearing, and the crests are the first thing to close below about 24px. Supersedes the Rocking Double Star, which held this slot while the brand was undecided. Admin and customer variants live in `packages/ui/src/brand/`. The wordmark still waits on the farm and business names.

**v1.2 additions:**

23. **The sync audit is a field-level change log, not a conflict-only log** (§4.2). Given only timestamps there is no way to distinguish a sequential edit from a concurrent one — that would need vector clocks or a server-assigned version per field, neither of which this design carries. Rather than invent a concurrency signal the data does not have, every superseded value is written down. A genuine conflict is therefore always recoverable, which is what the clause asks for, and any field's history can be reconstructed as a side benefit. The cost is a larger log than a conflict-only one would be; at two writers and a handful of kiosks that is not a meaningful cost. Revisit only if the log's volume ever becomes a problem, at which point vector clocks are the upgrade path.

**v1.3 additions:**

24. **Water is its own record** (§5.1, §6) — `WaterSource` with `hasHeater` and `active`, referenced many-to-many by `Zone.waterSourceIds`, replacing the `hasWaterTank` / `hasTankHeater` booleans. Forced by the real layout: four tanks serve eight zones, one serving three, so the per-zone freeze chore would have fired eight times for four tanks. Freeze chores derive per tank and name the zones served; a stowed seasonal tank raises nothing.
25. **`working_facility` zone type** (§5.1) — for the tub, chute, and alley. They hold cattle under handling but nothing lives there, and typing them as pens would put them on the Pen Board as occupied.

**v1.4 additions:**

26. **Per-field write times are stored server-side** (§4.2) — `sync_field_meta`, a row per (entity, record, field) holding when the field was written and by which device. Field-level LWW is unimplementable without it: the row's `updatedAt` is the time of the last change to *any* field, so a note written offline on Monday and pushed on Wednesday would lose to an unrelated rename on Tuesday and vanish without trace. A row per field rather than a JSON blob per record, so two pushes touching different fields cannot lose each other through a read-modify-write. A field with no recorded write and no value is treated as never written, so an uncontested first write always wins; a field holding a value but no write record — seeded or imported data — falls back to the record's `createdAt`.
27. **`updatedAt` is server arrival time, not device edit time** (§4.2) — it is the pull cursor, and a record stamped with a past timestamp would land behind cursors other devices already hold and never be delivered. The device's own edit time is preserved in `sync_field_meta`, which is where the merge reads it from, so nothing is lost by the distinction.
28. **Patch, merge, cursors, and the transport shapes live in the kernel** (§4.1, §4.2) — not in the sync adapter. The server runs the same merge the device runs, and §4.1 forbids one adapter importing another; two implementations of who-wins would agree until the afternoon somebody changed one of them.
29. **Every import must be declared, third-party as well as workspace** (§11.1) — `tests/architecture/boundaries.test.ts` fails the build on any package importing something its `package.json` does not list. Written while trying to make a checkout work on an exFAT volume, where `node-linker=hoisted` flattens `node_modules` and lets an undeclared import resolve anyway. That attempt was abandoned — pnpm symlinks workspace packages regardless of the linker, so exFAT cannot host this repo at all — but the check earned its place independently: it is the difference between a dependency graph that is declared and one that merely happens to work.
