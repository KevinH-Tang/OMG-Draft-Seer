# Documentation Reorganization Design

**Status:** Archived after the documentation cleanup completed. This is a historical design record,
not a current documentation map.

## Goal

Reorganize `docs/` into topic-based subdirectories, merge documents that have the same maintenance
responsibility, remove abandoned index content, and keep superseded records under `docs/archive/`
while they await deletion.

## Decisions

The maintained documentation uses these topic boundaries:

- `project/` owns current project status and repository tooling/skill inventory.
- `product/` owns recommendation and draft-strategy behavior.
- `recognition/` owns Dota 2 layout geometry and resource extraction guidance.
- `overlays/` owns the current overlay lifecycle, future capture design, production acceptance
  contracts, and unresolved incident records.
- `platforms/windows/` and `platforms/macos/` own operator-facing platform build, test, and release
  procedures.
- `ui/` owns frontend layout and styling architecture.
- `development/` owns active implementation designs and plans that still correspond to current
  work.
- `archive/` owns superseded historical records that are not authoritative for current work.

`docs/README.md` remains the only root-level document. It is the documentation map and records the
maintenance boundary for every topic.

## Merge And Archive Boundaries

`recommendation-metrics.md` and `score-analysis.md` describe one recommendation model from normative
and audit perspectives. They become `product/recommendation-model.md`, with the formula and input
contract first and the audit, limitations, and improvement roadmap afterward. Repeated scope,
coverage, and conclusion text is reduced without dropping distinct evidence.

The shared, Windows, and macOS overlay production-acceptance designs remain separate files under
`overlays/production-acceptance/`. They share a topic but not a maintenance responsibility: the
shared contract defines portable evidence, while each adapter defines platform-specific artifact,
window, screenshot, and environment rules. Combining them would create an oversized document and
make platform changes harder to review.

The Windows overlay visual-validation incident remains maintained while its production and
installed-package acceptance criteria are open. It moves under `overlays/incidents/` instead of the
archive.

The completed Tauri/Tailwind platform implementation plan remains in `archive/` and is explicitly
non-authoritative. The current overlay-delivery design and implementation plan move from generated
`superpowers/` paths into `development/overlay-delivery-stability/` because they still correspond to
uncommitted implementation work. Empty legacy directories are removed after their contents move.

## Link And Content Rules

All repository links are rewritten to the new paths. Relative links inside moved documents are
resolved from their new directory rather than replaced with absolute filesystem paths. Historical
archive documents may link to maintained guides, but maintained documents must not rely on archived
plans as current instructions.

Moves preserve all existing uncommitted edits. A merge may remove only duplicated explanations,
superseded status wording, or abandoned navigation; unique formulas, evidence, limitations,
procedures, and acceptance conditions remain represented in the destination.

## Validation

Completion requires all of the following evidence:

1. `docs/` contains only `README.md` at its root and the documented topic directories.
2. Every Markdown link to a local file resolves from the source document.
3. Repository searches find no references to the former document paths or legacy `docs/superpowers/`
   paths.
4. The recommendation-model destination contains the normative formulas, validation contract,
   snapshot audit, limitations, and future-improvement material from both source documents.
5. `docs/archive/README.md` identifies every archived record and states why it is awaiting deletion.
6. `git diff --check` reports no whitespace errors.
