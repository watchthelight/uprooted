/**
 * Bridge Proxy -- Wraps Root's bridge globals with ES6 Proxies so plugins
 * can intercept, modify, or cancel bridge method calls.
 *
 * Root exposes two bridge objects on `window`:
 *   - __nativeToWebRtc (Native → WebRTC): C# host controlling the WebRTC session
 *   - __webRtcToNative (WebRTC → Native): JS notifying the native host of state changes
 *
 * This module replaces both with Proxy wrappers before Root's bundles access them.
 */

import type { INativeToWebRtc, IWebRtcToNative } from "../types/bridge.js";
import type { PluginLoader, BridgeEvent } from "../core/pluginLoader.js";

let pluginLoader: PluginLoader | null = null;

export function setPluginLoader(loader: PluginLoader): void {
  pluginLoader = loader;
}

function createBridgeProxy<T extends object>(
  target: T,
  eventPrefix: "bridge:nativeToWebRtc" | "bridge:webRtcToNative",
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const original = Reflect.get(obj, prop, receiver);
      if (typeof original !== "function") return original;

      return (...args: unknown[]) => {
        const event: BridgeEvent = {
          method: String(prop),
          args,
          cancelled: false,
        };

        pluginLoader?.emit(eventPrefix, event);

        if (event.cancelled) {
          return event.returnValue;
        }

        return (original as Function).apply(obj, event.args);
      };
    },
  });
}

export function installBridgeProxy(): void {
  // Wait for the bridge objects to be set, then proxy them.
  // Root may set them asynchronously after page load.

  const tryProxy = () => {
    if (window.__nativeToWebRtc) {
      const original = window.__nativeToWebRtc;
      window.__nativeToWebRtc = createBridgeProxy<INativeToWebRtc>(
        original,
        "bridge:nativeToWebRtc",
      );
      console.log("[Uprooted] Proxied __nativeToWebRtc");
    }

    if (window.__webRtcToNative) {
      const original = window.__webRtcToNative;
      window.__webRtcToNative = createBridgeProxy<IWebRtcToNative>(
        original,
        "bridge:webRtcToNative",
      );
      console.log("[Uprooted] Proxied __webRtcToNative");
    }
  };

  // Try immediately
  tryProxy();

  // Also set up defineProperty traps for lazy assignment
  const originalNtw = Object.getOwnPropertyDescriptor(window, "__nativeToWebRtc");
  const originalWtn = Object.getOwnPropertyDescriptor(window, "__webRtcToNative");

  if (!originalNtw?.value) {
    let _ntw: INativeToWebRtc | undefined;
    Object.defineProperty(window, "__nativeToWebRtc", {
      get: () => _ntw,
      set: (val: INativeToWebRtc) => {
        _ntw = createBridgeProxy(val, "bridge:nativeToWebRtc");
        console.log("[Uprooted] Proxied __nativeToWebRtc (deferred)");
      },
      configurable: true,
    });
  }

  if (!originalWtn?.value) {
    let _wtn: IWebRtcToNative | undefined;
    Object.defineProperty(window, "__webRtcToNative", {
      get: () => _wtn,
      set: (val: IWebRtcToNative) => {
        _wtn = createBridgeProxy(val, "bridge:webRtcToNative");
        console.log("[Uprooted] Proxied __webRtcToNative (deferred)");
      },
      configurable: true,
    });
  }
}
