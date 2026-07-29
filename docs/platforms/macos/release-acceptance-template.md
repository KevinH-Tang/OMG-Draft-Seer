# macOS Release Acceptance Record

Duplicate this template for each unsigned GitHub Release candidate. Store the completed record with
the release evidence or pull request; do not add credentials or user data.

## Candidate

| Field        | Value |
| ------------ | ----- |
| Release tag  |       |
| Git commit   |       |
| DMG filename |       |
| DMG SHA-256  |       |
| Release URL  |       |

## Artifact Checks

- [ ] `hdiutil verify` passed for the final DMG.
- [ ] The GitHub Actions-generated SHA-256 file matches the downloaded DMG.
- [ ] `lipo -info` or `lipo -archs` reported `arm64` for `omg-draft-seer`.
- [ ] The production binary contains no `TAURI_WEBDRIVER_PORT` bridge.
- [ ] The GitHub Release says it is arm64-only, directly distributed, not Developer ID signed or
      notarized, and not eligible for the Mac App Store.
- [ ] The GitHub Release documents SHA-256 verification and the Gatekeeper first-open path.

## Apple Silicon

This record accepts the current phase-1 Desktop overlay only. It does not claim that the app can
identify or follow a Dota window, join its full-screen Space, or provide Game-attached overlay
behavior.

| Field                           | Value |
| ------------------------------- | ----- |
| macOS version and build         |       |
| Hardware model and architecture |       |
| Display scaling                 |       |
| Multiple Spaces enabled         |       |
| Clean macOS account used        |       |
| Download kept quarantined       |       |

- [ ] The quarantined download showed the expected unrecognized-developer warning.
- [ ] Finder `Control`-click **Open**, or **Privacy & Security -> Open Anyway**, opened the app.
- [ ] The test record does not claim Gatekeeper approval, Developer ID signing, notarization, or
      stapling.
- [ ] The installed app launched near 720 x 540 logical points and resized cleanly in both directions.
- [ ] Screenshot recognition produced 60 slots; re-slice and candidate confirmation worked.
- [ ] Layout save, load, restart persistence, Tier, Pairs, recommendation, and Draft worked.
- [ ] Locale changes synchronized to both already-open native overlays.
- [ ] Tier and recommendation overlays were transparent, borderless, always on top, visible across
      Spaces, excluded from the Dock, and passed cursor events through.
- [ ] The Desktop overlay check was repeated with a full-screen app and multiple Spaces; the result
      was not recorded as Game-attached overlay support.

Notes and native errors:

```

```
