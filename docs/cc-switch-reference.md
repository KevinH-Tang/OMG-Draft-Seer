# cc-switch Reference Research

This note records a targeted review of
[farion1231/cc-switch](https://github.com/farion1231/cc-switch) at commit
`a377d79303bc1e592d2783d559ca5bd6b8ba1417`.

## Typography

cc-switch uses system font stacks in its Tailwind configuration:

```css
font-family:
  -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
  Arial, sans-serif;

font-family:
  ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo,
  monospace;
```

The sans-serif stack is used for UI copy and the monospaced stack for IDs, scores, and technical
values.

## Reusable Frontend Building Blocks

cc-switch uses the following public libraries and patterns.

| Library or pattern | cc-switch use |
| --- | --- | --- |
| Tailwind CSS 3 with CSS custom-property tokens | Theme colors, radius, dark mode, and utility styles |
| Radix UI | Accessible dialogs, popovers, tabs, tooltips, and form primitives |
| Lucide React | General-purpose interface icons |
| Sonner | Toast notifications |
| Recharts | Usage and trend charts |
| `@dnd-kit` | Drag sorting |
| CodeMirror 6 | JSON and Markdown editing |
| `@lobehub/icons-static-svg` | On-demand AI-provider icons |
| `@tanstack/react-query` | Server-state queries and mutations |
| `react-hook-form` with Zod | Form state and validation |
| i18next with react-i18next | Application localization |

Its shadcn/ui-style components use Tailwind, Radix UI, `class-variance-authority`, and `clsx`.

## License and Brand Boundaries

The cc-switch repository is MIT licensed. Its reviewed UI libraries have permissive licenses: Radix
UI, Recharts, and Lobe Icons are MIT; Lucide is ISC.

The permissive package license for `@lobehub/icons-static-svg` does not grant unrestricted trademark
rights to the logos it distributes. Do not transplant cc-switch's partner banners or provider-logo
assets without checking the respective brand's usage rules. Prefer a package-managed icon or an
officially supplied brand asset where a product logo is necessary.

## Engineering Toolchain

| Tool | cc-switch use |
| --- | --- | --- |
| Prettier 3 | Frontend formatting; CI runs `pnpm format:check` |
| Vitest | Unit tests through `pnpm test:unit`; CI runs the test suite |
| Rustfmt | Installed by `rust-toolchain.toml`; CI runs `cargo fmt --check` |
| Clippy | Installed by `rust-toolchain.toml`; CI runs `cargo clippy -- -D warnings` |
| cargo test | CI runs Rust tests after formatting and Clippy checks |

The frontend CI sequence is TypeScript type checking, Prettier formatting validation, then Vitest.
The Rust CI sequence is Rustfmt validation, Clippy with warnings denied, then `cargo test`.

## Sources

- [cc-switch package scripts and dependencies](https://github.com/farion1231/cc-switch/blob/a377d79303bc1e592d2783d559ca5bd6b8ba1417/package.json)
- [System font stacks and design tokens](https://github.com/farion1231/cc-switch/blob/a377d79303bc1e592d2783d559ca5bd6b8ba1417/tailwind.config.cjs)
- [Rust toolchain](https://github.com/farion1231/cc-switch/blob/a377d79303bc1e592d2783d559ca5bd6b8ba1417/rust-toolchain.toml)
- [Continuous-integration checks](https://github.com/farion1231/cc-switch/blob/a377d79303bc1e592d2783d559ca5bd6b8ba1417/.github/workflows/ci.yml)
- [cc-switch MIT license](https://github.com/farion1231/cc-switch/blob/a377d79303bc1e592d2783d559ca5bd6b8ba1417/LICENSE)
