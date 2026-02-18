# Built-in Plugins

Uprooted ships six built-in plugins across two runtime layers: four TypeScript plugins run in the DotNetBrowser Chromium layer, and two C# hook plugins run as native Avalonia features. All are registered automatically at startup and appear in the in-app settings panel.

> **Related docs:** [Plugin API Reference](../API_REFERENCE.md) | [Root Environment](../ROOT_ENVIRONMENT.md) | [TypeScript Reference](../../framework/TYPESCRIPT_REFERENCE.md)

---

## Plugin Overview

### TypeScript / DotNetBrowser Layer

| Plugin | Purpose | Settings | Source |
|--------|---------|----------|--------|
| [Sentry Blocker](sentry-blocker.md) | Blocks Sentry telemetry to protect user privacy | None | `src/plugins/sentry-blocker/` |
| [Themes](themes.md) | CSS variable theme engine with presets and custom colors | Theme selector, accent/background colors | `src/plugins/themes/` |
| [Settings Panel](settings-panel.md) | Injects Uprooted UI into Root's settings sidebar | None | `src/plugins/settings-panel/` |
| [Link Embeds](link-embeds.md) | Discord-style rich link previews and YouTube embeds | YouTube toggle, website toggle, max embeds | `src/plugins/link-embeds/` |

### C# Hook / Avalonia-Native Layer

These plugins run inside Root's .NET process via the CLR profiler hook and modify the Avalonia visual tree directly. They are not browser plugins.

| Plugin | Purpose | Settings | Source |
|--------|---------|----------|--------|
| [Message Logger](message-logger.md) | Logs deleted and edited messages with visual indicators | Delete/edit toggles, retention limit, ignore own messages | `hook/MessageLogger.cs`, `hook/MessageStore.cs` |
| ClearURLs | Strips tracking parameters (utm_*, fbclid, gclid, etc.) from URLs before sending | None (always on) | `hook/ClearUrlsEngine.cs` |

## Load Order

### TypeScript plugins (DotNetBrowser startup)

Registered and started in this order:

1. **sentry-blocker** -- must run first to block telemetry before Sentry sends anything
2. **themes** -- applies CSS variables before the UI renders
3. **settings-panel** -- depends on the other plugins being registered so it can list them
4. **link-embeds** -- enhances chat content after the page is loaded

### C# hook plugins (phased startup)

Initialized after Avalonia is ready, with delays to ensure chat is populated:

- **ClearUrlsEngine** -- Phase 4.5a (14s delay), hooks AvaloniaEdit TextArea
- **MessageLogger** -- Phase 4.5c (20s delay), subscribes to chat ObservableCollection

## Runtime Context

### TypeScript / DotNetBrowser plugins

These run inside DotNetBrowser's embedded Chromium instance. Key constraints:

- **No localStorage** -- Root runs Chromium with `--incognito`, so all browser storage is wiped on restart
- **No CORS restrictions** -- Root runs Chromium with `--disable-web-security`, so fetch works cross-origin
- **Settings are session-only** -- runtime changes via the settings panel reset on restart; use the installer for persistent configuration
- **Chat is NOT in this context** -- Root's chat UI is native Avalonia. DotNetBrowser handles WebRTC, OAuth, and sub-apps only

### C# hook / Avalonia-native plugins

These run inside Root's .NET process via the CLR profiler. Key characteristics:

- **Settings persist** -- stored in `uprooted-settings.ini` in the profile directory, reloaded on each access with 10s TTL cache
- **Direct visual tree access** -- can create, modify, and inject native Avalonia controls
- **No `System.Text.Json`** -- causes `MissingMethodException` in profiler context; use `UprootedSettings` (INI) for persistence
- **UI thread required** -- all Avalonia mutations must dispatch via `AvaloniaReflection.RunOnUIThread()`

## Shared Globals

| Global | Type | Purpose |
|--------|------|---------|
| `window.__UPROOTED_SETTINGS__` | `UprootedSettings` | Settings loaded from `uprooted-settings.json` by the installer/patcher |
| `window.__UPROOTED_LOADER__` | `PluginLoader` | Plugin lifecycle manager (used by settings-panel) |
| `window.__UPROOTED_VERSION__` | `string` | Version string (e.g. `"0.3.6-rc"`) |
