# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev           # Vite dev server at http://127.0.0.1:5173
npm test              # Run Vitest suite (all tests)
npm run test:watch    # Watch mode during development
npm run build         # TypeScript check + production build (use as type check)
npm run format:check  # Repository-wide Prettier check
npm run verify:runtime # Offline runtime asset graph check

npm run desktop:dev   # Tauri dev (repository-pinned Rust 1.90.0)
npm run desktop:build # Tauri production bundle
npm run format:rust:check # Rustfmt check
npm run lint:rust     # Clippy with warnings denied

# Run a single test file
npx vitest run src/core/recommendation.test.ts
```

## Data pipeline (contacts public services — review diffs before committing)

```sh
npm run sync:data       # Fetch Windrun snapshot → public/data/snapshots/latest.json
npm run build:hero-map  # Validate hero templates → reports/hero-selection-map.json
npm run build:icons     # Build template signatures → public/data/icon-signatures.json
npm run cache:icons     # Cache display icons → public/assets/
npm run verify:icons    # Check remote/local icon inputs → reports/icon-self-check.json
npm run verify:runtime  # Offline runtime asset graph check (terminal only)
```

After refreshing data, complete the remaining refresh sequence documented in `AGENTS.md`, then run
runtime verification, tests, and the production build.

## Architecture

`src/App.tsx` is the application shell and workflow coordinator. Page-level views are split into
components under `src/components/`, including analysis recommendations, Tier, Pairs, Draft Replay,
debug crop preview, manual candidate confirmation, and native overlay views. Shared UI primitives
live under `src/components/ui/`. There is no global state library; the shell owns workflow state
with React hooks and passes typed data and callbacks into the page components.

**Core modules** (`src/core/`):

- `layout.ts` — 60-slot layout document (12 heroes, 36 abilities, 12 ultimates); slot geometry, scaling, cropping. Default layout loaded from `omg-layout-2560x1440.json`.
- `template-matching.ts` + `recognition.ts` — icon matching; template path derives a `16×16` grayscale luma signature + mean RGB. `recognition.ts` provides color-only fallback.
- `tiers.ts` / `pairs.ts` — tier list and pair/triple synergy tables built from the bundled Windrun snapshot.
- `recommendation.ts` — exhaustive five-pick build scorer (1 hero + 3 abilities + 1 ultimate). `Score` = logit base + Pair effects + complete Triple residuals. Caches `ScoreContext` via `WeakMap<Snapshot, ...>`. Cap: `MAX_COMBINATION_EVALUATIONS = 50_000`.
- `draft-state.ts` / `draft-turns.ts` / `draft-strategy.ts` / `draft-tree.ts` — 10-player serpentine draft replay. `draft-turns.ts` defines the 50-pick turn order; `draft-strategy.ts` ranks candidates per `tier-first` or `pair-first`; `draft-tree.ts` simulates the full replay frame-by-frame.

**Recognition worker** (`src/workers/recognizer.worker.ts`): Spawned by `App.tsx` for each re-slice.
Receives `ImageBitmap` + layout + abilities + signatures; returns `RecognizedSlot[]` via
`postMessage`. Uses `OffscreenCanvas`; requires `createImageBitmap`, `Worker`, and
`OffscreenCanvas` (checked by `src/platform/capabilities.ts`).

**Platform adapters** (`src/platform/`):

- `resources.ts` — resolves `appResourceUrl`, local icon URLs, and DatDota CDN fallback URLs.
- `storage.ts` — `localStorage`-backed layout persistence.
- `files.ts` — browser `File` import/export adapter.
- `overlays.ts` — synchronized Tier and recommendation overlay state.
- `capabilities.ts` — detects `createImageBitmap` / `Worker` / `OffscreenCanvas` at runtime.

**Runtime data** (committed, not generated at build time):

- `public/data/snapshots/latest.json` — Windrun snapshot (abilities, heroes, stats, pairs, triples).
- `public/data/icon-signatures.json` — template signatures consumed by the worker.
- `public/assets/` — cached hero and ability display icons.
- `src/data/demoSnapshot.ts` — fallback when the snapshot cannot be loaded.

**Key types** (`src/types.ts`): `Ability`, `Hero`, `AbilityStats`, `PairStats`, `TripletStats`, `Snapshot`, `RecognizedSlot`, `Recommendation`, `IconSignature`.

## Style & Conventions

TypeScript/TSX uses two-space indentation, single quotes, and no semicolons, enforced by Prettier.
Rust uses Rustfmt and Clippy. Use `PascalCase` for components/types, `camelCase` for
functions/variables, and `UPPER_SNAKE_CASE` for fixed constants. `npm run build` is the TypeScript
type check. Vitest tests are colocated with core, platform, and script implementations; native
desktop E2E tests live under `tests/tauri/`.

## Important Constraints

- The browser build must be served over HTTP — `file://` is not supported.
- `2560×1440` is the baseline layout. Other sizes are scaled proportionally.
- Do not hard-code absolute filesystem paths. Build repository paths from relative segments or
  runtime path sources with the host platform's path semantics.
- `reports/`, `dist/`, `node_modules/`, `src-tauri/target/`, `src-tauri/gen/` are generated — do not commit.
- Screenshot fixtures in `tests/fixtures/` must be `2560×1440` PNGs with a matching JSON label map; keep them out of the repository unless redistribution and licensing have been reviewed.
- Windrun data, DatDota icons, local VPK-derived hero images, and the desktop favicon require source/redistribution licence review before release.
- The Windrun API returns a bounded Top-N Pair/Triple set (7,500 pairs, 10,000 triples) — the snapshot is not a complete relation database. Partial triples (2,472 complete, 7,528 partial) are kept as diagnostics only and do not enter the `Score` formula.
