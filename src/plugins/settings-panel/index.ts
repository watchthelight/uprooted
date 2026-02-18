/**
 * Settings Panel Plugin -- Injects an "UPROOTED" section into Root's
 * settings sidebar with pages for settings, plugins, and themes.
 */

import type { UprootedPlugin } from "../../types/plugin.js";
import { startObserving, stopObserving } from "./panel.js";
import type { PluginLoader } from "../../core/pluginLoader.js";

export default {
  name: "settings-panel",
  description: "In-app settings panel injected into Root's settings sidebar",
  version: "0.3.44",
  authors: [{ name: "Uprooted" }],

  css: undefined, // CSS is loaded from panel.css via the build system

  start() {
    const loader = window.__UPROOTED_LOADER__ as PluginLoader | undefined;
    if (!loader) {
      console.error("[Uprooted] Settings panel: no loader found on window.__UPROOTED_LOADER__");
      return;
    }
    startObserving(loader);
  },

  stop() {
    stopObserving();
  },
} satisfies UprootedPlugin;
