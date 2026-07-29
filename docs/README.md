# Documentation Index

The root [README](../README.md) is the user-facing entry point. This directory contains maintained
specifications, platform guides, status records, and explicitly labelled future or historical design
records. Superseded plans belong in the archive and must not be presented as current instructions.

## Maintained Documents

| Document                                                                                    | Use it for                                                                                                                   | Update when                                                                         |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Project status](project-status.md)                                                         | Current scope, validation state, repository responsibilities, and open handoff items                                         | A feature, platform check, generated asset, or release condition changes            |
| [Project skill inventory](project-skills.md)                                                | Repository-local skills and installed official Codex plugin skills                                                           | A local skill, installed plugin, marketplace snapshot, or skill list changes        |
| [Overlay lifecycle state machine](overlay-lifecycle-state-machine.md)                       | Current overlay open/close states, shortcut event flow, diagnostic evidence, and cross-platform invariants                   | Overlay ownership, shortcut delivery, readiness, or window lifecycle changes        |
| [Windows overlay visual validation incident](windows-overlay-visual-validation-incident.md) | Open Windows production overlay visibility issue, E2E false-positive boundary, diagnostic evidence, and acceptance criteria  | Windows overlay rendering, native visibility evidence, or visual validation changes |
| [Recommendation metrics](recommendation-metrics.md)                                         | The five-pick `Score`, Pair/Triple interactions, and displayed metrics                                                       | Recommendation logic or its tests change                                            |
| [Score analysis](score-analysis.md)                                                         | Tradeoffs, statistical risks, and the improvement roadmap for recommendation scoring                                         | The scoring model, validation evidence, or model roadmap changes                    |
| [Draft strategy tree](draft-strategy-tree.md)                                               | The 10-player serpentine draft model, all-player policies, pool masking, and Top20 ranking                                   | Draft-state implementation, strategy behavior, or masking assumptions change        |
| [Windows build and validation](windows-build-test.md)                                       | Windows setup, Tauri builds, and manual acceptance checks                                                                    | Windows requirements or desktop release steps change                                |
| [macOS build and release validation](macos-build-test.md)                                   | Apple Silicon prerequisites, unsigned GitHub Release integrity, Gatekeeper first-open steps, and WKWebView manual acceptance | macOS requirements, release process, or manual checks change                        |
| [macOS release acceptance template](macos-release-acceptance-template.md)                   | Per-candidate Apple Silicon integrity, first-open, and overlay evidence                                                      | An unsigned macOS release candidate is accepted                                     |
| [Tailwind v4 and Tauri migration design](tailwind-v4-migration-design.md)                   | Tauri-first delivery phases, design tokens, localization, and native E2E architecture                                        | UI architecture, desktop test strategy, or migration scope changes                  |
| [UI placement guidelines](ui-placement-guidelines.md)                                       | UI element placement, page hierarchy, responsive layout, and consistency checks                                              | Shared layout rules or the page shell changes                                       |
| [Dota 2 Ability Draft layout geometry](dota2-ability-draft-layout.md)                       | Authoritative camera, world-coordinate, plane, slot, and crop-quad geometry specification                                    | Projection inputs, resource geometry, or runtime layout behavior change             |
| [Dota 2 Ability Draft resource parsing](dota2-ability-draft-resource-parsing.md)            | Read-only Source 2 extraction and comparison workflow for refreshing camera, Panorama, scene, slot, and model inputs         | The inspected Dota 2 build, relevant resource CRCs, or extraction tools change      |

## Future Design

| Document                                                          | Use it for                                                                                       | Status                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| [Game capture and overlay design](game-capture-overlay-design.md) | Proposed Windows/macOS ARM game-window tracking, GSI, capture, and external overlay architecture | Future design; not a shipped feature |

## Historical Archive

These records preserve implementation and audit history but are not current procedures:

- [Merged Tauri/Tailwind and platform plan](archive/PLAN.md)

## Local Guides

- [Golden screenshot fixtures](../tests/fixtures/README.md) describes fixture filenames, labels, and
  redistribution requirements.
- [Desktop icon source](../src-tauri/icons/README.md) records the source and generation method for
  bundled desktop icons.

## Maintenance Rules

- Keep user-facing behavior, supported platforms, and common commands synchronized with the root
  README.
- Update the recommendation metrics document and tests together with any visible scoring change.
- Mark unimplemented behavior as a limitation or open item. Do not document plans as shipped
  features.
- Record validation claims with the platform, date, and commands that were actually run.
- Keep generated reports and runtime snapshots reproducible from the scripts in `package.json`.
