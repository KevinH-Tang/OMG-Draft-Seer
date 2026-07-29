# Project Skill Inventory

This document records the skills available for OMG-Draft-Seer. It is an inventory, not a
replacement for the skill instructions themselves.

## Snapshot

- Recorded: 2026-07-29
- Official marketplace: `openai-api-curated`
- Installed plugin snapshot: `11c74d6b`
- Total inventory: 53 skills
- Repository-local skills: 3
- Installed official plugin skills: 50

The official plugins are installed in Codex's user-level plugin cache. Their paths are recorded
relative to each plugin root so this document remains portable across machines and worktrees.
The existing `skills-lock.json` continues to track the repository's external Tailwind skill; it is
separate from Codex user-level plugin installation state.

## Repository Skills

These skills are versioned with this repository under `.agents/skills/`.

| Skill                      | Path                                               | Primary use                                                                                                                  |
| -------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `macos-tauri-build-test`   | `.agents/skills/macos-tauri-build-test/SKILL.md`   | macOS Tauri frontend checks, Apple Silicon builds, bundle verification, unsigned DMG packaging, and release smoke validation |
| `tailwind-4-docs`          | `.agents/skills/tailwind-4-docs/SKILL.md`          | Tailwind CSS v4 implementation, configuration, migration, and local documentation lookup                                     |
| `windows-tauri-build-test` | `.agents/skills/windows-tauri-build-test/SKILL.md` | Windows Vite/Tauri builds, packaging, and native WebdriverIO E2E validation                                                  |

## Installed Official Plugins

All entries below are installed and enabled from `openai-api-curated` at snapshot `11c74d6b`.
`ON_INSTALL` means the plugin authenticates during installation; `ON_USE` defers authentication
until a matching workflow is used.

### `codex-security` - ON_INSTALL

Security scanning, threat modeling, finding triage, remediation, validation, and vulnerability
writeups for code and diffs. It is relevant to Tauri CSP, capabilities, file handling, and release
configuration.

Skills:

- `attack-path-analysis`
- `deep-security-scan`
- `finding-discovery`
- `fix-finding`
- `propose-security-hardening`
- `security-diff-scan`
- `security-scan`
- `threat-model`
- `track-findings`
- `triage-finding`
- `validation`
- `vulnerability-writeup`

### `superpowers` - ON_INSTALL

Development methodology for planning, worktrees, TDD, systematic debugging, parallel work,
reviews, verification, and branch completion.

Skills:

- `brainstorming`
- `dispatching-parallel-agents`
- `executing-plans`
- `finishing-a-development-branch`
- `receiving-code-review`
- `requesting-code-review`
- `subagent-driven-development`
- `systematic-debugging`
- `test-driven-development`
- `using-git-worktrees`
- `using-superpowers`
- `verification-before-completion`
- `writing-plans`
- `writing-skills`

### `build-web-apps` - ON_USE

Frontend application implementation and testing guidance for React, component composition,
shadcn/ui, Stripe, and Supabase.

Skills:

- `frontend-app-builder`
- `frontend-testing-debugging`
- `react-best-practices`
- `shadcn-best-practices`
- `stripe-best-practices`
- `supabase-best-practices`

For this project, prioritize the React and frontend-testing skills. Stripe and Supabase skills do
not apply unless those services are intentionally introduced.

### `build-web-data-visualization` - ON_USE

Design, implementation, testing, accessibility, and export workflows for charts, dashboards,
diagrams, maps, reports, and WebGL visualizations.

Skills:

- `accessibility-and-inclusive-visualization`
- `canvas2d-data-visualization`
- `d3-data-visualization`
- `dashboards-and-real-time-visualization`
- `data-visualization`
- `gantt-chart-visualization`
- `geospatial-and-cartographic-visualization`
- `grammar-of-graphics-and-declarative-visualization`
- `node-link-and-diagram-layout`
- `react-and-nextjs-data-visualization`
- `reports-pdfs-and-slide-automation`
- `scrollytelling-and-parallax-data-visualization`
- `statistical-and-uncertainty-visualization`
- `testing-data-visualizations`
- `threejs-data-visualization`
- `typescript-data-visualization-engineering`
- `uml-and-software-architecture-visualization`
- `visualization-strategy-and-critique`

For this project, the most relevant skills are `react-and-nextjs-data-visualization`,
`typescript-data-visualization-engineering`, `testing-data-visualizations`,
`accessibility-and-inclusive-visualization`, and `visualization-strategy-and-critique`.

## Verification

Check user-level plugin installation with:

```sh
codex plugin list
```

Check repository-local skill files with:

```sh
rg --files .agents/skills | rg 'SKILL\.md$'
```

When the official marketplace snapshot changes, refresh the plugin version and skill lists here;
do not record user-home absolute paths in project documentation.
