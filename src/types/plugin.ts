export interface Author {
  name: string;
  id?: string;
}

export interface Patch {
  /** Bridge to intercept: "nativeToWebRtc" or "webRtcToNative" */
  bridge: "nativeToWebRtc" | "webRtcToNative";
  /** Method name on the bridge to intercept */
  method: string;
  /** Called before the original method. Return false to cancel the call.
   *  Must be synchronous — the bridge proxy cannot await async handlers. */
  before?(args: unknown[]): boolean | void;
  /** Called after the original method with its return value.
   *  Must be synchronous — the bridge proxy cannot await async handlers. */
  after?(result: unknown, args: unknown[]): void;
  /** Replace the original method entirely.
   *  Must be synchronous — the bridge proxy cannot await async handlers. */
  replace?(...args: unknown[]): unknown;
}

export interface SettingsDefinition {
  [key: string]: SettingField;
}

export type SettingField =
  | { type: "boolean"; default: boolean; description: string }
  | { type: "string"; default: string; description: string }
  | { type: "number"; default: number; description: string; min?: number; max?: number }
  | { type: "select"; default: string; description: string; options: string[] };

export interface UprootedPlugin {
  name: string;
  description: string;
  version: string;
  authors: Author[];

  /** Called when the plugin is enabled. */
  start?(): void | Promise<void>;
  /** Called when the plugin is disabled. */
  stop?(): void | Promise<void>;

  /** Bridge method intercepts applied while the plugin is active. */
  patches?: Patch[];
  /** CSS injected into the page while the plugin is active. */
  css?: string;
  /** Plugin-specific settings schema. */
  settings?: SettingsDefinition;
}
