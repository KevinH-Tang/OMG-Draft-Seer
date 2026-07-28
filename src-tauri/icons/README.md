# Desktop icon source

The application icon follows the Windrun site favicon mark:

- Source: https://windrun.io/favicon.ico
- Site: https://windrun.io
- Retrieved: 2026-07-21
- Vector source: `source/windrun-app-icon.svg`
- Generator: `npx tauri icon src-tauri/icons/source/windrun-app-icon.svg --output src-tauri/icons`

`source/windrun-favicon.ico` is the downloaded reference file. The vector source
keeps the same W mark without scaling the low-resolution favicon into the macOS
high-resolution icon layers. The PNG, ICO and ICNS files in this directory are
generated Windows/macOS desktop bundle assets. Mobile icon outputs are intentionally
not included because the project targets desktop Windows and macOS only. Re-check the
source site's permission and branding terms before public redistribution.
