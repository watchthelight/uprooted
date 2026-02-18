# Changelog

All notable changes to Uprooted are documented here. This file mirrors the [GitHub release notes](https://github.com/watchthelight/uprooted/releases).

---

## [v0.3.44](https://github.com/watchthelight/uprooted/releases/tag/v0.3.44) — 2026-02-18

### Improvements
- Linux installer auto-fetches latest release from GitHub — stale scripts no longer download wrong version
- Download errors now show specific HTTP status and actionable fix suggestions
- Validates tarball integrity before extraction (catches corrupt downloads)
- Build-from-source falls back to pre-built artifacts on failure instead of dying
- `find_root()` lists all searched paths on failure with a locate hint
- Post-install messaging uses prominent box: "You MUST log out and log back in"

### Changed
- `.desktop` file creation is now opt-in (`--desktop` flag) — no more unwanted app menu entries

## [v0.3.43](https://github.com/watchthelight/uprooted/releases/tag/v0.3.43) — 2026-02-18

### Fixed
- Linux installer: standalone `.sh` script now auto-uses pre-built artifacts (no more `pnpm` error when run from Downloads)
- Skip Root server invite links (rootapp.gg) — Root renders these natively
- Fallback domain card for URLs with no metadata (login redirects, JS-only pages)

## [v0.3.3](https://github.com/watchthelight/uprooted/releases/tag/v0.3.3) — 2026-02-17

### New
- **Link embeds for non-YouTube sites** — Twitter/X, Reddit, and any site with OpenGraph or oEmbed support now gets rich embed previews with images
- **Direct image embeds** — Image URLs (`.jpg`, `.png`, `.gif`, `.webp`) render instantly with zero network overhead
- **oEmbed discovery** — automatically detects oEmbed endpoints from any page's HTML, no hardcoded provider list needed

### Improvements
- Browser-like User-Agent for better site compatibility (replaces bot UA that was rejected by Twitter/X and others)
- Content-Type gate prevents parsing PDFs, binaries, and other non-HTML as OpenGraph
- Smart UA switching — embed-fixer domains (vxtwitter, fxtwitter, fixupx) and Twitter/X get a crawler UA to receive rich metadata
- Falls back to `twitter:image`/`twitter:title` meta tags when `og:*` tags are missing
- Embed-fixer domain normalization — fixupx/fxtwitter links auto-resolve to vxtwitter for best image support
- Settings cache reduces disk reads (10s TTL instead of every 500ms tick)

### Fixes
- Fixed oEmbed JSON parsing crash caused by trimmed regex delegate in Root's binary
- Fixed oEmbed endpoint fetch failures caused by trimmed charset methods — switched to stream-based body reading

---

## [v0.3.2](https://github.com/watchthelight/uprooted/releases/tag/v0.3.2) — 2026-02-17

### Improvements
- Auto-close Root before install/repair/uninstall — installer detects running Root and kills it automatically, waits for full process exit before deploying files
- Link embed readability — embed text colors now pass WCAG 3:1 contrast check against card background, works with all themes
- Link embed image byte caching survives VirtualizingStackPanel recycling; removed chat container caching for instant room navigation

---

## [v0.3.0](https://github.com/watchthelight/uprooted/releases/tag/v0.3.0) — 2026-02-17

### New
- **Console TUI installer** replacing Tauri GUI (~600KB vs ~100MB)
- **`--debug` CLI mode** with live installation diagnostics
- **Link embeds plugin** — Discord-style OpenGraph previews and inline YouTube players
- Dual-prefix environment variables (`DOTNET_` + `CORECLR_`) for .NET 8/9/10 compatibility
- KDE Plasma environment variable propagation for profiler loading on Linux

### Improvements
- Anti-reverse-engineering hardening: stripped symbols, LTO, no PDBs
- Hook log now read from profile directory instead of deploy directory

### Fixes
- Fixed profiler GUID comparison on Linux (unsigned long, 8 bytes on x64)
- Fixed `Assembly.CreateInstance` — replaced with `GetType` + `Activator.CreateInstance`
- Fixed Wayland white/blank window (disabled WebKitGTK GPU compositing)
- Enforced LF line endings in bash installer

---

## [v0.2.5](https://github.com/watchthelight/uprooted/releases/tag/v0.2.5) — 2026-02-17

Bug fixes and improvements.

---

## [v0.2.3](https://github.com/watchthelight/uprooted/releases/tag/v0.2.3) — 2026-02-16

### Fixes
- Fix `TypeLoadException` from ValueTuples crashing settings pages
- Fix `file:///` URL doubling on Linux (`file:////`) in HTML patch injection
- Fix white/blank window on Wayland (KDE Plasma, Fedora, GNOME) — disable WebKitGTK GPU compositing
- Enforce LF line endings on `.sh` files via `.gitattributes`

---

## [v0.2.1](https://github.com/watchthelight/uprooted/releases/tag/v0.2.1) — 2026-02-16

### Fixes
- Fix click-handler crash on Uprooted settings pages — `ContentPages` static array initializers could throw `TypeInitializationException`, permanently breaking the class for the process lifetime. Changed to lazy initialization via `EnsureStaticInit()`

### Improvements
- Verbose exception logging (`LogException` with full inner exception chain and stack traces)
- DIAGNOSTICS card on Uprooted settings page showing log file path
- Log file path displayed during startup

---

## [v0.2.0](https://github.com/watchthelight/uprooted/releases/tag/v0.2.0) — 2026-02-16

### New
- Plugin system overhaul — Content Filter moved from sidebar page to plugin card with settings/info lightboxes
- Plugin testing status badges (Untested/Alpha/Beta/Closed)
- Plugin settings lightbox system

### Other
- Emdash cleanup across all source files
- Version bump across all components

---

## [v0.1.9](https://github.com/watchthelight/uprooted/releases/tag/v0.1.9) — 2026-02-16

### New
- **Live theme preview** — color picker drag now updates all UI elements in real-time (16ms/60fps throttle)
  - Visual tree walk recolors hardcoded ARGB controls during drag
  - Dual-tone palette: accent-hued borders + bg-hued backgrounds
  - Cross-mapping tracks stale intermediate colors across rapid drag sequences
  - Brush cache for walk performance (~2ms per 500 nodes)
  - Page background uses palette-consistent clamped values
  - Text colors aligned between tree map and palette (no brightness shift on Apply)
- **Color picker popup** — HSV color picker with hue slider and saturation/value gradient plane, real-time swatch preview synced with hex text input

### Fixes
- Tauri v2 window capabilities: `allow-start-dragging`, `allow-close`, `allow-minimize`
- Linux env var persistence via systemd `environment.d`

### Tests
- 71 tests covering ColorUtils, HSL/RGB roundtrips, gradient brushes

---

## [v0.1.81](https://github.com/watchthelight/uprooted/releases/tag/v0.1.81) — 2026-02-15 (Pre-release)

- Theme engine improvements
- Version bump to 0.1.81 across all artifacts

---

## [v0.1.7](https://github.com/watchthelight/uprooted/releases/tag/v0.1.7) — 2026-02-15 (Pre-release)

### New
- **Custom theme engine** — user-configurable accent + background colors, all shades auto-derived from two base colors (C# native + TS Chromium)
- Preset theme cards (Default, Crimson, Loki) displayed side-by-side
- Clean theme switching with targeted color purge-refresh

### Linux Support
- Linux CI workflow producing `.deb` and `.AppImage` packages
- Native Linux CLR profiler (`libuprooted_profiler.so`)
- Standalone bash installer/uninstaller scripts
- `.desktop` file integration and wrapper script
- Arch Linux PKGBUILD

### Tooling
- PowerShell scripts: diagnose, install-hook, uninstall-hook, verify
- UprootedLauncher source (transparent Root.exe wrapper)
- Plugin developer documentation (API reference, examples, getting started)

---

## [v0.1.6](https://github.com/watchthelight/uprooted/releases/tag/v0.1.6) — 2026-02-14 (Pre-release)

### Fixes
- Titlebar (close/minimize/drag) always stays above popup overlay
- Clicking dark backdrop dismisses the popup
