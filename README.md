# Galaxy Farm

A local-first progressive web app for running a family beef-cattle operation and homestead near Fort Worth, TX — built to grow into a show-calf boarding and training business.

It manages registered cattle (Maine-Anjou, Chianina, Shorthorn), laying flocks, a garden, farm equipment, pets, ranch supplies, and — later — client calves and horses. One codebase serves three surfaces: a full admin experience on desktop and mobile, touch-first kiosk screens mounted in the barn, and a scaffolded customer portal for the boarding business.

> **Status: scaffolding.** The directory structure below exists, but every source file is an intentionally empty placeholder. Nothing builds or runs yet. See [Current state](#current-state).

The full product and architecture specification lives in [`docs/galaxy-farm-spec.md`](docs/galaxy-farm-spec.md) (v0.9), with UI mockups in [`docs/galaxy-farm-mockups-complete.html`](docs/galaxy-farm-mockups-complete.html). The spec is the source of truth; this README is the map.

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

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15+ (App Router) + TypeScript |
| Monorepo | pnpm workspaces + Turborepo |
| Database | PostgreSQL — Neon Launch now, self-hosted later |
| ORM / migrations | Drizzle (SQL-first, plain migration SQL) |
| Local store | Dexie (IndexedDB) + a custom sync engine |
| Validation | Zod — one schema per entity, shared by forms, sync payloads, and API handlers |
| Auth | Auth.js v5, credentials + Postgres adapter (users live in *our* database) |
| PWA / service worker | Serwist |
| Photos & documents | Cloudflare R2 via presigned URLs (S3-compatible) |
| Email | Resend |
| UI | Tailwind + shadcn/ui on top of a custom design system package |
| Charts | Recharts |
| PDF | @react-pdf/renderer + print stylesheets |
| Testing | Vitest (domain / use cases) + Playwright (smoke e2e) |
| Hosting | Netlify frontend · Neon Postgres · Cloudflare R2 · Resend (~$1–8/mo) |

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
│   │   ├── horses/                 placeholder module, roadmap active
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

**Sync engine (`infrastructure/sync`).** The UI always reads from IndexedDB via live queries, so it works with zero bars in the barn. Every mutation writes atomically to the local store *and* an outbox (ULID, entity, field patch, timestamp, deviceId). When online the outbox drains to `/api/sync/push`, where the server applies field-level last-write-wins and records an audit log so a rare conflict is recoverable rather than silent. Pulls use per-entity `updatedAt` cursors; deletions ship as tombstones. Photos are compressed client-side, queued, and uploaded to R2 via presigned URLs — the record stores the key immediately and renders a placeholder until it syncs.

**Roles.** `owner` · `member` · `customer` (`/account` only) · `housesitter` (`/sitter`, time-boxed) · `kiosk` (device token, whitelisted quick actions, PIN for anything else). Permission checks live in the application layer — use cases declare the capability they need — not in UI conditionals.

**Safety levels.** A farm-wide five-level handling scale (green → red, always numbered) on every animal, with notes explaining *why*. Every zone carries a baseline level, and its effective level derives as `max(zone baseline, highest-level animal currently inside)` — so a green pen turns red the moment the bull is moved into it, everywhere at once.

**The Pen Board is the heart of the app.** The property map with live animal positions, merged care instructions, halter-color swatches, and safety-level color coding is what gets glanced at ten times a day and what barn screens show by default.

**Design language — "Midnight Nebula / Bluebonnet Linen."** One brand, two modes sharing hue anchors. `/admin` and `/kiosk` render dark (Midnight Nebula); `/account`, `/book`, `/sitter`, and public pages render light (Bluebonnet Linen). Bluebonnet blue drives every primary action, nebula purple marks brand and identity moments, sage green signals calm states. Zilla Slab for headings, Inter for UI, tabular figures wherever numbers carry meaning. Signature elements: the star logomark and pedigrees drawn as constellations. Full token table in §8 of the spec.

**Branding is configuration, not strings.** The farm name and business name are undecided; both live in settings with env-var fallbacks and inject into every page title, header, email, PDF, kiosk board, and portal page. Set them once whenever they're chosen. The one exception: signed liability PDFs keep the business name as it read at signing, because those are immutable legal records.

## Build roadmap

| Phase | Scope |
|---|---|
| **0 — Foundation** | Monorepo + module skeletons, design system, Auth.js + roles, PWA shell, **sync engine**, Property + Zones + SpatialEditor, base Animal + photos, kiosk pairing |
| **1 — Cattle core** | Profiles + registrations, pedigree, breeding + due-date projection, calving flow, health + withdrawal tracking, weights, feed module, pen board, herd roadmap, semen inventory, sync protocols, calving watch |
| **2 — The daily farm** | Chickens + egg logs, equipment + maintenance, supplies, contacts CRM, pets, chores, unified calendar, email notifications, tank-freeze alerts, pasture care, sales & processing |
| **3 — Garden** | Layout designer, seeds, plantings + care logs, rotation guard, harvest + preservation, planting calendar, season plan notifications, frost warnings |
| **4 — Sharing the farm** | Housesitter guide (PDF + `/sitter` + kiosk mode), reports suite, settings polish, push notifications |
| **5 — Business launch** | Booking flow + approval, customer portal, e-signature liability forms, training milestones UI, show entries, invoicing + QuickBooks OAuth |

Phase 1 races a real due date — the cow is already bred — which is why calving watch was pulled forward from Phase 3.

## Current state

Every file in `apps/` and `packages/` is an **empty placeholder**. The tree exists so that the module boundaries and route map are settled before code lands; no configuration, dependencies, or implementation have been written yet.

That means, concretely:

- Root `package.json`, `pnpm-workspace.yaml`, and `turbo.json` are empty — `pnpm install` will not work yet.
- Every `package.json`, `tsconfig.json`, `page.tsx`, `route.ts`, and `index.ts` is a zero-byte stub.
- `.gitkeep` files hold otherwise-empty directories so the structure survives in git.

### Next steps

1. Fill in the workspace root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and the shared presets in `packages/config`.
2. Give each package a real `package.json` and `tsconfig.json` extending the base config.
3. Add the dependency-boundary lint rules so the layering above is enforced from the first commit, not retrofitted.
4. Build `packages/core` — base `Animal`, `Zone`, `Task`, value objects, domain events, `Result`.
5. Build the sync engine before features pile onto it. It is the hard part, and everything else assumes it works.

### Environment

`.env.example` is a placeholder to be filled in alongside the first working build. It will cover `DATABASE_URL` (Neon), Auth.js secrets, Cloudflare R2 credentials, the Resend API key, the Google Maps browser key, and branding fallbacks.

## License

See [LICENSE](LICENSE).
