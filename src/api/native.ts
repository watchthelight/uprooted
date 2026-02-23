/**
 * Native Helpers -- Utilities for interacting with Root's native layer.
 *
 * Root's Chromium runs with --disable-web-security, so we have broad access
 * to the page context. These helpers wrap common native interactions.
 */

/**
 * Get the current theme from Root's data attribute.
 */
export function getCurrentTheme(): string | null {
  return document.documentElement.getAttribute("data-theme");
}

/**
 * Override a CSS variable at the :root level.
 * This mimics what Root's server does via InjectCss.
 */
export function setCssVariable(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

/**
 * Remove a CSS variable override, falling back to the stylesheet default.
 */
export function removeCssVariable(name: string): void {
  document.documentElement.style.removeProperty(name);
}

/**
 * Set multiple CSS variables at once.
 */
export function setCssVariables(vars: Record<string, string>): void {
  for (const [name, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(name, value);
  }
}

/**
 * Log a message through Root's native bridge (appears in .NET logs).
 */
export function nativeLog(message: string): void {
  window.__webRtcToNative?.log?.(`[Uprooted] ${message}`);
}
