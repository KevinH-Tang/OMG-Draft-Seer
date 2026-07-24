# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the React/TypeScript application. Core layout, matching, recognition, tier, pair, and recommendation logic lives in `src/core/`; its tests are colocated as `*.test.ts` files. `src/workers/` contains the recognition worker, and `src/data/` contains the demo snapshot.
- `public/data/` stores runtime snapshots and icon signatures. Cached icons are under `public/assets/`; source hero selection images are under `heroes/selection/`.
- `scripts/` contains data synchronization, hero mapping, icon caching/signature generation, and verification utilities. `tests/fixtures/` is reserved for approved screenshot fixtures, while `docs/` and `reports/` hold project notes and generated reports.

## Build, Test, and Development Commands

Requires Node `22.12.0` (`.nvmrc`), npm `>=10`, and Rust `>=1.90` for Tauri. Use `npm ci` for locked dependencies; `npm run dev`, `npm run preview`, and `npm run desktop:dev` are persistent interactive commands.

Use `npm run format:check`, `npm run format:rust:check`, `npm test`, `npm run build`, and offline `npm run verify:runtime` for standard validation. `npm run lint:rust` runs Clippy with warnings denied. `npm run desktop:build` packages the Tauri application. Native E2E is Windows-only: run `npm run build:tauri:test` before `npm run test:tauri`.

For data refresh, run `sync:data`, `build:hero-map`, `build:icons`, `cache:icons`, `verify:icons`, `verify:runtime`, tests, and build in that order. `sync:data`, `build:icons`, `cache:icons`, and `verify:icons` may access Windrun or DatDota and update generated files; `cache:icons` prunes stale assets. Review the diff and licences before committing.

## Routine Command Authorization

The repository owner has pre-authorized these routine dependency and validation commands. Run them without requesting confirmation when needed for work in this repository:

- `npm ci`
- `npm test`
- `npm run build`
- `npm run format:rust`
- `npm run format:rust:check`
- `npm run lint:rust`
- `npm run check`
- `npm run verify:runtime`
- `npm run desktop:build`
- `npm run test:tauri`

These commands may need npm, crates.io, or EdgeDriver downloads when caches are cold. If sandbox networking blocks one, request elevation only for that command; this does not authorize data refreshes or releases.

Other npm commands, data refreshes, publishing, deployment, signing, notarization, and destructive operations require explicit authorization. The protected macOS release workflow is checked in, but its Apple credentials and release execution remain external authorization gates. Managed sandbox and organization policies still take precedence.

## Coding Style & Naming Conventions

Use TypeScript/TSX with two-space indentation, single quotes, and no semicolons, enforced by Prettier. Rust uses four spaces and Rustfmt. Name React components and types in `PascalCase`, functions and variables in `camelCase`, and fixed configuration constants in `UPPER_SNAKE_CASE`. Prefer small typed helpers and existing core abstractions. Use `npm run build` as the TypeScript type check.

## Testing Guidelines

Vitest tests live beside the implementation in `src/core/` and use descriptive `describe` blocks with behavior-focused `it` names. Add or update tests for matching, layout, recognition, and recommendation behavior when changing those areas. Screenshot fixtures must be `2560x1440` PNGs with a matching JSON label map; keep them out of the repository unless redistribution and licensing have been reviewed.

## Commit & Pull Request Guidelines

Follow the existing Conventional Commit style, for example `feat: improve icon matching` or `fix: clamp imported layout`. Pull requests should explain user-visible and data-pipeline changes, list validation commands run, and include screenshots for UI changes. Call out regenerated snapshots, cached assets, or third-party source/licensing considerations explicitly.
