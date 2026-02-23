/**
 * Reusable UI components for the settings panel.
 */

import type { PluginLoader } from "../../core/pluginLoader.js";
import { setCssVariables, removeCssVariable } from "../../api/native.js";
import { injectCss, removeCss } from "../../api/css.js";
import themes from "../themes/themes.json";
import { generateCustomVariables } from "../themes/index.js";

interface ThemeDef {
  name: string;
  display_name: string;
  variables: Record<string, string>;
}

// --- Primitive Components ---

/** Create a toggle switch */
export function createToggle(
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "uprooted-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));

  const track = document.createElement("span");
  track.className = "uprooted-toggle-track";

  wrapper.appendChild(input);
  wrapper.appendChild(track);
  return wrapper;
}

/** Create a select dropdown */
export function createSelect(
  options: string[],
  selected: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "uprooted-select";

  for (const opt of options) {
    const option = document.createElement("option");
    option.value = opt;
    option.textContent = opt;
    option.selected = opt === selected;
    select.appendChild(option);
  }

  select.addEventListener("change", () => onChange(select.value));
  return select;
}

/** Create a textarea for custom CSS */
export function createTextarea(
  value: string,
  placeholder: string,
  onChange: (value: string) => void,
): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.className = "uprooted-textarea";
  textarea.value = value;
  textarea.placeholder = placeholder;
  textarea.spellcheck = false;

  let debounceTimer: ReturnType<typeof setTimeout>;
  textarea.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onChange(textarea.value), 300);
  });

  return textarea;
}

/** Create a settings row with label + control */
export function createRow(
  label: string,
  description: string,
  control: HTMLElement,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "uprooted-settings-row";

  const labelDiv = document.createElement("div");
  labelDiv.className = "uprooted-settings-row-info";
  const labelText = document.createElement("div");
  labelText.className = "uprooted-settings-row-label";
  labelText.textContent = label;
  labelDiv.appendChild(labelText);

  if (description) {
    const desc = document.createElement("div");
    desc.className = "uprooted-settings-row-desc";
    desc.textContent = description;
    labelDiv.appendChild(desc);
  }

  row.appendChild(labelDiv);
  row.appendChild(control);
  return row;
}

/** Create a section header */
export function createSection(label: string): HTMLElement {
  const section = document.createElement("div");
  section.className = "uprooted-settings-section";

  const header = document.createElement("div");
  header.className = "uprooted-settings-section-label";
  header.textContent = label;
  section.appendChild(header);

  return section;
}

// --- Content Page Builders ---

/** Build the main Uprooted info/about page. */
export function buildUprootedPage(): HTMLElement {
  const page = document.createElement("div");
  page.className = "uprooted-page-wrapper";

  // Header
  const header = document.createElement("div");
  header.className = "uprooted-page-header";

  const title = document.createElement("h2");
  title.className = "uprooted-page-title";
  title.textContent = "Uprooted";

  const badge = document.createElement("span");
  badge.className = "uprooted-page-badge";
  badge.textContent = `v${window.__UPROOTED_VERSION__ ?? "dev"}`;

  header.appendChild(title);
  header.appendChild(badge);
  page.appendChild(header);

  // About section
  const aboutSection = createSection("About");
  const aboutText = document.createElement("div");
  aboutText.className = "uprooted-page-text";
  aboutText.textContent =
    "Uprooted is a client modification framework for Root Communications. " +
    "It allows plugins and themes to customize your Root experience at runtime.";
  aboutSection.appendChild(aboutText);
  page.appendChild(aboutSection);

  // Links section
  const linksSection = createSection("Links");

  const githubRow = createLinkRow("GitHub", "Source code & issues", "https://github.com/The-Uprooted-Project/uprooted");
  linksSection.appendChild(githubRow);

  const websiteRow = createLinkRow("Website", "uprooted.sh", "https://uprooted.sh");
  linksSection.appendChild(websiteRow);

  page.appendChild(linksSection);

  // Info section
  const infoSection = createSection("Session Info");

  const infoText = document.createElement("div");
  infoText.className = "uprooted-page-notice";
  infoText.textContent =
    "Changes made through Uprooted are session-only. " +
    "They will reset when Root restarts. Use the installer to make permanent changes.";
  infoSection.appendChild(infoText);

  page.appendChild(infoSection);

  return page;
}

/** Build the plugins management page. */
export function buildPluginsPage(loader: PluginLoader): HTMLElement {
  const page = document.createElement("div");
  page.className = "uprooted-page-wrapper";

  // Header
  const header = document.createElement("div");
  header.className = "uprooted-page-header";
  const title = document.createElement("h2");
  title.className = "uprooted-page-title";
  title.textContent = "Plugins";
  header.appendChild(title);
  page.appendChild(header);

  // Plugin list
  const settings = window.__UPROOTED_SETTINGS__;
  const pluginNames = getRegisteredPlugins(loader);

  if (pluginNames.length === 0) {
    const empty = document.createElement("div");
    empty.className = "uprooted-page-text";
    empty.textContent = "No plugins registered.";
    page.appendChild(empty);
    return page;
  }

  const listSection = createSection("Installed Plugins");

  for (const name of pluginNames) {
    if (name === "settings-panel") continue;

    const plugin = getPlugin(loader, name);
    const isEnabled = settings?.plugins?.[name]?.enabled ?? true;
    const isActive = getActivePlugins(loader).has(name);

    const toggle = createToggle(isEnabled, async (enabled) => {
      if (enabled) {
        await loader.start(name);
      } else {
        await loader.stop(name);
      }
      // Update status badge after toggle
      const badge = row.querySelector(".uprooted-plugin-status");
      if (badge) {
        badge.textContent = enabled ? "Active" : "Inactive";
        badge.className = "uprooted-plugin-status " + (enabled ? "uprooted-plugin-status--active" : "");
      }
    });

    const description = plugin?.description ?? "";
    const version = plugin?.version ? ` v${plugin.version}` : "";

    const row = createRow(name + version, description, toggle);
    row.classList.add("uprooted-plugin-row");

    // Status badge
    const badge = document.createElement("span");
    badge.className = "uprooted-plugin-status " + (isActive ? "uprooted-plugin-status--active" : "");
    badge.textContent = isActive ? "Active" : "Inactive";
    const rowInfo = row.querySelector(".uprooted-settings-row-info");
    if (rowInfo) {
      const labelEl = rowInfo.querySelector(".uprooted-settings-row-label");
      if (labelEl) labelEl.appendChild(badge);
    }

    listSection.appendChild(row);

    // Privacy notice for sentry-blocker
    if (name === "sentry-blocker") {
      const notice = document.createElement("div");
      notice.className = "uprooted-page-notice";
      notice.innerHTML =
        "<strong>Without this plugin, Root sends the following to Sentry's servers (not Root's servers):</strong><br>" +
        "\u2022 Your IP address (on every error event)<br>" +
        "\u2022 Session replays: DOM snapshots, mouse movements, input values<br>" +
        "\u2022 Authentication headers including your Bearer token<br>" +
        "\u2022 Application traces and logs";
      listSection.appendChild(notice);
    }
  }

  page.appendChild(listSection);
  return page;
}

/** Flush all known theme CSS variables */
function flushAllThemeVars(): void {
  for (const t of themes as ThemeDef[]) {
    for (const varName of Object.keys(t.variables)) {
      removeCssVariable(varName);
    }
  }
  // Also flush custom variable names
  for (const varName of [
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
  ]) {
    removeCssVariable(varName);
  }
}

/** Validate a #RRGGBB hex string */
function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

/** Build the themes management page. */
export function buildThemesPage(loader: PluginLoader): HTMLElement {
  const page = document.createElement("div");
  page.className = "uprooted-page-wrapper";

  // Header
  const header = document.createElement("div");
  header.className = "uprooted-page-header";
  const title = document.createElement("h2");
  title.className = "uprooted-page-title";
  title.textContent = "Themes";
  header.appendChild(title);
  page.appendChild(header);

  // Theme selector dropdown
  const themeSection = createSection("Active Theme");
  const settings = window.__UPROOTED_SETTINGS__;
  const currentTheme = (settings?.plugins?.themes?.config?.theme as string) ?? "default";
  const themeNames = (themes as ThemeDef[]).map((t) => t.display_name);

  const themeSelect = createSelect(
    themeNames,
    (themes as ThemeDef[]).find((t) => t.name === currentTheme)?.display_name ?? "Default Dark",
    (displayName) => {
      const theme = (themes as ThemeDef[]).find((t) => t.display_name === displayName);
      if (!theme) return;

      flushAllThemeVars();

      if (theme.name === "custom") {
        // Show custom section, apply current custom colors
        customSection.style.display = "";
        const accent = accentInput.value || "#3B6AF8";
        const bg = bgInput.value || "#0D1521";
        if (isValidHex(accent) && isValidHex(bg)) {
          setCssVariables(generateCustomVariables(accent, bg));
        }
      } else {
        customSection.style.display = "none";
        if (Object.keys(theme.variables).length > 0) {
          setCssVariables(theme.variables);
        }
      }
    },
  );

  const themeRow = createRow("Theme", "Live preview, session-only", themeSelect);
  themeSection.appendChild(themeRow);
  page.appendChild(themeSection);

  // Theme preview cards
  const previewSection = createSection("Available Themes");
  const themeCards: { card: HTMLElement; theme: ThemeDef }[] = [];

  /** Highlight only the active card */
  function updateActiveCard(activeThemeName: string): void {
    for (const entry of themeCards) {
      entry.card.classList.toggle(
        "uprooted-theme-card--active",
        entry.theme.name === activeThemeName,
      );
    }
  }

  for (const theme of themes as ThemeDef[]) {
    if (theme.name === "custom") continue; // Custom has its own section

    const card = document.createElement("div");
    card.className = "uprooted-theme-card";

    const cardName = document.createElement("div");
    cardName.className = "uprooted-theme-card-name";
    cardName.textContent = theme.display_name;

    const cardAuthor = document.createElement("div");
    cardAuthor.className = "uprooted-theme-card-author";
    cardAuthor.textContent = (theme as any).author ?? "Unknown";

    const colorBar = document.createElement("div");
    colorBar.className = "uprooted-theme-card-colors";
    const previewColors = (theme as any).preview_colors as Record<string, string> | undefined;
    if (previewColors) {
      for (const color of Object.values(previewColors)) {
        const swatch = document.createElement("span");
        swatch.className = "uprooted-theme-swatch";
        swatch.style.backgroundColor = color;
        colorBar.appendChild(swatch);
      }
    }

    // Click-to-select: apply theme and sync dropdown
    card.addEventListener("click", () => {
      themeSelect.value = theme.display_name;
      themeSelect.dispatchEvent(new Event("change"));
      updateActiveCard(theme.name);
    });

    card.appendChild(cardName);
    card.appendChild(cardAuthor);
    card.appendChild(colorBar);
    previewSection.appendChild(card);
    themeCards.push({ card, theme });
  }

  // Set initial active state
  updateActiveCard(currentTheme);
  page.appendChild(previewSection);

  // Custom theme section
  const customSection = document.createElement("div");
  customSection.className = "uprooted-settings-section";
  customSection.style.display = currentTheme === "custom" ? "" : "none";

  const customHeader = document.createElement("div");
  customHeader.className = "uprooted-settings-section-label";
  customHeader.textContent = "Custom Theme Colors";
  customSection.appendChild(customHeader);

  const customDesc = document.createElement("div");
  customDesc.className = "uprooted-page-text";
  customDesc.textContent = "Pick accent and background colors. All shades are auto-derived.";
  customSection.appendChild(customDesc);

  // Accent color picker
  const accentInput = document.createElement("input");
  accentInput.type = "color";
  accentInput.value = (settings?.plugins?.themes?.config?.customAccent as string) ?? "#3B6AF8";
  accentInput.className = "uprooted-color-input";
  const accentRow = createRow("Accent", "Primary brand color", accentInput);
  customSection.appendChild(accentRow);

  // Background color picker
  const bgInput = document.createElement("input");
  bgInput.type = "color";
  bgInput.value = (settings?.plugins?.themes?.config?.customBackground as string) ?? "#0D1521";
  bgInput.className = "uprooted-color-input";
  const bgRow = createRow("Background", "Main background color", bgInput);
  customSection.appendChild(bgRow);

  // Live preview on input change
  const applyCustomPreview = () => {
    if (!isValidHex(accentInput.value) || !isValidHex(bgInput.value)) return;
    flushAllThemeVars();
    setCssVariables(generateCustomVariables(accentInput.value, bgInput.value));
  };

  accentInput.addEventListener("input", applyCustomPreview);
  bgInput.addEventListener("input", applyCustomPreview);

  page.appendChild(customSection);

  // Custom CSS
  const cssSection = createSection("Custom CSS");
  const cssDesc = document.createElement("div");
  cssDesc.className = "uprooted-page-text";
  cssDesc.textContent = "Inject custom CSS into Root. Use CSS variables like --rootsdk-brand-primary.";
  cssSection.appendChild(cssDesc);

  const textarea = createTextarea(
    settings?.customCss ?? "",
    ":root { --rootsdk-brand-primary: #ff0000; }",
    (value) => {
      if (value.trim()) {
        injectCss("uprooted-custom", value);
      } else {
        removeCss("uprooted-custom");
      }
    },
  );
  cssSection.appendChild(textarea);
  page.appendChild(cssSection);

  return page;
}

// --- Helpers ---

function createLinkRow(label: string, description: string, url: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "uprooted-settings-row uprooted-link-row";

  const info = document.createElement("div");
  info.className = "uprooted-settings-row-info";

  const labelText = document.createElement("div");
  labelText.className = "uprooted-settings-row-label";
  labelText.textContent = label;

  const desc = document.createElement("div");
  desc.className = "uprooted-settings-row-desc";
  desc.textContent = description;

  info.appendChild(labelText);
  info.appendChild(desc);

  const link = document.createElement("a");
  link.className = "uprooted-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Open";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    window.open(url, "_blank");
  });

  row.appendChild(info);
  row.appendChild(link);
  return row;
}

function getRegisteredPlugins(loader: PluginLoader): string[] {
  const plugins = (loader as any).plugins as Map<string, unknown>;
  return Array.from(plugins.keys());
}

function getPlugin(loader: PluginLoader, name: string): { description?: string; version?: string } | null {
  const plugins = (loader as any).plugins as Map<string, any>;
  return plugins.get(name) ?? null;
}

function getActivePlugins(loader: PluginLoader): Set<string> {
  return (loader as any).activePlugins as Set<string>;
}
