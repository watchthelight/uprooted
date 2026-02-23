/**
 * DOM Helpers -- Utilities for interacting with Root's DOM.
 */

/**
 * Wait for an element matching the selector to appear in the DOM.
 * Uses MutationObserver for efficient watching.
 */
export function waitForElement<T extends Element = Element>(
  selector: string,
  timeout = 10000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    // Check if already exists
    const existing = document.querySelector<T>(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const timer = timeout > 0
      ? setTimeout(() => {
          observer.disconnect();
          reject(new Error(`waitForElement("${selector}") timed out after ${timeout}ms`));
        }, timeout)
      : null;

    const observer = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el) {
        observer.disconnect();
        if (timer) clearTimeout(timer);
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * Observe an element for changes. Returns a disconnect function.
 */
export function observe(
  target: Element,
  callback: MutationCallback,
  options: MutationObserverInit = { childList: true, subtree: true },
): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(target, options);
  return () => observer.disconnect();
}

/**
 * Wait for the next animation frame. Useful for batching DOM reads/writes.
 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
