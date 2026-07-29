# Documentation Index

The root [README](../README.md) is the user-facing entry point. Maintained documentation is grouped
by ownership below. `archive/` is a deletion queue for superseded records and is never an
authoritative source for current procedures.

## Project

| Document                             | Purpose                                                                 | Status     |
| ------------------------------------ | ----------------------------------------------------------------------- | ---------- |
| [Project status](project/status.md)  | Current scope, validation evidence, responsibilities, and open handoffs | Maintained |
| [Skill inventory](project/skills.md) | Repository skills and installed official plugin snapshot                | Maintained |

## Product Model

| Document                                                | Purpose                                                                | Status     |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ---------- |
| [Recommendation model](product/recommendation-model.md) | Score formulas, inputs, snapshot audit, risks, and improvement roadmap | Maintained |
| [Draft strategy tree](product/draft-strategy-tree.md)   | Ten-player draft state, policies, masking, and Top20 ranking           | Maintained |

## Recognition

| Document                                                                        | Purpose                                                            | Status     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------- |
| [Ability Draft layout geometry](recognition/ability-draft-layout.md)            | Camera, world-coordinate, plane, slot, and crop-quad specification | Maintained |
| [Ability Draft resource parsing](recognition/ability-draft-resource-parsing.md) | Read-only Source 2 extraction and comparison workflow              | Maintained |

## Overlays

| Document                                                                              | Purpose                                                                         | Status                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| [Lifecycle state machine](overlays/lifecycle.md)                                      | Current Desktop overlay ownership, readiness, shortcuts, and placement boundary | Maintained                              |
| [Game capture and attached-overlay design](overlays/game-capture-design.md)           | Proposed phase-2 target tracking, capture, GSI, and game-attached placement     | Future design; not shipped              |
| [Shared production-acceptance design](overlays/production-acceptance/shared.md)       | Cross-platform scenarios, evidence, privacy, and completion semantics           | Approved design; implementation pending |
| [Windows production-acceptance adapter](overlays/production-acceptance/windows.md)    | Windows artifacts, processes, DPI-aware screenshots, and environment matrix     | Approved design; implementation pending |
| [macOS production-acceptance adapter](overlays/production-acceptance/macos.md)        | macOS artifacts, quarantine, screenshots, Spaces, and evidence                  | Approved design; implementation pending |
| [Windows visual-validation incident](overlays/incidents/windows-visual-validation.md) | Open production and installed-package visual acceptance gap                     | Open until acceptance evidence exists   |

Acceptance designs are contracts, not operator commands. Move implemented procedures into the
platform guides only after the corresponding scripts and tests exist.

## Platform Guides

| Document                                                                            | Purpose                                                          | Status              |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------- |
| [Windows build and validation](platforms/windows/build-test.md)                     | Windows setup, Tauri builds, E2E, packaging, and manual checks   | Maintained          |
| [macOS build and release validation](platforms/macos/build-test.md)                 | Apple Silicon build, integrity, Gatekeeper, and WKWebView checks | Maintained          |
| [macOS release acceptance template](platforms/macos/release-acceptance-template.md) | Per-candidate integrity, first-open, and overlay evidence        | Maintained template |

## UI

| Document                                                              | Purpose                                                        | Status                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------ |
| [UI placement guidelines](ui/placement-guidelines.md)                 | Page hierarchy, spacing, responsive layout, and consistency    | Maintained               |
| [Tailwind v4 and Tauri migration](ui/tailwind-v4-migration-design.md) | Implemented architecture and remaining phase-3 acceptance work | Maintained design record |

## Active Development Records

| Document                                                                                         | Purpose                                     | Status                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------- |
| [Overlay delivery stability design](development/overlay-delivery-stability/design.md)            | Approved boundary for current overlay fixes | Active while work is uncommitted |
| [Overlay delivery stability plan](development/overlay-delivery-stability/implementation-plan.md) | Execution and verification record           | Active while work is uncommitted |

## Archive

[Archived documentation](archive/README.md) lists superseded records, maintained replacements, and
deletion conditions. Archived files are retained only for short-term history and audit context.

## Related Repository Guides

- [Golden screenshot fixtures](../tests/fixtures/README.md) defines fixture filenames, labels, and
  redistribution requirements.
- [Desktop icon source](../src-tauri/icons/README.md) records the source and generation method for
  bundled desktop icons.

## Maintenance Rules

- Keep user-facing behavior, supported platforms, and common commands synchronized with the root
  README.
- Update the recommendation model and its tests together with any visible scoring change.
- Mark unimplemented behavior as a limitation or open item; never present designs as shipped
  features.
- Record validation claims with the platform, date, and commands that actually ran.
- Move superseded records to `archive/`, document their replacement and deletion condition, then
  remove them in a separately reviewed cleanup.
