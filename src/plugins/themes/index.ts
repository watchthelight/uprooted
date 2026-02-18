/**
 * Built-in Theme Plugin -- Applies custom CSS themes to Root's UI.
 *
 * Root's entire color system is CSS variables (--rootsdk-* and --color-*).
 * This plugin overrides those variables to apply custom themes.
 *
 * Theme definitions are loaded from themes.json (shared with installer backend).
 * For the "custom" theme, CSS variables are generated at runtime from
 * user-chosen accent + background colors.
 */

import type { UprootedPlugin } from "../../types/plugin.js";
import { setCssVariables, removeCssVariable } from "../../api/native.js";
import themes from "./themes.json";

interface ThemeDef {
  name: string;
  display_name: string;
  variables: Record<string, string>;
}

// Collect all variable names across all themes for cleanup
const allVarNames = new Set<string>();
for (const theme of themes as ThemeDef[]) {
  for (const name of Object.keys(theme.variables)) {
    allVarNames.add(name);
  }
}
// Also include custom theme variable names so they get cleaned up
const customVarNames = [
  "--rootsdk-brand-primary",
  "--rootsdk-brand-secondary",
  "--rootsdk-brand-tertiary",
  "--rootsdk-background-primary",
  "--rootsdk-background-secondary",
  "--rootsdk-background-tertiary",
  "--rootsdk-input",
  "--rootsdk-border",
  "--rootsdk-link",
  "--rootsdk-muted",
];
for (const name of customVarNames) {
  allVarNames.add(name);
}

// ===== Color math helpers =====

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

export function darken(hex: string, percent: number): string {
  const [r, g, b] = parseHex(hex);
  const factor = 1 - Math.min(100, Math.max(0, percent)) / 100;
  return toHex(r * factor, g * factor, b * factor);
}

export function lighten(hex: string, percent: number): string {
  const [r, g, b] = parseHex(hex);
  const factor = Math.min(100, Math.max(0, percent)) / 100;
  return toHex(r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor);
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Generate CSS variables for a custom theme from accent + background colors.
 */
export function generateCustomVariables(accent: string, bg: string): Record<string, string> {
  const isDark = luminance(bg) < 0.3;
  const mutedColor = isDark ? lighten(bg, 25) : darken(bg, 25);
  const linkColor = lighten(accent, 30);

  return {
    "--rootsdk-brand-primary": accent,
    "--rootsdk-brand-secondary": lighten(accent, 15),
    "--rootsdk-brand-tertiary": darken(accent, 15),
    "--rootsdk-background-primary": bg,
    "--rootsdk-background-secondary": lighten(bg, 8),
    "--rootsdk-background-tertiary": darken(bg, 8),
    "--rootsdk-input": darken(bg, 5),
    "--rootsdk-border": lighten(bg, 18),
    "--rootsdk-link": linkColor,
    "--rootsdk-muted": mutedColor,
  };
}

export default {
  name: "themes",
  description: "Built-in theme engine for Root Communications",
  version: "0.3.44",
  authors: [{ name: "Uprooted" }],

  settings: {
    theme: {
      type: "select",
      default: "default",
      description: "Which theme to apply",
      options: (themes as ThemeDef[]).map((t) => t.name),
    },
  },

  start() {
    // Flush ALL known variables first so nothing sticks from a previous theme
    for (const name of allVarNames) {
      removeCssVariable(name);
    }

    const settings = window.__UPROOTED_SETTINGS__?.plugins?.themes?.config;
    const themeName = (settings?.theme as string) ?? "default";

    if (themeName === "custom") {
      // Read custom colors from settings
      const customAccent = (settings?.customAccent as string) ?? "#3B6AF8";
      const customBg = (settings?.customBackground as string) ?? "#0D1521";
      const vars = generateCustomVariables(customAccent, customBg);
      setCssVariables(vars);
      return;
    }

    const theme = (themes as ThemeDef[]).find((t) => t.name === themeName);
    if (theme && Object.keys(theme.variables).length > 0) {
      setCssVariables(theme.variables);
    }
  },

  stop() {
    for (const name of allVarNames) {
      removeCssVariable(name);
    }
  },
} satisfies UprootedPlugin;
