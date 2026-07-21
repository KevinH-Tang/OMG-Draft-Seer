# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the React/TypeScript application. Core layout, matching, recognition, tier, pair, and recommendation logic lives in `src/core/`; its tests are colocated as `*.test.ts` files. `src/workers/` contains the recognition worker, and `src/data/` contains the demo snapshot.
- `public/data/` stores runtime snapshots and icon signatures. Cached icons are under `public/assets/`; source hero selection images are under `heroes/selection/`.
- `scripts/` contains data synchronization, hero mapping, icon caching/signature generation, and verification utilities. `tests/fixtures/` is reserved for approved screenshot fixtures, while `docs/` and `reports/` hold project notes and generated reports.

## Build, Test, and Development Commands

Run `npm install` once, then use `npm run dev` to start the Vite development server at `http://127.0.0.1:5173`. Run `npm test` for the Vitest suite, `npm run test:watch` during active development, and `npm run build` for TypeScript plus production-build validation.

When refreshing external data, run `npm run sync:data`, `npm run build:hero-map`, `npm run build:icons`, `npm run cache:icons`, and `npm run verify:icons` in that order. These commands contact public services and update files under `public/` and `reports/`, so review the resulting diff before committing.

## Coding Style & Naming Conventions

Use TypeScript/TSX with two-space indentation, single quotes, and no semicolons, matching the existing code. Name React components and types in `PascalCase`, functions and variables in `camelCase`, and fixed configuration constants in `UPPER_SNAKE_CASE`. Prefer small typed helpers and existing core abstractions. No repository formatter or linter is configured; keep changes consistent with neighboring files and use `npm run build` as the type check.

## Testing Guidelines

Vitest tests live beside the implementation in `src/core/` and use descriptive `describe` blocks with behavior-focused `it` names. Add or update tests for matching, layout, recognition, and recommendation behavior when changing those areas. Screenshot fixtures must be `2560x1440` PNGs with a matching JSON label map; keep them out of the repository unless redistribution and licensing have been reviewed.

## Commit & Pull Request Guidelines

Follow the existing Conventional Commit style, for example `feat: improve icon matching` or `fix: clamp imported layout`. Pull requests should explain user-visible and data-pipeline changes, list validation commands run, and include screenshots for UI changes. Call out regenerated snapshots, cached assets, or third-party source/licensing considerations explicitly.
