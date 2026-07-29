# Documentation Reorganization Implementation Plan

**Status:** Completed and archived. Use `docs/README.md` for the maintained documentation map.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize maintained documentation by topic, merge the recommendation-model documents,
and isolate superseded records under `docs/archive/` without losing current worktree edits.

**Architecture:** Keep `docs/README.md` as the only root-level document and treat each first-level
directory as one maintenance domain. Preserve platform-specific and lifecycle-specific documents as
separate units, merge only the two documents that own the same scoring model, and rewrite every
repository-relative Markdown link after moves.

**Tech Stack:** Markdown, Git, POSIX shell, Node.js link validation

---

### Task 1: Create the topic tree and move single-responsibility documents

**Files:**

- Move: `docs/project-status.md` → `docs/project/status.md`
- Move: `docs/project-skills.md` → `docs/project/skills.md`
- Move: `docs/draft-strategy-tree.md` → `docs/product/draft-strategy-tree.md`
- Move: `docs/dota2-ability-draft-layout.md` → `docs/recognition/ability-draft-layout.md`
- Move: `docs/dota2-ability-draft-resource-parsing.md` → `docs/recognition/ability-draft-resource-parsing.md`
- Move: `docs/overlay-lifecycle-state-machine.md` → `docs/overlays/lifecycle.md`
- Move: `docs/game-capture-overlay-design.md` → `docs/overlays/game-capture-design.md`
- Move: `docs/overlay-production-acceptance-design.md` → `docs/overlays/production-acceptance/shared.md`
- Move: `docs/windows-overlay-production-acceptance-design.md` → `docs/overlays/production-acceptance/windows.md`
- Move: `docs/macos-overlay-production-acceptance-design.md` → `docs/overlays/production-acceptance/macos.md`
- Move: `docs/windows-overlay-visual-validation-incident.md` → `docs/overlays/incidents/windows-visual-validation.md`
- Move: `docs/windows-build-test.md` → `docs/platforms/windows/build-test.md`
- Move: `docs/macos-build-test.md` → `docs/platforms/macos/build-test.md`
- Move: `docs/macos-release-acceptance-template.md` → `docs/platforms/macos/release-acceptance-template.md`
- Move: `docs/tailwind-v4-migration-design.md` → `docs/ui/tailwind-v4-migration-design.md`
- Move: `docs/ui-placement-guidelines.md` → `docs/ui/placement-guidelines.md`
- Move: `docs/superpowers/specs/2026-07-29-overlay-delivery-stability-design.md` → `docs/development/overlay-delivery-stability/design.md`
- Move: `docs/superpowers/plans/2026-07-29-overlay-delivery-stability.md` → `docs/development/overlay-delivery-stability/implementation-plan.md`

- [x] **Step 1: Create the destination directories**

Create the exact topic paths listed above, including the nested acceptance, incident, platform, and
development directories.

- [x] **Step 2: Move each document without rewriting its content**

Use path-only moves so existing staged or unstaged contents remain intact. Do not restore any file
from `HEAD` while moving it.

- [x] **Step 3: Verify the move inventory**

Run:

```bash
rg --files docs | sort
git status --short
```

Expected: every mapped destination exists, every former path is absent, and pre-existing source
edits appear as rename/delete-plus-add changes without losing their content.

### Task 2: Merge the recommendation model documents

**Files:**

- Read: `docs/recommendation-metrics.md`
- Read: `docs/score-analysis.md`
- Create: `docs/product/recommendation-model.md`
- Remove after coverage check: `docs/recommendation-metrics.md`
- Remove after coverage check: `docs/score-analysis.md`

- [x] **Step 1: Build the normative first half**

Move the purpose, inputs, validation rules, Individual Base, Pair/Triple effects, Triple residual,
final score, build search, and validation material from `recommendation-metrics.md` into
`product/recommendation-model.md` under `# Recommendation Model` and `## Model Contract`.

- [x] **Step 2: Build the audit second half**

Append the current-position summary, formula audit, snapshot audit, data-coverage limitations,
advantages, risks, future improvements, and bottom line from `score-analysis.md` under
`## Model Audit And Roadmap`. Remove only duplicated explanations of the same formula or public API
coverage conclusion.

- [x] **Step 3: Prove source coverage before removing sources**

Compare all source level-two headings and distinctive formula identifiers against the destination.
Expected destination coverage includes `Individual Base`, `Pair and Triple Effects`, `Triple
Residual`, `Final Score`, `Snapshot Audit`, `Data Coverage`, `Remaining Risks`, and `Future
Improvements`.

- [x] **Step 4: Remove the two superseded source files**

Remove them only after Step 3 passes; they are merged sources, not historical records that need to
remain in `archive/`.

### Task 3: Rewrite maintained indexes and cross-document links

**Files:**

- Modify: `docs/README.md`
- Modify: `README.md`
- Modify: all moved documents containing relative Markdown links

- [x] **Step 1: Replace the documentation index**

Rewrite `docs/README.md` as a topic-based index with one section per maintained directory. Each
entry states its purpose and status. Keep a separate archive section that warns readers not to use
archived records as current instructions.

- [x] **Step 2: Update root README links**

Replace every former `docs/<name>.md` target with its exact new topic path, including the merged
`docs/product/recommendation-model.md` destination.

- [x] **Step 3: Update links inside moved documents**

Resolve each link relative to its destination. In particular:

- platform guides link to `../../overlays/production-acceptance/` and nearby platform templates;
- project status links to sibling product, overlay, and platform directories through `../`;
- overlay lifecycle and game-capture documents use same-directory links;
- acceptance adapters link to `shared.md` in the same directory;
- the Windows incident links to `../production-acceptance/windows.md`.

- [x] **Step 4: Search for stale paths**

Run an explicit search for every former root-level filename and `docs/superpowers/` path. Expected:
no maintained repository file points to a former location.

### Task 4: Normalize the archive and remove abandoned structure

**Files:**

- Move: `docs/archive/PLAN.md` → `docs/archive/tauri-tailwind-platform-plan.md`
- Modify: `docs/archive/README.md`
- Move after implementation: `docs/development/docs-reorganization-design.md` → `docs/archive/documentation-reorganization-design.md`
- Move after implementation: `docs/development/docs-reorganization-plan.md` → `docs/archive/documentation-reorganization-plan.md`
- Remove if empty: `docs/superpowers/plans/`
- Remove if empty: `docs/superpowers/specs/`
- Remove if empty: `docs/superpowers/`

- [x] **Step 1: Give the legacy plan a descriptive archive name**

Preserve its contents and status banner; only the path changes.

- [x] **Step 2: Turn the archive README into a deletion queue**

List each archived record, the reason it is obsolete, the maintained replacement, and the condition
under which it can be deleted. State that archived content is non-authoritative.

- [x] **Step 3: Retire this cleanup's process artifacts**

After all implementation and validation steps pass, move the current design and plan into the
archive because they no longer describe active work. Update links in `docs/README.md` accordingly.

- [x] **Step 4: Remove empty abandoned directories**

Delete only directories confirmed empty after their files have moved. Do not delete any archived
record during this task.

### Task 5: Validate the complete documentation tree

**Files:**

- Verify: `README.md`
- Verify: all `docs/**/*.md`

- [x] **Step 1: Assert the root invariant**

Run:

```bash
find docs -maxdepth 1 -type f -print
```

Expected: only `docs/README.md`.

- [x] **Step 2: Validate every local Markdown link**

Run a read-only Node script that extracts Markdown link targets, ignores anchors and external URLs,
resolves each target from its source file with `node:path`, and fails with the source and target for
every missing local file.

Expected: zero missing targets.

- [x] **Step 3: Audit old paths and archive authority**

Search the full repository for former document paths, `docs/superpowers/`, and maintained links to
the archived plan. Expected: no stale paths and no archived plan presented as a current procedure.

- [x] **Step 4: Audit merge coverage**

Confirm `docs/product/recommendation-model.md` contains all required formula and audit sections from
Task 2 and neither source file remains.

- [x] **Step 5: Check formatting and final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; status shows the intended documentation moves/edits plus the user's
pre-existing unrelated code changes.
