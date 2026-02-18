/**
 * Preload -- Entry point injected into Root's Chromium context.
 *
 * This script runs before Root's own bundles load. It:
 *   1. Reads settings from window.__UPROOTED_SETTINGS__
 *   2. Installs bridge proxies on __nativeToWebRtc / __webRtcToNative
 *   3. Initializes the plugin loader
 *   4. Starts all enabled plugins
 */

import { PluginLoader } from "./pluginLoader.js";
import { installBridgeProxy, setPluginLoader } from "../api/bridge.js";
import { injectCss, removeCss } from "../api/css.js";
import sentryBlockerPlugin from "../plugins/sentry-blocker/index.js";
import silentTypingPlugin from "../plugins/silent-typing/index.js";
import themesPlugin from "../plugins/themes/index.js";
import settingsPanelPlugin from "../plugins/settings-panel/index.js";
import linkEmbedsPlugin from "../plugins/link-embeds/index.js";

declare const __UPROOTED_VERSION__: string;

const VERSION = typeof __UPROOTED_VERSION__ !== "undefined" ? __UPROOTED_VERSION__ : "dev";

function main(): void {
  try {
    const settings = window.__UPROOTED_SETTINGS__;

    if (!settings?.enabled) {
      console.log("[Uprooted] Disabled in settings, skipping initialization.");
      return;
    }

    console.log(`[Uprooted] v${VERSION} -- initializing`);

    // Set version global
    window.__UPROOTED_VERSION__ = VERSION;

    // Install bridge proxies (wraps globals with ES6 Proxy)
    installBridgeProxy();

    // Initialize plugin loader
    const loader = new PluginLoader(settings);

    // Expose loader globally for settings panel
    window.__UPROOTED_LOADER__ = loader;

    // Wire loader into bridge proxy so plugin events fire
    setPluginLoader(loader);

    // Register built-in plugins (sentry-blocker first so fetch is wrapped earliest)
    loader.register(sentryBlockerPlugin);
    loader.register(themesPlugin);
    loader.register(settingsPanelPlugin);
    loader.register(linkEmbedsPlugin);
    loader.register(silentTypingPlugin);

    // Inject global custom CSS if set
    if (settings.customCss) {
      injectCss("uprooted-custom", settings.customCss);
    }

    // Start enabled plugins
    loader.startAll().then(() => {
      console.log(`[Uprooted] All plugins started.`);
    });
  } catch (err) {
    // Visible error banner since Root has no DevTools
    const banner = document.createElement("div");
    banner.id = "uprooted-error";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:999999;padding:12px 16px;" +
      "background:#dc2626;color:#fff;font:14px/1.4 monospace;white-space:pre-wrap;" +
      "max-height:40vh;overflow:auto;";
    banner.textContent = `[Uprooted] Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
    (document.body ?? document.documentElement).appendChild(banner);
    console.error("[Uprooted] Fatal error during init:", err);
  }
}

// Run after DOM is ready (but before Root's main bundles in most cases)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
