"use strict";
var Uprooted = (() => {
  // src/api/css.ts
  var ID_PREFIX = "uprooted-css-";
  function injectCss(id, css) {
    const elementId = ID_PREFIX + id;
    let style = document.getElementById(elementId);
    if (!style) {
      style = document.createElement("style");
      style.id = elementId;
      document.head.appendChild(style);
    }
    style.textContent = css;
  }
  function removeCss(id) {
    const elementId = ID_PREFIX + id;
    const style = document.getElementById(elementId);
    style?.remove();
  }

  // src/core/pluginLoader.ts
  var PluginLoader = class {
    plugins = /* @__PURE__ */ new Map();
    activePlugins = /* @__PURE__ */ new Set();
    eventHandlers = /* @__PURE__ */ new Map();
    settings;
    constructor(settings) {
      this.settings = settings;
    }
    /** Register a plugin. Does not start it. */
    register(plugin) {
      if (this.plugins.has(plugin.name)) {
        console.warn(`[Uprooted] Plugin "${plugin.name}" already registered, skipping.`);
        return;
      }
      this.plugins.set(plugin.name, plugin);
    }
    /** Start a single plugin by name. */
    async start(name) {
      const plugin = this.plugins.get(name);
      if (!plugin) {
        console.error(`[Uprooted] Plugin "${name}" not found.`);
        return;
      }
      if (this.activePlugins.has(name)) return;
      try {
        if (plugin.patches) {
          for (const patch of plugin.patches) {
            this.installPatch(name, patch);
          }
        }
        if (plugin.css) {
          injectCss(`plugin-${name}`, plugin.css);
        }
        await plugin.start?.();
        this.activePlugins.add(name);
        console.log(`[Uprooted] Started plugin: ${name}`);
      } catch (err) {
        console.error(`[Uprooted] Failed to start plugin "${name}":`, err);
      }
    }
    /** Stop a single plugin by name. */
    async stop(name) {
      const plugin = this.plugins.get(name);
      if (!plugin || !this.activePlugins.has(name)) return;
      try {
        await plugin.stop?.();
        if (plugin.css) {
          removeCss(`plugin-${name}`);
        }
        this.removeHandlers(name);
        this.activePlugins.delete(name);
        console.log(`[Uprooted] Stopped plugin: ${name}`);
      } catch (err) {
        console.error(`[Uprooted] Failed to stop plugin "${name}":`, err);
      }
    }
    /** Start all plugins that are enabled in settings. */
    async startAll() {
      for (const [name] of this.plugins) {
        const pluginSettings = this.settings.plugins[name];
        const enabled = pluginSettings?.enabled ?? true;
        if (enabled) {
          await this.start(name);
        }
      }
    }
    /** Emit a bridge event. Called by the bridge proxy. */
    emit(eventName, event) {
      const key = `${eventName}:${event.method}`;
      const handlers = this.eventHandlers.get(key);
      if (handlers) {
        for (const handler of handlers) {
          handler(event);
          if (event.cancelled) break;
        }
      }
    }
    installPatch(pluginName, patch) {
      const eventName = patch.bridge === "nativeToWebRtc" ? "bridge:nativeToWebRtc" : "bridge:webRtcToNative";
      const key = `${eventName}:${patch.method}`;
      const handler = (event) => {
        if (patch.replace) {
          event.returnValue = patch.replace(...event.args);
          event.cancelled = true;
        } else if (patch.before) {
          const result = patch.before(event.args);
          if (result === false) event.cancelled = true;
        }
      };
      handler.__plugin = pluginName;
      const handlers = this.eventHandlers.get(key) ?? [];
      handlers.push(handler);
      this.eventHandlers.set(key, handlers);
    }
    removeHandlers(pluginName) {
      for (const [key, handlers] of this.eventHandlers) {
        const filtered = handlers.filter(
          (h) => h.__plugin !== pluginName
        );
        if (filtered.length === 0) {
          this.eventHandlers.delete(key);
        } else {
          this.eventHandlers.set(key, filtered);
        }
      }
    }
  };

  // src/api/bridge.ts
  var pluginLoader = null;
  function setPluginLoader(loader2) {
    pluginLoader = loader2;
  }
  function createBridgeProxy(target, eventPrefix) {
    return new Proxy(target, {
      get(obj, prop, receiver) {
        const original = Reflect.get(obj, prop, receiver);
        if (typeof original !== "function") return original;
        return (...args) => {
          const event = {
            method: String(prop),
            args,
            cancelled: false
          };
          pluginLoader?.emit(eventPrefix, event);
          if (event.cancelled) {
            return event.returnValue;
          }
          return original.apply(obj, event.args);
        };
      }
    });
  }
  function installBridgeProxy() {
    const tryProxy = () => {
      if (window.__nativeToWebRtc) {
        const original = window.__nativeToWebRtc;
        window.__nativeToWebRtc = createBridgeProxy(
          original,
          "bridge:nativeToWebRtc"
        );
        console.log("[Uprooted] Proxied __nativeToWebRtc");
      }
      if (window.__webRtcToNative) {
        const original = window.__webRtcToNative;
        window.__webRtcToNative = createBridgeProxy(
          original,
          "bridge:webRtcToNative"
        );
        console.log("[Uprooted] Proxied __webRtcToNative");
      }
    };
    tryProxy();
    const originalNtw = Object.getOwnPropertyDescriptor(window, "__nativeToWebRtc");
    const originalWtn = Object.getOwnPropertyDescriptor(window, "__webRtcToNative");
    if (!originalNtw?.value) {
      let _ntw;
      Object.defineProperty(window, "__nativeToWebRtc", {
        get: () => _ntw,
        set: (val) => {
          _ntw = createBridgeProxy(val, "bridge:nativeToWebRtc");
          console.log("[Uprooted] Proxied __nativeToWebRtc (deferred)");
        },
        configurable: true
      });
    }
    if (!originalWtn?.value) {
      let _wtn;
      Object.defineProperty(window, "__webRtcToNative", {
        get: () => _wtn,
        set: (val) => {
          _wtn = createBridgeProxy(val, "bridge:webRtcToNative");
          console.log("[Uprooted] Proxied __webRtcToNative (deferred)");
        },
        configurable: true
      });
    }
  }

  // src/plugins/sentry-blocker/index.ts
  var originalFetch = null;
  var originalXHROpen = null;
  var originalSendBeacon = null;
  var blockedCount = 0;
  function isSentryUrl(url) {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    return urlStr.includes("sentry.io");
  }
  var sentryBlockerPlugin = {
    name: "sentry-blocker",
    description: "Blocks Sentry error tracking to protect your privacy",
    version: "0.3.44",
    authors: [{ name: "Uprooted" }],
    start() {
      blockedCount = 0;
      originalFetch = window.fetch;
      window.fetch = function(input, init) {
        if (isSentryUrl(input)) {
          blockedCount++;
          console.log(`[Uprooted:sentry-blocker] Blocked fetch to sentry.io (${blockedCount} total)`);
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        return originalFetch.call(window, input, init);
      };
      originalXHROpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (isSentryUrl(url)) {
          blockedCount++;
          console.log(`[Uprooted:sentry-blocker] Blocked XHR to sentry.io (${blockedCount} total)`);
          return originalXHROpen.call(this, method, "about:blank", ...rest);
        }
        return originalXHROpen.call(this, method, url, ...rest);
      };
      originalSendBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function(url, data) {
        if (isSentryUrl(url)) {
          blockedCount++;
          console.log(`[Uprooted:sentry-blocker] Blocked sendBeacon to sentry.io (${blockedCount} total)`);
          return true;
        }
        return originalSendBeacon(url, data);
      };
      console.log("[Uprooted:sentry-blocker] Network intercepts installed");
    },
    stop() {
      if (originalFetch) {
        window.fetch = originalFetch;
        originalFetch = null;
      }
      if (originalXHROpen) {
        XMLHttpRequest.prototype.open = originalXHROpen;
        originalXHROpen = null;
      }
      if (originalSendBeacon) {
        navigator.sendBeacon = originalSendBeacon;
        originalSendBeacon = null;
      }
      console.log(`[Uprooted:sentry-blocker] Intercepts removed (blocked ${blockedCount} requests)`);
      blockedCount = 0;
    }
  };
  var sentry_blocker_default = sentryBlockerPlugin;

  // src/api/native.ts
  function removeCssVariable(name) {
    document.documentElement.style.removeProperty(name);
  }
  function setCssVariables(vars) {
    for (const [name, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(name, value);
    }
  }

  // src/plugins/themes/themes.json
  var themes_default = [
    {
      name: "default",
      display_name: "Default Dark",
      description: "Root's built-in dark theme",
      author: "Root Communications",
      variables: {},
      preview_colors: {
        background: "#0D1521",
        text: "#F2F2F2",
        accent: "#3B6AF8",
        border: "#242C36"
      }
    },
    {
      name: "crimson",
      display_name: "Crimson",
      description: "Deep red accent theme",
      author: "watchthelight",
      variables: {
        "--rootsdk-brand-primary": "#C42B1C",
        "--rootsdk-brand-secondary": "#D94A3D",
        "--rootsdk-brand-tertiary": "#A32417",
        "--rootsdk-background-primary": "#241414",
        "--rootsdk-background-secondary": "#2C1818",
        "--rootsdk-background-tertiary": "#1A0E0E",
        "--rootsdk-input": "#1E1010",
        "--rootsdk-border": "#402828",
        "--rootsdk-link": "#E06B60",
        "--rootsdk-muted": "#6F5050"
      },
      preview_colors: {
        background: "#241414",
        text: "#F0EAEA",
        accent: "#C42B1C",
        border: "#402828"
      }
    },
    {
      name: "loki",
      display_name: "Loki",
      description: "Gold and green",
      author: "watchthelight",
      variables: {
        "--rootsdk-brand-primary": "#2A5A40",
        "--rootsdk-brand-secondary": "#3D7050",
        "--rootsdk-brand-tertiary": "#1E402F",
        "--rootsdk-background-primary": "#0F1210",
        "--rootsdk-background-secondary": "#151A15",
        "--rootsdk-background-tertiary": "#0A0D0A",
        "--rootsdk-input": "#0C0F0C",
        "--rootsdk-border": "#3D4A35",
        "--rootsdk-link": "#508A62",
        "--rootsdk-muted": "#4A5A42"
      },
      preview_colors: {
        background: "#0F1210",
        text: "#F0ECE0",
        accent: "#2A5A40",
        border: "#3D4A35"
      }
    },
    {
      name: "cosmic-smoothie",
      display_name: "Cosmic Smoothie",
      description: "Deep purple space",
      author: "watchthelight",
      variables: {
        "--rootsdk-brand-primary": "#7328BA",
        "--rootsdk-brand-secondary": "#8A3FD2",
        "--rootsdk-brand-tertiary": "#5C1E98",
        "--rootsdk-background-primary": "#0A041E",
        "--rootsdk-background-secondary": "#100822",
        "--rootsdk-background-tertiary": "#060216",
        "--rootsdk-input": "#080318",
        "--rootsdk-border": "#302040",
        "--rootsdk-link": "#A15DE6",
        "--rootsdk-muted": "#584870"
      },
      preview_colors: {
        background: "#0A041E",
        text: "#F4ECF8",
        accent: "#7328BA",
        border: "#302040"
      }
    },
    {
      name: "custom",
      display_name: "Custom",
      description: "User-defined accent and background colors",
      author: "You",
      variables: {},
      preview_colors: {
        background: "#0D1521",
        text: "#F2F2F2",
        accent: "#3B6AF8",
        border: "#242C36"
      }
    }
  ];

  // src/plugins/themes/index.ts
  var allVarNames = /* @__PURE__ */ new Set();
  for (const theme of themes_default) {
    for (const name of Object.keys(theme.variables)) {
      allVarNames.add(name);
    }
  }
  var customVarNames = [
    "--rootsdk-brand-primary",
    "--rootsdk-brand-secondary",
    "--rootsdk-brand-tertiary",
    "--rootsdk-background-primary",
    "--rootsdk-background-secondary",
    "--rootsdk-background-tertiary",
    "--rootsdk-input",
    "--rootsdk-border",
    "--rootsdk-link",
    "--rootsdk-muted"
  ];
  for (const name of customVarNames) {
    allVarNames.add(name);
  }
  function parseHex(hex) {
    const h = hex.replace(/^#/, "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function toHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
  }
  function darken(hex, percent) {
    const [r, g, b] = parseHex(hex);
    const factor = 1 - Math.min(100, Math.max(0, percent)) / 100;
    return toHex(r * factor, g * factor, b * factor);
  }
  function lighten(hex, percent) {
    const [r, g, b] = parseHex(hex);
    const factor = Math.min(100, Math.max(0, percent)) / 100;
    return toHex(r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor);
  }
  function luminance(hex) {
    const [r, g, b] = parseHex(hex);
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function generateCustomVariables(accent, bg) {
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
      "--rootsdk-muted": mutedColor
    };
  }
  var themes_default2 = {
    name: "themes",
    description: "Built-in theme engine for Root Communications",
    version: "0.3.44",
    authors: [{ name: "Uprooted" }],
    settings: {
      theme: {
        type: "select",
        default: "default",
        description: "Which theme to apply",
        options: themes_default.map((t) => t.name)
      }
    },
    start() {
      for (const name of allVarNames) {
        removeCssVariable(name);
      }
      const settings = window.__UPROOTED_SETTINGS__?.plugins?.themes?.config;
      const themeName = settings?.theme ?? "default";
      if (themeName === "custom") {
        const customAccent = settings?.customAccent ?? "#3B6AF8";
        const customBg = settings?.customBackground ?? "#0D1521";
        const vars = generateCustomVariables(customAccent, customBg);
        setCssVariables(vars);
        return;
      }
      const theme = themes_default.find((t) => t.name === themeName);
      if (theme && Object.keys(theme.variables).length > 0) {
        setCssVariables(theme.variables);
      }
    },
    stop() {
      for (const name of allVarNames) {
        removeCssVariable(name);
      }
    }
  };

  // src/plugins/settings-panel/components.ts
  function createToggle(checked, onChange) {
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
  function createSelect(options, selected, onChange) {
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
  function createTextarea(value, placeholder, onChange) {
    const textarea = document.createElement("textarea");
    textarea.className = "uprooted-textarea";
    textarea.value = value;
    textarea.placeholder = placeholder;
    textarea.spellcheck = false;
    let debounceTimer2;
    textarea.addEventListener("input", () => {
      clearTimeout(debounceTimer2);
      debounceTimer2 = setTimeout(() => onChange(textarea.value), 300);
    });
    return textarea;
  }
  function createRow(label, description, control) {
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
  function createSection(label) {
    const section = document.createElement("div");
    section.className = "uprooted-settings-section";
    const header = document.createElement("div");
    header.className = "uprooted-settings-section-label";
    header.textContent = label;
    section.appendChild(header);
    return section;
  }
  function buildUprootedPage() {
    const page = document.createElement("div");
    page.className = "uprooted-page-wrapper";
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
    const aboutSection = createSection("About");
    const aboutText = document.createElement("div");
    aboutText.className = "uprooted-page-text";
    aboutText.textContent = "Uprooted is a client modification framework for Root Communications. It allows plugins and themes to customize your Root experience at runtime.";
    aboutSection.appendChild(aboutText);
    page.appendChild(aboutSection);
    const linksSection = createSection("Links");
    const githubRow = createLinkRow("GitHub", "Source code & issues", "https://github.com/watchthelight/uprooted");
    linksSection.appendChild(githubRow);
    const websiteRow = createLinkRow("Website", "uprooted.sh", "https://uprooted.sh");
    linksSection.appendChild(websiteRow);
    page.appendChild(linksSection);
    const infoSection = createSection("Session Info");
    const infoText = document.createElement("div");
    infoText.className = "uprooted-page-notice";
    infoText.textContent = "Changes made through Uprooted are session-only. They will reset when Root restarts. Use the installer to make permanent changes.";
    infoSection.appendChild(infoText);
    page.appendChild(infoSection);
    return page;
  }
  function buildPluginsPage(loader2) {
    const page = document.createElement("div");
    page.className = "uprooted-page-wrapper";
    const header = document.createElement("div");
    header.className = "uprooted-page-header";
    const title = document.createElement("h2");
    title.className = "uprooted-page-title";
    title.textContent = "Plugins";
    header.appendChild(title);
    page.appendChild(header);
    const settings = window.__UPROOTED_SETTINGS__;
    const pluginNames = getRegisteredPlugins(loader2);
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
      const plugin = getPlugin(loader2, name);
      const isEnabled = settings?.plugins?.[name]?.enabled ?? true;
      const isActive = getActivePlugins(loader2).has(name);
      const toggle = createToggle(isEnabled, async (enabled) => {
        if (enabled) {
          await loader2.start(name);
        } else {
          await loader2.stop(name);
        }
        const badge2 = row.querySelector(".uprooted-plugin-status");
        if (badge2) {
          badge2.textContent = enabled ? "Active" : "Inactive";
          badge2.className = "uprooted-plugin-status " + (enabled ? "uprooted-plugin-status--active" : "");
        }
      });
      const description = plugin?.description ?? "";
      const version = plugin?.version ? ` v${plugin.version}` : "";
      const row = createRow(name + version, description, toggle);
      row.classList.add("uprooted-plugin-row");
      const badge = document.createElement("span");
      badge.className = "uprooted-plugin-status " + (isActive ? "uprooted-plugin-status--active" : "");
      badge.textContent = isActive ? "Active" : "Inactive";
      const rowInfo = row.querySelector(".uprooted-settings-row-info");
      if (rowInfo) {
        const labelEl = rowInfo.querySelector(".uprooted-settings-row-label");
        if (labelEl) labelEl.appendChild(badge);
      }
      listSection.appendChild(row);
      if (name === "sentry-blocker") {
        const notice = document.createElement("div");
        notice.className = "uprooted-page-notice";
        notice.innerHTML = "<strong>Without this plugin, Root sends the following to Sentry's servers (not Root's servers):</strong><br>\u2022 Your IP address (on every error event)<br>\u2022 Session replays: DOM snapshots, mouse movements, input values<br>\u2022 Authentication headers including your Bearer token<br>\u2022 Application traces and logs";
        listSection.appendChild(notice);
      }
    }
    page.appendChild(listSection);
    return page;
  }
  function flushAllThemeVars() {
    for (const t of themes_default) {
      for (const varName of Object.keys(t.variables)) {
        removeCssVariable(varName);
      }
    }
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
      "--rootsdk-muted"
    ]) {
      removeCssVariable(varName);
    }
  }
  function isValidHex(hex) {
    return /^#[0-9A-Fa-f]{6}$/.test(hex);
  }
  function buildThemesPage(loader2) {
    const page = document.createElement("div");
    page.className = "uprooted-page-wrapper";
    const header = document.createElement("div");
    header.className = "uprooted-page-header";
    const title = document.createElement("h2");
    title.className = "uprooted-page-title";
    title.textContent = "Themes";
    header.appendChild(title);
    page.appendChild(header);
    const themeSection = createSection("Active Theme");
    const settings = window.__UPROOTED_SETTINGS__;
    const currentTheme = settings?.plugins?.themes?.config?.theme ?? "default";
    const themeNames = themes_default.map((t) => t.display_name);
    const themeSelect = createSelect(
      themeNames,
      themes_default.find((t) => t.name === currentTheme)?.display_name ?? "Default Dark",
      (displayName) => {
        const theme = themes_default.find((t) => t.display_name === displayName);
        if (!theme) return;
        flushAllThemeVars();
        if (theme.name === "custom") {
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
      }
    );
    const themeRow = createRow("Theme", "Live preview, session-only", themeSelect);
    themeSection.appendChild(themeRow);
    page.appendChild(themeSection);
    const previewSection = createSection("Available Themes");
    const themeCards = [];
    function updateActiveCard(activeThemeName) {
      for (const entry of themeCards) {
        entry.card.classList.toggle(
          "uprooted-theme-card--active",
          entry.theme.name === activeThemeName
        );
      }
    }
    for (const theme of themes_default) {
      if (theme.name === "custom") continue;
      const card = document.createElement("div");
      card.className = "uprooted-theme-card";
      const cardName = document.createElement("div");
      cardName.className = "uprooted-theme-card-name";
      cardName.textContent = theme.display_name;
      const cardAuthor = document.createElement("div");
      cardAuthor.className = "uprooted-theme-card-author";
      cardAuthor.textContent = theme.author ?? "Unknown";
      const colorBar = document.createElement("div");
      colorBar.className = "uprooted-theme-card-colors";
      const previewColors = theme.preview_colors;
      if (previewColors) {
        for (const color of Object.values(previewColors)) {
          const swatch = document.createElement("span");
          swatch.className = "uprooted-theme-swatch";
          swatch.style.backgroundColor = color;
          colorBar.appendChild(swatch);
        }
      }
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
    updateActiveCard(currentTheme);
    page.appendChild(previewSection);
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
    const accentInput = document.createElement("input");
    accentInput.type = "color";
    accentInput.value = settings?.plugins?.themes?.config?.customAccent ?? "#3B6AF8";
    accentInput.className = "uprooted-color-input";
    const accentRow = createRow("Accent", "Primary brand color", accentInput);
    customSection.appendChild(accentRow);
    const bgInput = document.createElement("input");
    bgInput.type = "color";
    bgInput.value = settings?.plugins?.themes?.config?.customBackground ?? "#0D1521";
    bgInput.className = "uprooted-color-input";
    const bgRow = createRow("Background", "Main background color", bgInput);
    customSection.appendChild(bgRow);
    const applyCustomPreview = () => {
      if (!isValidHex(accentInput.value) || !isValidHex(bgInput.value)) return;
      flushAllThemeVars();
      setCssVariables(generateCustomVariables(accentInput.value, bgInput.value));
    };
    accentInput.addEventListener("input", applyCustomPreview);
    bgInput.addEventListener("input", applyCustomPreview);
    page.appendChild(customSection);
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
      }
    );
    cssSection.appendChild(textarea);
    page.appendChild(cssSection);
    return page;
  }
  function createLinkRow(label, description, url) {
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
  function getRegisteredPlugins(loader2) {
    const plugins = loader2.plugins;
    return Array.from(plugins.keys());
  }
  function getPlugin(loader2, name) {
    const plugins = loader2.plugins;
    return plugins.get(name) ?? null;
  }
  function getActivePlugins(loader2) {
    return loader2.activePlugins;
  }

  // src/plugins/settings-panel/panel.ts
  var observer = null;
  var injected = false;
  var rootContentPanel = null;
  var uprootedContent = null;
  var activeUprootedItem = null;
  var loader = null;
  var debounceTimer;
  var DEBUG = true;
  var debugEl = null;
  function debugLog(msg) {
    console.log(`[Uprooted] ${msg}`);
    if (!DEBUG) return;
    if (!debugEl) {
      debugEl = document.createElement("div");
      debugEl.id = "uprooted-debug";
      debugEl.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:999999;padding:6px 12px;background:#1a1a2e;color:#0f0;font:11px/1.4 monospace;max-height:30vh;overflow:auto;border-top:2px solid #0f0;pointer-events:none;";
      (document.body ?? document.documentElement).appendChild(debugEl);
    }
    const line = document.createElement("div");
    line.textContent = `${(/* @__PURE__ */ new Date()).toLocaleTimeString()} ${msg}`;
    debugEl.appendChild(line);
    while (debugEl.children.length > 20) debugEl.firstChild?.remove();
  }
  function startObserving(pluginLoader2) {
    loader = pluginLoader2;
    debugLog(`startObserving called. location=${window.location.href} title=${document.title}`);
    debugLog(`body children=${document.body?.children.length} total elements=${document.querySelectorAll("*").length}`);
    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(tryInject, 80);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    tryInject();
  }
  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(debounceTimer);
    cleanup();
    loader = null;
  }
  function findByExactText(text, root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const el = node;
        if (el.children.length === 0 && el.textContent?.trim() === text) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    return walker.nextNode();
  }
  function findByTextIncludes(text, root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const el = node;
        if (el.children.length === 0 && el.textContent?.includes(text)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    return walker.nextNode();
  }
  function tryInject() {
    if (injected && document.querySelector("[data-uprooted]")) return;
    if (injected) {
      injected = false;
      rootContentPanel = null;
      uprootedContent = null;
      activeUprootedItem = null;
    }
    const appSettingsEl = findByExactText("APP SETTINGS");
    if (!appSettingsEl) return;
    debugLog(`Found "APP SETTINGS": tag=${appSettingsEl.tagName} class=${appSettingsEl.className}`);
    const advancedEl = findByExactText("Advanced");
    if (!advancedEl) {
      debugLog("FAIL: Could not find 'Advanced' text");
      return;
    }
    debugLog(`Found "Advanced": tag=${advancedEl.tagName} class=${advancedEl.className}`);
    const layout = findSettingsLayout(appSettingsEl);
    if (!layout) {
      debugLog("FAIL: Could not find settings flex layout");
      dumpAncestors(appSettingsEl);
      return;
    }
    const { sidebar, content } = layout;
    debugLog(`Found layout: sidebar=${sidebar.tagName}.${sidebar.className} content=${content.tagName}.${content.className}`);
    const templateItem = findItemElement(advancedEl, sidebar);
    if (!templateItem) {
      debugLog("FAIL: Could not find template item from 'Advanced'");
      return;
    }
    debugLog(`Template item: tag=${templateItem.tagName} class=${templateItem.className} html=${templateItem.outerHTML.slice(0, 120)}`);
    const insertAfterEl = templateItem;
    injectSidebarSection(sidebar, appSettingsEl, templateItem, insertAfterEl, content);
    injectVersionText();
    injected = true;
    debugLog("SUCCESS: Settings sidebar injected");
  }
  function findSettingsLayout(sidebarChild) {
    let el = sidebarChild;
    for (let depth = 0; depth < 20; depth++) {
      el = el?.parentElement ?? null;
      if (!el || el === document.body || el === document.documentElement) break;
      const style = getComputedStyle(el);
      const isFlexRow = style.display === "flex" && (style.flexDirection === "row" || style.flexDirection === "");
      const isGrid = style.display === "grid";
      if ((isFlexRow || isGrid) && el.children.length >= 2) {
        const children = Array.from(el.children).filter((c) => c instanceof HTMLElement);
        let sidebarEl = null;
        let contentEl = null;
        for (const child of children) {
          if (child.contains(sidebarChild)) {
            sidebarEl = child;
          } else if (!contentEl) {
            if (child.clientWidth > 50 && child.clientHeight > 50) {
              contentEl = child;
            }
          }
        }
        if (sidebarEl && contentEl) {
          return { sidebar: sidebarEl, content: contentEl };
        }
      }
    }
    el = sidebarChild;
    for (let depth = 0; depth < 15; depth++) {
      el = el?.parentElement ?? null;
      if (!el || el === document.body) break;
      const parent = el.parentElement;
      if (!parent) continue;
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== el && sibling instanceof HTMLElement) {
          if (sibling.clientWidth > el.clientWidth && sibling.clientHeight > 100) {
            return { sidebar: el, content: sibling };
          }
        }
      }
    }
    return null;
  }
  function findItemElement(textLeaf, sidebar) {
    let el = textLeaf;
    let lastBeforeSidebar = textLeaf;
    while (el && el !== sidebar) {
      if (el.parentElement === sidebar) {
        return el;
      }
      const parent = el.parentElement;
      if (parent && parent !== sidebar && parent.children.length >= 3) {
        let siblingTextCount = 0;
        for (const sib of Array.from(parent.children)) {
          if (sib !== el && sib.textContent?.trim()) siblingTextCount++;
        }
        if (siblingTextCount >= 2) return el;
      }
      lastBeforeSidebar = el;
      el = el.parentElement;
    }
    return lastBeforeSidebar !== textLeaf ? lastBeforeSidebar : textLeaf.parentElement;
  }
  function dumpAncestors(el) {
    let current = el;
    let depth = 0;
    while (current && current !== document.body && depth < 10) {
      const style = getComputedStyle(current);
      debugLog(
        `  ancestor[${depth}]: ${current.tagName}.${current.className.toString().slice(0, 40)} display=${style.display} flex-dir=${style.flexDirection} overflow-y=${style.overflowY} children=${current.children.length} size=${current.clientWidth}x${current.clientHeight}`
      );
      current = current.parentElement;
      depth++;
    }
  }
  function injectSidebarSection(sidebar, appSettingsHeaderEl, templateItem, insertAfterEl, contentPanel) {
    const section = document.createElement("div");
    section.setAttribute("data-uprooted", "section");
    const header = appSettingsHeaderEl.cloneNode(true);
    header.textContent = "UPROOTED";
    header.setAttribute("data-uprooted", "header");
    section.appendChild(header);
    const items = [
      { name: "Uprooted", page: "uprooted" },
      { name: "Plugins", page: "plugins" },
      { name: "Themes", page: "themes" }
    ];
    for (const { name, page } of items) {
      const item = templateItem.cloneNode(true);
      item.setAttribute("data-uprooted", "item");
      item.setAttribute("data-uprooted-page", page);
      replaceTextContent(item, name);
      removeActiveState(item);
      cleanClonedElement(item);
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onUprootedItemClick(item, page, sidebar, contentPanel);
      });
      section.appendChild(item);
    }
    const insertParent = insertAfterEl.parentElement;
    if (insertParent) {
      if (insertAfterEl.nextSibling) {
        insertParent.insertBefore(section, insertAfterEl.nextSibling);
      } else {
        insertParent.appendChild(section);
      }
    }
    sidebar.addEventListener("click", onSidebarClick, true);
  }
  function replaceTextContent(el, text) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let replaced = false;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent?.trim()) {
        if (!replaced) {
          node.textContent = text;
          replaced = true;
        } else {
          node.textContent = "";
        }
      }
    }
  }
  function removeActiveState(el) {
    const allEls = [el, ...Array.from(el.querySelectorAll("*"))];
    for (const e of allEls) {
      const classes = Array.from(e.classList);
      for (const cls of classes) {
        if (/active|selected|current/i.test(cls)) {
          e.classList.remove(cls);
        }
      }
    }
  }
  function cleanClonedElement(el) {
    const allEls = [el, ...Array.from(el.querySelectorAll("*"))];
    for (const e of allEls) {
      for (const attr of Array.from(e.attributes)) {
        if (attr.name.startsWith("__react") || attr.name.startsWith("data-reactid")) {
          e.removeAttribute(attr.name);
        }
      }
      if (e.id) e.removeAttribute("id");
      if (e.tagName === "A") e.removeAttribute("href");
    }
  }
  function onUprootedItemClick(clickedItem, pageName, sidebar, contentPanel) {
    deactivateRootItems(sidebar);
    const uprootedItems = sidebar.querySelectorAll("[data-uprooted-page]");
    for (const item of uprootedItems) {
      removeActiveState(item);
      item.classList.remove("uprooted-sidebar-active");
    }
    clickedItem.classList.add("uprooted-sidebar-active");
    activeUprootedItem = clickedItem;
    if (!rootContentPanel) {
      rootContentPanel = contentPanel;
    }
    rootContentPanel.style.display = "none";
    uprootedContent?.remove();
    const page = buildPage(pageName);
    if (page) {
      page.setAttribute("data-uprooted", "content");
      page.classList.add("uprooted-page");
      rootContentPanel.parentElement?.appendChild(page);
      uprootedContent = page;
    }
  }
  function buildPage(name) {
    switch (name) {
      case "uprooted":
        return buildUprootedPage();
      case "plugins":
        return loader ? buildPluginsPage(loader) : buildUprootedPage();
      case "themes":
        return loader ? buildThemesPage(loader) : buildUprootedPage();
      default:
        return null;
    }
  }
  function deactivateRootItems(sidebar) {
    const allItems = sidebar.querySelectorAll(
      ":not([data-uprooted]) > :not([data-uprooted])"
    );
    for (const el of allItems) {
      const classes = Array.from(el.classList);
      for (const cls of classes) {
        if (/active|selected|current/i.test(cls)) {
          el.classList.remove(cls);
          el.setAttribute("data-uprooted-was-active", cls);
        }
      }
    }
  }
  function onSidebarClick(e) {
    const target = e.target;
    if (target.closest("[data-uprooted]")) return;
    restoreRootPage();
  }
  function restoreRootPage() {
    uprootedContent?.remove();
    uprootedContent = null;
    if (rootContentPanel) {
      rootContentPanel.style.display = "";
    }
    const uprootedItems = document.querySelectorAll("[data-uprooted-page]");
    for (const item of uprootedItems) {
      removeActiveState(item);
      item.classList.remove("uprooted-sidebar-active");
    }
    activeUprootedItem = null;
  }
  function injectVersionText() {
    const versionEl = findByTextIncludes("Root Version:");
    if (!versionEl) {
      debugLog("Version text not found");
      return;
    }
    if (versionEl.parentElement?.querySelector("[data-uprooted='version']")) return;
    const uprootedVersion = document.createElement("div");
    uprootedVersion.setAttribute("data-uprooted", "version");
    uprootedVersion.className = "uprooted-version";
    uprootedVersion.textContent = `Uprooted Version: ${window.__UPROOTED_VERSION__ ?? "dev"}`;
    const rootStyle = getComputedStyle(versionEl);
    uprootedVersion.style.fontSize = rootStyle.fontSize;
    uprootedVersion.style.color = rootStyle.color;
    uprootedVersion.style.fontFamily = rootStyle.fontFamily;
    uprootedVersion.style.marginTop = "4px";
    if (versionEl.nextSibling) {
      versionEl.parentElement?.insertBefore(uprootedVersion, versionEl.nextSibling);
    } else {
      versionEl.parentElement?.appendChild(uprootedVersion);
    }
  }
  function cleanup() {
    const elements = document.querySelectorAll("[data-uprooted]");
    for (const el of elements) el.remove();
    if (rootContentPanel) {
      rootContentPanel.style.display = "";
      rootContentPanel = null;
    }
    uprootedContent = null;
    activeUprootedItem = null;
    injected = false;
    debugEl?.remove();
    debugEl = null;
  }

  // src/plugins/settings-panel/index.ts
  var settings_panel_default = {
    name: "settings-panel",
    description: "In-app settings panel injected into Root's settings sidebar",
    version: "0.3.44",
    authors: [{ name: "Uprooted" }],
    css: void 0,
    // CSS is loaded from panel.css via the build system
    start() {
      const loader2 = window.__UPROOTED_LOADER__;
      if (!loader2) {
        console.error("[Uprooted] Settings panel: no loader found on window.__UPROOTED_LOADER__");
        return;
      }
      startObserving(loader2);
    },
    stop() {
      stopObserving();
    }
  };

  // src/plugins/link-embeds/providers.ts
  var metadataCache = /* @__PURE__ */ new Map();
  var FETCH_TIMEOUT = 5e3;
  function parseYouTubeId(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace("www.", "");
      if (host === "youtube.com" || host === "m.youtube.com") {
        if (u.pathname === "/watch") {
          return u.searchParams.get("v");
        }
        const match = u.pathname.match(/^\/(embed|shorts)\/([^/?&]+)/);
        if (match) return match[2];
      }
      if (host === "youtu.be") {
        const id = u.pathname.slice(1).split(/[/?&]/)[0];
        return id || null;
      }
    } catch {
    }
    return null;
  }
  function parseOpenGraph(html) {
    const result = {};
    const metaRegex = /<meta\s+(?:[^>]*?\s)?(?:property|name)\s*=\s*["']([^"']+)["'][^>]*?\scontent\s*=\s*["']([^"']*)["'][^>]*?\/?>/gi;
    let match;
    while ((match = metaRegex.exec(html)) !== null) {
      const [, key, value] = match;
      result[key.toLowerCase()] = value;
    }
    const metaRegexReverse = /<meta\s+(?:[^>]*?\s)?content\s*=\s*["']([^"']*)["'][^>]*?\s(?:property|name)\s*=\s*["']([^"']+)["'][^>]*?\/?>/gi;
    while ((match = metaRegexReverse.exec(html)) !== null) {
      const [, value, key] = match;
      const k = key.toLowerCase();
      if (!result[k]) result[k] = value;
    }
    return {
      title: result["og:title"],
      description: result["og:description"],
      image: result["og:image"],
      siteName: result["og:site_name"],
      themeColor: result["theme-color"]
    };
  }
  async function fetchMetadata(url) {
    if (metadataCache.has(url)) {
      return metadataCache.get(url);
    }
    try {
      const videoId = parseYouTubeId(url);
      if (videoId) {
        const data2 = await fetchYouTubeMetadata(url, videoId);
        metadataCache.set(url, data2);
        return data2;
      }
      const data = await fetchGenericMetadata(url);
      metadataCache.set(url, data);
      return data;
    } catch {
      metadataCache.set(url, null);
      return null;
    }
  }
  async function fetchYouTubeMetadata(url, videoId) {
    const data = {
      url,
      type: "youtube",
      provider: "YouTube",
      videoId,
      image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      color: "#FF0000"
    };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      const resp = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: controller.signal }
      );
      clearTimeout(timer);
      if (resp.ok) {
        const json = await resp.json();
        data.title = json.title;
        if (json.author_name) data.description = json.author_name;
      }
    } catch {
    }
    return data;
  }
  async function fetchGenericMetadata(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/html" }
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;
    const reader = resp.body?.getReader();
    if (!reader) return null;
    let html = "";
    const decoder = new TextDecoder();
    const MAX_BYTES = 5e4;
    while (html.length < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel();
    const og = parseOpenGraph(html);
    if (!og.title) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) og.title = titleMatch[1].trim();
    }
    if (!og.title) return null;
    let image = og.image;
    if (image && !image.startsWith("http")) {
      try {
        image = new URL(image, url).href;
      } catch {
        image = void 0;
      }
    }
    let provider = og.siteName;
    if (!provider) {
      try {
        provider = new URL(url).hostname.replace("www.", "");
      } catch {
      }
    }
    return {
      url,
      type: "generic",
      provider,
      title: og.title,
      description: og.description,
      image,
      color: og.themeColor
    };
  }
  function clearCache() {
    metadataCache.clear();
  }

  // src/plugins/link-embeds/embeds.ts
  function truncate(text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max).trimEnd() + "\u2026";
  }
  function textNode(text) {
    return document.createTextNode(text);
  }
  function createEmbedCard(data) {
    if (data.type === "youtube" && data.videoId) {
      return createYouTubeEmbed(data);
    }
    const card = document.createElement("div");
    card.className = "uprooted-embed";
    if (data.color) {
      card.style.borderLeftColor = data.color;
    }
    const body = document.createElement("div");
    body.className = "uprooted-embed-body";
    if (data.provider) {
      const provider = document.createElement("div");
      provider.className = "uprooted-embed-provider";
      provider.appendChild(textNode(data.provider));
      if (data.color) provider.style.color = data.color;
      body.appendChild(provider);
    }
    if (data.title) {
      const title = document.createElement("a");
      title.className = "uprooted-embed-title";
      title.href = data.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
      title.appendChild(textNode(data.title));
      body.appendChild(title);
    }
    if (data.description) {
      const desc = document.createElement("div");
      desc.className = "uprooted-embed-description";
      desc.appendChild(textNode(truncate(data.description, 250)));
      body.appendChild(desc);
    }
    card.appendChild(body);
    if (data.image) {
      const thumbWrap = document.createElement("div");
      thumbWrap.className = "uprooted-embed-thumbnail";
      const img = document.createElement("img");
      img.src = data.image;
      img.alt = data.title ?? "";
      img.loading = "lazy";
      img.onerror = () => thumbWrap.remove();
      thumbWrap.appendChild(img);
      card.appendChild(thumbWrap);
    }
    return card;
  }
  function createYouTubeEmbed(data) {
    const card = document.createElement("div");
    card.className = "uprooted-embed uprooted-embed--youtube";
    if (data.color) {
      card.style.borderLeftColor = data.color;
    }
    const body = document.createElement("div");
    body.className = "uprooted-embed-body";
    const provider = document.createElement("div");
    provider.className = "uprooted-embed-provider";
    provider.appendChild(textNode("YouTube"));
    provider.style.color = "#FF0000";
    body.appendChild(provider);
    if (data.title) {
      const title = document.createElement("a");
      title.className = "uprooted-embed-title";
      title.href = data.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
      title.appendChild(textNode(data.title));
      body.appendChild(title);
    }
    if (data.description) {
      const desc = document.createElement("div");
      desc.className = "uprooted-embed-description";
      desc.appendChild(textNode(data.description));
      body.appendChild(desc);
    }
    card.appendChild(body);
    const videoWrap = document.createElement("div");
    videoWrap.className = "uprooted-embed-video";
    const img = document.createElement("img");
    img.className = "uprooted-embed-video-thumb";
    img.src = data.image ?? `https://img.youtube.com/vi/${data.videoId}/hqdefault.jpg`;
    img.alt = data.title ?? "YouTube video";
    img.loading = "lazy";
    const playBtn = document.createElement("div");
    playBtn.className = "uprooted-embed-yt-play";
    playBtn.innerHTML = '<svg viewBox="0 0 68 48" width="68" height="48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#FF0000"/><path d="M45 24L27 14v20" fill="#fff"/></svg>';
    videoWrap.appendChild(img);
    videoWrap.appendChild(playBtn);
    videoWrap.addEventListener("click", () => {
      const iframe = document.createElement("iframe");
      iframe.className = "uprooted-embed-yt-iframe";
      iframe.src = `https://www.youtube.com/embed/${data.videoId}?autoplay=1`;
      iframe.allow = "autoplay; encrypted-media";
      iframe.allowFullscreen = true;
      iframe.setAttribute("frameborder", "0");
      videoWrap.replaceChildren(iframe);
    });
    card.appendChild(videoWrap);
    return card;
  }

  // src/plugins/link-embeds/index.ts
  var LINK_PATTERN = /^https?:\/\//;
  var observer2 = null;
  var processedLinks = /* @__PURE__ */ new WeakSet();
  function getPluginConfig() {
    const config = window.__UPROOTED_SETTINGS__?.plugins?.["link-embeds"]?.config;
    return {
      youtube: config?.youtube ?? true,
      websites: config?.websites ?? true,
      maxEmbedsPerMessage: config?.maxEmbedsPerMessage ?? 3
    };
  }
  function countEmbedsInContext(anchor) {
    let container = anchor.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      container = container.parentElement;
    }
    if (!container) container = anchor.parentElement;
    return container?.querySelectorAll(".uprooted-embed").length ?? 0;
  }
  function findInsertionPoint(anchor) {
    let block = anchor;
    while (block && block !== document.body) {
      const display = getComputedStyle(block).display;
      if (display === "block" || display === "flex" || display === "grid") {
        return { parent: block.parentNode, ref: block.nextSibling };
      }
      block = block.parentElement;
    }
    return { parent: anchor.parentNode, ref: anchor.nextSibling };
  }
  async function processLink(anchor) {
    if (processedLinks.has(anchor)) return;
    processedLinks.add(anchor);
    const href = anchor.href;
    if (!LINK_PATTERN.test(href)) return;
    if (anchor.closest('[id^="uprooted-"], [data-uprooted]')) return;
    const config = getPluginConfig();
    const isYouTube = /(?:youtube\.com|youtu\.be)/.test(href);
    if (isYouTube && !config.youtube) return;
    if (!isYouTube && !config.websites) return;
    if (countEmbedsInContext(anchor) >= config.maxEmbedsPerMessage) return;
    const data = await fetchMetadata(href);
    if (!data) return;
    if (!anchor.isConnected) return;
    if (countEmbedsInContext(anchor) >= config.maxEmbedsPerMessage) return;
    const card = createEmbedCard(data);
    const { parent, ref } = findInsertionPoint(anchor);
    try {
      parent.insertBefore(card, ref);
    } catch {
      anchor.parentNode?.insertBefore(card, anchor.nextSibling);
    }
  }
  function scanForLinks(root) {
    const anchors = root instanceof HTMLElement ? root.querySelectorAll("a[href]") : [];
    for (const anchor of anchors) {
      if (!processedLinks.has(anchor) && LINK_PATTERN.test(anchor.href)) {
        processLink(anchor);
      }
    }
    if (root instanceof HTMLAnchorElement && root.href && LINK_PATTERN.test(root.href)) {
      processLink(root);
    }
  }
  function onMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scanForLinks(node);
        }
      }
    }
  }
  var link_embeds_default = {
    name: "link-embeds",
    description: "Discord-style link previews for URLs in chat",
    version: "0.3.44",
    authors: [{ name: "Uprooted" }],
    settings: {
      youtube: {
        type: "boolean",
        default: true,
        description: "Show YouTube video embeds"
      },
      websites: {
        type: "boolean",
        default: true,
        description: "Show website link previews"
      },
      maxEmbedsPerMessage: {
        type: "number",
        default: 3,
        min: 1,
        max: 10,
        description: "Maximum embeds per message"
      }
    },
    start() {
      observer2 = new MutationObserver(onMutations);
      observer2.observe(document.body, { childList: true, subtree: true });
      scanForLinks(document.body);
      console.log("[Uprooted] Link embeds started");
    },
    stop() {
      if (observer2) {
        observer2.disconnect();
        observer2 = null;
      }
      document.querySelectorAll(".uprooted-embed").forEach((el) => el.remove());
      clearCache();
      console.log("[Uprooted] Link embeds stopped");
    }
  };

  // src/core/preload.ts
  var VERSION = true ? "0.3.44" : "dev";
  function main() {
    try {
      const settings = window.__UPROOTED_SETTINGS__;
      if (!settings?.enabled) {
        console.log("[Uprooted] Disabled in settings, skipping initialization.");
        return;
      }
      console.log(`[Uprooted] v${VERSION} -- initializing`);
      window.__UPROOTED_VERSION__ = VERSION;
      installBridgeProxy();
      const loader2 = new PluginLoader(settings);
      window.__UPROOTED_LOADER__ = loader2;
      setPluginLoader(loader2);
      loader2.register(sentry_blocker_default);
      loader2.register(themes_default2);
      loader2.register(settings_panel_default);
      loader2.register(link_embeds_default);
      if (settings.customCss) {
        injectCss("uprooted-custom", settings.customCss);
      }
      loader2.startAll().then(() => {
        console.log(`[Uprooted] All plugins started.`);
      });
    } catch (err) {
      const banner = document.createElement("div");
      banner.id = "uprooted-error";
      banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:999999;padding:12px 16px;background:#dc2626;color:#fff;font:14px/1.4 monospace;white-space:pre-wrap;max-height:40vh;overflow:auto;";
      banner.textContent = `[Uprooted] Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
      (document.body ?? document.documentElement).appendChild(banner);
      console.error("[Uprooted] Fatal error during init:", err);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
//# sourceMappingURL=uprooted-preload.js.map
