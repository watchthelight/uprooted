/**
 * Settings -- File-based persistence for Uprooted configuration.
 *
 * Because Root runs Chromium with --incognito, localStorage is wiped on each launch.
 * Settings are stored as JSON in the profile directory and inlined into the HTML
 * by the patcher as window.__UPROOTED_SETTINGS__.
 */

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, type UprootedSettings } from "../types/settings.js";

const PROFILE_DIR = path.join(
  process.env.LOCALAPPDATA ?? "",
  "Root Communications",
  "Root",
  "profile",
  "default",
);

const SETTINGS_FILE = path.join(PROFILE_DIR, "uprooted-settings.json");

function deepMerge<T>(base: T, overrides: Partial<T>): T {
  const b = base as unknown as Record<string, unknown>;
  const o = overrides as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = { ...b };
  for (const key of Object.keys(o)) {
    const bv = b[key];
    const ov = o[key];
    if (bv !== null && ov !== null &&
        typeof bv === "object" && typeof ov === "object" &&
        !Array.isArray(bv) && !Array.isArray(ov)) {
      result[key] = deepMerge(bv, ov as Partial<typeof bv>);
    } else if (ov !== undefined) {
      result[key] = ov;
    }
  }
  return result as unknown as T;
}

export function loadSettings(): UprootedSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
      return deepMerge(DEFAULT_SETTINGS, JSON.parse(raw) as Partial<UprootedSettings>);
    }
  } catch (err) {
    console.error("[Uprooted] Failed to load settings:", err);
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: UprootedSettings): void {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    console.error("[Uprooted] Failed to save settings:", err);
  }
}

export function getSettingsPath(): string {
  return SETTINGS_FILE;
}
