import type { INativeToWebRtc, IWebRtcToNative } from "./bridge.js";
import type { UprootedSettings } from "./settings.js";

interface IMediaManager {
  getDevices(kind?: MediaDeviceKind | MediaDeviceKind[]): Promise<string>;
}

/**
 * Augments the global Window with Root's runtime globals
 * and Uprooted's injected properties.
 */
declare global {
  interface Window {
    // Root's bridge globals (set by DotNetBrowser)
    __nativeToWebRtc: INativeToWebRtc;
    __webRtcToNative: IWebRtcToNative;
    __mediaManager: IMediaManager;
    __rootApiBaseUrl: string;

    // Root's sub-app bridge (separate from WebRTC bridge)
    __rootSdkBridgeWebToNative: Record<string, (...args: unknown[]) => unknown>;

    // Uprooted injections
    __UPROOTED_SETTINGS__: UprootedSettings;
    __UPROOTED_VERSION__: string;
    __UPROOTED_LOADER__: import("../core/pluginLoader.js").PluginLoader;
  }
}

export {};
