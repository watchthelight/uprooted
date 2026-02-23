export interface PluginSettings {
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface UprootedSettings {
  /** Whether Uprooted is globally enabled. */
  enabled: boolean;
  /** Per-plugin settings keyed by plugin name. */
  plugins: Record<string, PluginSettings>;
  /** Custom CSS applied globally (independent of any plugin). */
  customCss: string;
}

export const DEFAULT_SETTINGS: UprootedSettings = {
  enabled: true,
  plugins: {},
  customCss: "",
};
