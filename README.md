# Galaxy Farm

A local-first progressive web app for running a family beef-cattle operation and homestead near Fort Worth, TX — built to grow into a show-calf boarding and training business.

It manages registered cattle (Maine-Anjou, Chianina, Shorthorn), laying flocks, a garden, farm equipment, pets, ranch supplies, and — later — client calves and horses. One codebase serves three surfaces: a full admin experience on desktop and mobile, touch-first kiosk screens mounted in the barn, and a scaffolded customer portal for the boarding business.

> **Status: Phase 0 in progress.** The shared kernel, the confirmation primitive, the sync engine, and the local store are built and tested. The routes still render placeholders — no screen is wired to the domain yet. See [Current state](#current-state).

The full product and architecture specification lives in [`docs/galaxy-farm-spec.md`](docs/galaxy-farm-spec.md) (v1.4), with UI mockups in [`docs/galaxy-farm-mockups-complete.html`](docs/galaxy-farm-mockups-complete.html). The spec is the source of truth; this README is the map.

---

## Non-negotiables

These three qualities drive nearly every technical decision in the project, in priority order:

1. **Local-first / offline-capable.** Barn connectivity is spotty. Every read and write hits an on-device store instantly; a sync engine reconciles with the server when signal returns.
2. **Clean architecture with obsessive modularization.** Each farm domain is an isolated module with pure domain logic, so new domains (horses, quail, a second property) bolt on without touching existing ones.
3. **Portability.** Cloud-hosted frontend forever; cloud-hosted Postgres now, migrating to a self-hosted box at the farm later — with zero application code changes.

Corollaries worth stating outright:

- **The domain layer knows nothing about the web, the database, or the cloud.** Entities and use cases are pure TypeScript, testable without any infrastructure.
- **Speak only standard Postgres.** No provider-proprietary APIs, no vendor auth. That is what makes the eventual move home a `pg_dump | pg_restore`, not a rewrite.
- **One Animal model, many species.** Cattle, flocks, pets, client calves, and future horses share a kernel and extend per species. The boarding business reuses the same entities with an owner attached — no parallel system.
- **Derive, don't duplicate.** Due dates derive from breeding records, feed run-out from feeding plans, rule deadlines from birth dates, the housesitter guide from live data. Manual entry is for facts, not for the consequences of facts.
- **Nothing is a dead end.** Every record you can create, you can find, edit, and remove — validated on the way in, confirmed on the way out. See [the data operations contract](#the-data-operations-contract) below.

## The data operations contract

**Non-negotiable, and enforced by CI** — spec §4.5. A feature is not done until it satisfies all four clauses.

**1. Full CRUD, everywhere it applies.** Every entity gets a list view, a detail view, a create form, an edit form, and a delete action. No write-only screens; no record that can only be fixed by opening a SQL client. The exceptions are enumerated and closed — derived read models (calendar projections, P&L, run-out dates, effective safety level), immutable legal and audit records (signed liability PDFs, the sync audit log), and system-owned rows (migrations, device tokens). Anything not on that list gets the full surface.

**2. Validated input at every boundary.** One Zod schema per entity, imported by the client form, the sync payload, and the API handler — the same schema, not three that drift. The sync push handler re-validates: data is not trusted just because it came from our own client. Invariants Zod can't express (a calving date can't precede its breeding date, straw count can't go negative) live in the domain layer and are enforced in the use case. Errors surface per field.

**3. Confirmation before every destructive action.** No delete happens on a single unconfirmed tap, on any surface. The dialog names the record _and_ its dependents — "Delete pen _North Trap_? 4 animals are currently assigned to it," never a bare "Are you sure?" Three tiers: **Standard** (dialog + undo toast), **Elevated** (dependents listed; PIN on kiosk), **Typed** (type the record's name — for whole-aggregate deletes like an animal, zone, or contact). The same rule covers irreversible non-deletes: voiding an invoice, terminating an agreement, revoking a kiosk device.

**4. Soft delete, restore, purge.** Deletes write a tombstone, not a `DELETE`. Records leave the lists but stay restorable from Trash for a retention window (default 30 days); permanent purge is a separate owner-only, Typed-tier action. This is what makes the confirmations honest — the answer to "what if I misclick" is always "restore it" — and it's what lets deletions replicate to kiosks instead of resurrecting on the next sync pull.

Every relationship additionally declares its delete behavior — `restrict`, `cascade`, or `detach`. A relationship without one is a build error, not a runtime surprise.

## Stack

| Concern              | Choice                                                                        |
| -------------------- | ----------------------------------------------------------------------------- |
| Framework            | Next.js 15+ (App Router) + TypeScript                                         |
| Monorepo             | pnpm workspaces + Turborepo                                                   |
| Database             | PostgreSQL — Neon Launch now, self-hosted later                               |
| ORM / migrations     | Drizzle (SQL-first, plain migration SQL)                                      |
| Local store          | Dexie (IndexedDB) + a custom sync engine                                      |
| Validation           | Zod — one schema per entity, shared by forms, sync payloads, and API handlers |
| Auth                 | Auth.js v5, credentials + Postgres adapter (users live in _our_ database)     |
| PWA / service worker | Serwist                                                                       |
| Photos & documents   | Cloudflare R2 via presigned URLs (S3-compatible)                              |
| Email                | Resend                                                                        |
| UI                   | Tailwind + shadcn/ui on top of a custom design system package                 |
| Charts               | Recharts                                                                      |
| PDF                  | @react-pdf/renderer + print stylesheets                                       |
| Testing              | Vitest (domain / use cases) + Playwright (smoke e2e)                          |
| Hosting              | Netlify frontend · Neon Postgres · Cloudflare R2 · Resend (~$1–8/mo)          |

## Repository layout

```
galaxy-farm/
├── apps/
│   └── web/                        Next.js — presentation + composition root ONLY
│       ├── app/
│       │   ├── (public)/           landing, /book, /login
│       │   ├── (admin)/admin/      full management UI
│       │   ├── (account)/account/  customer portal (scaffold)
│       │   ├── (sitter)/sitter/    housesitter limited view
│       │   ├── (kiosk)/kiosk/      barn touch screens
│       │   └── api/                sync push/pull, auth, storage presign, weather cron
│       └── e2e/                    Playwright smoke tests
├── packages/
│   ├── core/                       shared kernel: base Animal, Zone, Task, value objects,
│   │                               domain events, ports, Result type
│   ├── modules/                    one isolated package per farm domain, each containing
│   │   ├── cattle/                   src/domain/       entities, services, ports
│   │   ├── feed/                     src/application/  use cases, queries, DTOs
│   │   ├── poultry/                  tests/
│   │   ├── garden/
│   │   ├── equipment/
│   │   ├── supplies/
│   │   ├── business/               scaffold — schema + rules now, UI in Phase 5
│   │   ├── pets/
│   │   ├── horses/                 placeholder module; roadmap and shopping live
│   │   └── housesitting/
│   ├── infrastructure/
│   │   ├── db/                     Drizzle schema, migrations, Postgres repositories
│   │   ├── local/                  Dexie schema, IndexedDB repositories
│   │   ├── sync/                   outbox, cursors, conflict resolution
│   │   ├── storage/                Cloudflare R2 adapter
│   │   ├── email/                  Resend adapter
│   │   ├── weather/                Open-Meteo + NWS adapters (frost, freeze, calving watch)
│   │   ├── auth/                   Auth.js wiring against our own Postgres
│   │   └── quickbooks/             port defined now, adapter in Phase 5
│   ├── ui/                         design system, SpatialEditor, charts, kiosk kit, PDF
│   └── config/                     shared tsconfig / eslint / tailwind presets
└── docs/                           specification and mockups
```

### Dependency rules (to be lint-enforced)

These are the rules that keep the modularization real rather than aspirational:

- `modules/*/domain` imports only `core`. Nothing else. Ever.
- `modules/*/application` imports its own domain + `core`.
- Modules never import each other. They communicate through IDs and domain events — `CalvingRecorded` prompts the feed module to offer a creep plan; the business module listens for `AnimalAgeThresholdReached`.
- `infrastructure/*` implements repository ports defined in the domain layers.
- `apps/web` is the only place everything meets — dependency injection happens at the route level.

The payoff: when the database moves home, only `infrastructure/db`'s connection string changes. If the API moves home too, the application packages lift into a standalone Node service unchanged.

## Architecture notes

**Sync engine (`infrastructure/sync`).** The UI always reads from IndexedDB via live queries, so it works with zero bars in the barn. Every mutation writes atomically to the local store _and_ an outbox (ULID, entity, field patch, timestamp, deviceId). When online the outbox drains to `/api/sync/push`, where the server applies field-level last-write-wins and records an audit log so a rare conflict is recoverable rather than silent. Pulls use per-entity `updatedAt` cursors; deletions ship as tombstones. Photos are compressed client-side, queued, and uploaded to R2 via presigned URLs — the record stores the key immediately and renders a placeholder until it syncs.

**Roles.** `owner` · `member` · `customer` (`/account` only) · `housesitter` (`/sitter`, time-boxed) · `kiosk` (device token, whitelisted quick actions, PIN for anything else). Permission checks live in the application layer — use cases declare the capability they need — not in UI conditionals.

**Kiosk mode (`/kiosk`, spec §4.4).** A barn screen pairs itself: an owner mints a one-time code from `/admin/settings` → Kiosk devices, and the screen redeems it at `/kiosk/pair` for a long-lived device token, unauthenticated — the one page under `/kiosk` `middleware.ts` lets a signed-out visitor reach, because pairing is how it gets a session at all. From then on the device signs in through its own Auth.js `Credentials` provider as role `kiosk`, holding the same full local store and pull-only sync every other surface does — its outbox stays empty, since `/api/sync/push` refuses anything that is not `owner` or `member`, and its three whitelisted writes (`chores.complete`, `eggs.log`, `animals.move`) go through dedicated server actions that call `applyPush` directly, attributed to the device rather than a person. A revoked device (Settings, or the screen's own "Unpair this screen") stops both pulling and writing within one sync interval via a live check against `kioskDevices`, not merely whenever a stateless JWT happens to expire. Every board — Pen Board, Calendar, Today's Chores, Egg Quick-Entry, Housesitter Mode — is real; Program Day Sheet stays an honest placeholder because the `ProgramSchedule` domain it needs is Phase 5. A shared, scrypt-hashed PIN (`kioskDevices`' sibling table `kiosk_pins`, deliberately outside the sync/entity machinery so its hash is never a column a device could be sent) gates that one self-unpair action and any Elevated-tier action taken by a person using `/kiosk` as themselves. See [`docs/kiosk-hardware.md`](docs/kiosk-hardware.md) for what to actually mount in the barn.

**Safety levels.** A farm-wide five-level handling scale (green → red, always numbered) on every animal, with notes explaining _why_. Every zone carries a baseline level, and its effective level derives as `max(zone baseline, highest-level animal currently inside)` — so a green pen turns red the moment the bull is moved into it, everywhere at once.

**Planned becomes actual in one tap.** Three surfaces share this pattern, and it is worth recognising as a pattern rather than reinventing it each time: a `PlannedMating` converts to a `BreedingRecord`, a `PlannedPlanting` converts to a `Planting`, and a `PurchaseCandidate` marked _purchased_ converts to the real `Equipment` or `Animal` — carrying the price, the seller, the photos, and the paperwork across. Nothing is typed twice, and the record of what you considered survives alongside what you chose.

**Purchase candidates decide on true cost, not sticker price.** A wishlist item says "truck, need, ASAP"; a candidate is a specific 2018 F-250 with 96k miles and a link. Costs are itemised — hauling, inspection, immediate repairs — so the comparison sorts on **total acquisition cost**. Equipment candidates derive price per mile and per hour; cattle candidates carry registration, EPDs, and sale dates that land on the calendar, because an auction lot is a deadline. Spec §5.1.

**The unified calendar is a projection, not a diary.** `/admin/calendar` and the kiosk Calendar board draw one list out of many: calving windows and preg checks from the breeding records, every step of a sync protocol worked back from the day the cow was bred, withdrawal ends and boosters from the health log, med expiries from the fridge, feed run-out and its reorder point from the purchase and consumption logs, service due from the fleet's meters and intervals, chores from their templates — plus the handful of events somebody genuinely typed, which are the only stored half. Each module projects its own rows and `packages/core` merges them without learning what any of them are (§4.1); `projectedId(kind, entity, id)` is a row's identity, so recomputing the month twice gives the same rows rather than a second copy of them. Correct the breeding date on the animal's page and the window here moves, because there was never a duplicate to go stale. Filter by module, month/week/agenda views, and all of it read from the device's own store. Spec §6.

**The Pen Board is the heart of the app.** The property map with live animal positions, merged care instructions, halter-color swatches, and safety-level color coding is what gets glanced at ten times a day and what barn screens show by default.

**Design language — "Midnight Nebula / Bluebonnet Linen."** One brand, two modes sharing hue anchors. `/admin` and `/kiosk` render dark (Midnight Nebula); `/account`, `/book`, `/sitter`, and public pages render light (Bluebonnet Linen). Bluebonnet blue drives every primary action, nebula purple marks brand and identity moments, sage green signals calm states. Zilla Slab for headings, Inter for UI, tabular figures wherever numbers carry meaning. Signature elements: the star logomark and pedigrees drawn as constellations. Full token table in §8 of the spec.

**Branding is configuration, not strings.** The farm name and business name are undecided; both live in settings with env-var fallbacks and inject into every page title, header, email, PDF, kiosk board, and portal page. Set them once whenever they're chosen. The one exception: signed liability PDFs keep the business name as it read at signing, because those are immutable legal records.

## Build roadmap

| Phase                    | Scope                                                                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Foundation**       | Monorepo + module skeletons, design system, Auth.js + roles, PWA shell, **sync engine**, Property + Zones + SpatialEditor, base Animal + photos, kiosk pairing                                                                     |
| **1 — Cattle core**      | Profiles + registrations, pedigree, breeding + due-date projection, calving flow, health + withdrawal tracking, weights, feed module, pen board, herd roadmap, purchase candidates, semen inventory, sync protocols, calving watch |
| **2 — The daily farm**   | Chickens + egg logs, equipment + maintenance, equipment & horse purchase candidates, supplies, contacts CRM, pets, chores, unified calendar, email notifications, tank-freeze alerts, pasture care, sales & processing             |
| **3 — Garden**           | Layout designer, seeds, plantings + care logs, rotation guard, harvest + preservation, planting calendar, season plan notifications, frost warnings                                                                                |
| **4 — Sharing the farm** | Housesitter guide (PDF + `/sitter` + kiosk mode), reports suite, settings polish, push notifications                                                                                                                               |
| **5 — Business launch**  | Booking flow + approval, customer portal, e-signature liability forms, training milestones UI, show entries, invoicing + QuickBooks OAuth                                                                                          |

Phase 1 races a real due date — the cow is already bred — which is why calving watch was pulled forward from Phase 3.

## Testing and CI

Every gate below runs on each push and pull request, and **every one of them blocks the merge** (spec §11.1). Point branch protection at the single `CI` check — it aggregates the rest, so adding a gate later needs no reconfiguration.

```bash
pnpm install
pnpm verify        # format + lint + typecheck + tests with coverage + build
pnpm test:e2e      # Playwright, run separately (it builds and serves the app)
```

| Command              | Gate                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `pnpm format:check`  | Prettier                                                             |
| `pnpm lint`          | ESLint, including the §4.1 layering rules as `no-restricted-imports` |
| `pnpm typecheck`     | `tsc --noEmit` across all 21 packages, via Turborepo                 |
| `pnpm test`          | Vitest — architecture, conformance, and guard suites                 |
| `pnpm test:coverage` | The same, with thresholds that fail the build                        |
| `pnpm build`         | Production Next.js build                                             |
| `pnpm test:e2e`      | Playwright smoke pass over every surface                             |

### What the tests actually check

On a codebase this young, the valuable tests are the ones that constrain how it grows. These do:

- **`tests/architecture/boundaries.test.ts`** — builds the real import graph (via TypeScript's own pre-processor, so it sees `import type`, re-exports, and dynamic `import()`) and asserts the §4.1 rules: domain imports only `core`, modules never import each other, `core` depends on nothing, infrastructure never reaches into module internals, and only `apps/web` composes infrastructure. It also fails if a package imports a workspace dependency it never declared.
- **`tests/architecture/route-map.test.ts`** — parses the route map out of spec §7 and diffs it against the filesystem **in both directions**. A route in the spec that nobody built is a missing feature; a route in the app the spec never mentioned is an undocumented surface with undefined permissions. It also asserts each surface pins the theme §8 assigns it.
- **`tests/guards/`** — the executable form of the [data operations contract](#the-data-operations-contract). One suite applies the guards to the repo; the other proves the guards themselves work, against fixtures, so they are known to bite before there is anything to catch.
- **`tests/architecture/spec-contract.test.ts`** — keeps the non-negotiables from quietly vanishing out of the spec, and the README from drifting from what the spec says.
- **`tests/tools/`** — unit tests for the analysers underneath all of the above. A parser that silently missed `export … from` would turn every architecture assertion into a false pass.

523 unit tests and 84 e2e tests, at 97% statement and 97% branch coverage.

### A note on the guards

The §4.5 guards are convention checks over source text, not type-level proofs. That is deliberate: they cost nothing, they work on a codebase that is still mostly unwritten, and they fail loudly the moment someone adds a delete button with no dialog behind it. They are not a substitute for component tests asserting that a _specific_ dialog naming the _right_ dependents appears — write those too, as the screens land.

## Current state

### Built

- **`packages/core`** — the shared kernel. `Result`, ULIDs, value objects (safety levels, unit-tagged quantities, integer-cent money, date ranges), eleven entities each with a Zod schema, domain events, ports, and the §4.5 contracts. Plus `makeCrudUseCases`, so every entity gets its five operations from one tested implementation rather than a hand-rolled copy per module.
- **`packages/ui`** — the confirmation primitive every destructive action routes through, in all three tiers. Nothing else of the design system yet.
- **`packages/infrastructure/sync`** — field-level patches, last-write-wins per field with an audit trail, an outbox with capped exponential backoff, per-entity cursors, and the engine that drives push and pull against a transport port.
- **`packages/infrastructure/local`** — the IndexedDB store, a device-persisted outbox that survives the app being killed, and live queries so a barn kiosk redraws when someone moves an animal from the house.
- **`packages/infrastructure/db`** — the Drizzle schema and migrations, the Postgres repository, and the server side of sync. Verified against real PostgreSQL 18 in CI via PGlite. No extensions, integer cents, timezone-aware timestamps throughout.
- **The logomark** — **Flying Double M Connected**, in `packages/ui/src/brand/`, paired for both surface themes. No wordmark; the names are still open (#26).

One repository contract is shared by all three implementations — in-memory, IndexedDB, and Postgres. A disagreement between the local store and the server store shows up as data appearing on one device and not another, which is the hardest class of bug to notice here, so the contract is written once and run three times rather than written three times.

### Not built

- **No screen is wired to the domain.** All 55 routes from spec §7 resolve and render `PagePlaceholder`.
- **`/api/sync/push` and `/api/sync/pull` still answer 501.** The handlers behind them are built and tested — what is missing is auth. Both take the property from the caller's session, and until there is a session to take it from, publishing these routes would be an unauthenticated write endpoint into the farm's database. They stay 501 until #7 lands.
- **The migrations have never run against Neon.** They are verified against real Postgres, but the managed database is unreachable from CI; see below.
- **No auth**, no PWA service worker, no kiosk pairing.
- **No design system** beyond the confirmation dialog. The §8 tokens live in `packages/config/tailwind.preset.ts`; the components that consume them do not exist.
- The kernel entities have no use cases yet, so they appear in the CRUD guard's "not started" list. That is deliberate — see [the note on the guards](#a-note-on-the-guards).

### Next steps

1. **The design system** (#3) — nothing can be looked at until the components that consume the §8 tokens exist.
2. **Auth.js and roles** (#7), which is also what unblocks the two sync routes.
3. **Property, Zones, and the SpatialEditor** (#8), against the real nine-zone layout in `docs/property-layout.md`.
4. Then Phase 1 cattle — the cow is already bred, so that phase races a real due date.

Raise the coverage thresholds in `vitest.config.ts` as the domain packages fill in. Never lower them to make a red build green.

### Running migrations

```bash
cp .env.example .env.local     # then fill in DATABASE_URL
pnpm db:migrate
```

Needs Node 22+ and pnpm 10. On Windows, `corepack enable` is the reliable way
to get pnpm — it reads the pinned version from `package.json` rather than
installing a global that may not be on PATH.

The runner applies the numbered SQL files in order, once each, inside a
transaction, and prints what it applied. It is deliberately not `drizzle-kit
push`, which diffs the schema and applies whatever it decides — fine on a
laptop, not against a database holding calving records.

CI verifies the migrations against PostgreSQL 18 running in-process through
PGlite, so the SQL is known to apply before it ever reaches a real server.

**On a push to `main`, CI then applies them for real.** The `migrate` job runs
`pnpm db:migrate:deployed` against the `DATABASE_URL` repository secret — the
same runner, taking the connection string from the environment instead of from
a gitignored `.env.local`. It runs on pushes to `main` only: a pull request's
migrations have not been reviewed yet, and a fork's PR is not given secrets at
all.

It waits on the test job rather than on the whole `ci` gate, because the test
job is the one that actually validates the migration files, and putting the
twenty-minute e2e run in front of it would leave the deployed code without its
schema for that long. Every migration is additive and old code ignores a
column it does not know about, so applying one ahead of a build that later
fails is safe — applying one late is what caused a sync outage.

**This does not fully close the race.** Netlify starts building from the same
push, independently, and may publish before the migration lands. What it costs
is smaller than it was: the sync routes detect the drift and return a 503 with
a plain explanation rather than a bare 500, and the migration follows within a
few minutes. Closing it properly means moving the migration into Netlify's own
build command so a deploy cannot publish without it.

### Environment

Copy `.env.example` to `.env.local` and fill it in. It covers `DATABASE_URL` (Neon), the Auth.js secret, Cloudflare R2 credentials, the Resend API key and sender, the Google Maps browser key, and the `NEXT_PUBLIC_FARM_NAME` / business-name branding fallbacks. `.env.local` is gitignored and must stay that way — no real value belongs in `.env.example`.

### Email

`RESEND_API_KEY` and `EMAIL_FROM` are the whole of it. Both are read in exactly one place — `apps/web/lib/notifier.ts`, the composition root — and everything else asks for the kernel's `Notifier` port, which is what makes §6's "web push later" a change to that one file.

**Invitations are emailed.** Adding somebody, and re-issuing a link for somebody who never accepted or has forgotten their password (§4.3 makes those one action), sends them the single-use link. The screen still shows that link once, because the email is the convenience and the shown link is the guarantee — Resend can be unreachable, a sender domain unverified, an address wrong by a letter, and in every one of those cases the account already exists and somebody still has to be able to get in. The box says which of the two happened, and turns red when the email did not go.

**Check it from the app.** `/admin/settings` → People has a **Test email** button on every row. It sends a real email through Resend and reports what came back: the provider's message id on success, and on failure Resend's own words rather than a generic apology, because an unverified domain, a revoked key and a typo in `EMAIL_FROM` are indistinguishable from outside and only Resend knows which it is. Owner-only, like everything else on that screen.

**The sender needs a verified domain.** `flyingdoublemranch.com` is verified with Resend — DKIM plus SPF on the `send` subdomain, DNS at Cloudflare — so `EMAIL_FROM` is an address on it and mail goes to anybody. The mailbox itself need not exist; nothing replies to it.

With `EMAIL_FROM` unset, sending falls back to Resend's shared `onboarding@resend.dev`, which accepts every message and delivers only to the address the Resend account was opened with. That is enough to prove the wiring and no use at all for alerting a housesitter — so the app says so in a box on the People screen rather than leaving somebody to work it out from an empty inbox. Any future domain follows the same path: add it at [resend.com/domains](https://resend.com/domains), publish the records it gives you, point `EMAIL_FROM` at it.

Set both in `.env.local` for a laptop **and** in the Netlify environment variables for the deployed site. A key set in only one of the two is the failure that looks like the button being broken.

### A note on where the working copy lives

It needs a filesystem with symlinks. pnpm links the 21 workspace packages to
each other that way, and `node-linker=hoisted` does not change that — it
covers third-party packages only. exFAT has no reparse points at all, so a
checkout there cannot install. NTFS is fine; pnpm uses junctions on Windows,
which need no elevation.

Avoid OneDrive-synced folders. `node_modules` is hundreds of thousands of
small files, Files On-Demand can dehydrate them into placeholders that fail a
build with "file not found" on something visibly present, and a sync conflict
inside `.git/objects` corrupts the repository.

## License

See [LICENSE](LICENSE).
