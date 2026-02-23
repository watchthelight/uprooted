/**
 * CSS Injection -- Runtime injection and removal of CSS stylesheets.
 *
 * Each injection is identified by an ID so it can be individually removed.
 * Uses <style> elements appended to <head>.
 */

const ID_PREFIX = "uprooted-css-";

/**
 * Inject a CSS string into the page. If a style with the same ID already exists,
 * it will be replaced.
 */
export function injectCss(id: string, css: string): void {
  const elementId = ID_PREFIX + id;
  let style = document.getElementById(elementId) as HTMLStyleElement | null;

  if (!style) {
    style = document.createElement("style");
    style.id = elementId;
    document.head.appendChild(style);
  }

  style.textContent = css;
}

/**
 * Remove a previously injected CSS by ID.
 */
export function removeCss(id: string): void {
  const elementId = ID_PREFIX + id;
  const style = document.getElementById(elementId);
  style?.remove();
}

/**
 * Remove all Uprooted-injected CSS from the page.
 */
export function removeAllCss(): void {
  const styles = document.querySelectorAll(`style[id^="${ID_PREFIX}"]`);
  for (const style of styles) {
    style.remove();
  }
}
