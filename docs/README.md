# Documentation Index

The root [README](../README.md) is the user-facing entry point. This directory contains only
maintained project documentation; historical plans and unrelated external project reviews have
been removed.

## Maintained Documents

| Document | Use it for | Update when |
| --- | --- | --- |
| [Project status](project-status.md) | Current scope, validation state, repository responsibilities, and open handoff items | A feature, platform check, generated asset, or release condition changes |
| [Recommendation metrics](recommendation-metrics.md) | The five-pick `Score`, Pair/Triple interactions, and displayed metrics | Recommendation logic or its tests change |
| [Score analysis](score-analysis.md) | Tradeoffs, statistical risks, and the improvement roadmap for recommendation scoring | The scoring model, validation evidence, or model roadmap changes |
| [Draft strategy tree](draft-strategy-tree.md) | The 10-player serpentine draft model, all-player policies, pool masking, and Top20 ranking | Draft-state implementation, strategy behavior, or masking assumptions change |
| [Windows build and validation](windows-build-test.md) | Windows setup, Tauri builds, and manual acceptance checks | Windows requirements or desktop release steps change |

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
