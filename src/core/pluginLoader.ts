/**
 * Plugin Loader -- Discovers, validates, and manages the lifecycle of plugins.
 */

import type { UprootedPlugin, Patch } from "../types/plugin.js";
import type { UprootedSettings } from "../types/settings.js";
import { injectCss, removeCss } from "../api/css.js";

type BridgeEventName = "bridge:nativeToWebRtc" | "bridge:webRtcToNative";

export interface BridgeEvent {
  method: string;
  args: unknown[];
  cancelled: boolean;
  returnValue?: unknown;
}

type EventHandler = (event: BridgeEvent) => void;

export class PluginLoader {
  private plugins = new Map<string, UprootedPlugin>();
  private activePlugins = new Set<string>();
  private eventHandlers = new Map<string, EventHandler[]>();
  private settings: UprootedSettings;

  constructor(settings: UprootedSettings) {
    this.settings = settings;
  }

  /** Register a plugin. Does not start it. */
  register(plugin: UprootedPlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`[Uprooted] Plugin "${plugin.name}" already registered, skipping.`);
      return;
    }
    this.plugins.set(plugin.name, plugin);
  }

  /** Start a single plugin by name. */
  async start(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      console.error(`[Uprooted] Plugin "${name}" not found.`);
      return;
    }

    if (this.activePlugins.has(name)) return;

    try {
      // Install patches
      if (plugin.patches) {
        for (const patch of plugin.patches) {
          this.installPatch(name, patch);
        }
      }

      // Inject CSS
      if (plugin.css) {
        injectCss(`plugin-${name}`, plugin.css);
      }

      // Call start lifecycle hook
      await plugin.start?.();

      this.activePlugins.add(name);
      console.log(`[Uprooted] Started plugin: ${name}`);
    } catch (err) {
      console.error(`[Uprooted] Failed to start plugin "${name}":`, err);
    }
  }

  /** Stop a single plugin by name. */
  async stop(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin || !this.activePlugins.has(name)) return;

    try {
      await plugin.stop?.();

      // Remove CSS
      if (plugin.css) {
        removeCss(`plugin-${name}`);
      }

      // Remove event handlers for this plugin
      this.removeHandlers(name);

      this.activePlugins.delete(name);
      console.log(`[Uprooted] Stopped plugin: ${name}`);
    } catch (err) {
      console.error(`[Uprooted] Failed to stop plugin "${name}":`, err);
    }
  }

  /** Start all plugins that are enabled in settings. */
  async startAll(): Promise<void> {
    for (const [name] of this.plugins) {
      const pluginSettings = this.settings.plugins[name];
      const enabled = pluginSettings?.enabled ?? false;
      if (enabled) {
        await this.start(name);
      }
    }
  }

  /** Emit a bridge event. Called by the bridge proxy. */
  emit(eventName: BridgeEventName, event: BridgeEvent): void {
    const key = `${eventName}:${event.method}`;
    const handlers = this.eventHandlers.get(key);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
        if (event.cancelled) break;
      }
    }
  }

  private installPatch(pluginName: string, patch: Patch): void {
    const eventName: BridgeEventName =
      patch.bridge === "nativeToWebRtc"
        ? "bridge:nativeToWebRtc"
        : "bridge:webRtcToNative";

    const key = `${eventName}:${patch.method}`;
    const handler: EventHandler & { __plugin?: string } = (event) => {
      let explicitlyCancelled = false;
      if (patch.replace) {
        event.returnValue = patch.replace(...event.args);
        event.cancelled = true;
      } else if (patch.before) {
        const result = patch.before(event.args);
        if (result === false) {
          event.cancelled = true;
          explicitlyCancelled = true;
        }
      }
      if (patch.after && !explicitlyCancelled) {
        patch.after(event.returnValue, event.args);
      }
    };
    handler.__plugin = pluginName;

    const handlers = this.eventHandlers.get(key) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(key, handlers);
  }

  private removeHandlers(pluginName: string): void {
    for (const [key, handlers] of this.eventHandlers) {
      const filtered = handlers.filter(
        (h) => (h as EventHandler & { __plugin?: string }).__plugin !== pluginName,
      );
      if (filtered.length === 0) {
        this.eventHandlers.delete(key);
      } else {
        this.eventHandlers.set(key, filtered);
      }
    }
  }
}
