/**
 * Settings panel -- Vencord-style sidebar injection into Root's settings page.
 *
 * Uses a MutationObserver to detect when Root's settings page opens, then:
 *   1. Discovers sidebar structure by text content matching
 *   2. Clones existing sidebar elements to match styling
 *   3. Injects an "UPROOTED" section with nav items
 *   4. Swaps the content panel when Uprooted items are clicked
 *   5. Appends version info near Root's version text
 */

import { buildUprootedPage, buildPluginsPage, buildThemesPage } from "./components.js";
import type { PluginLoader } from "../../core/pluginLoader.js";

// --- State ---
let observer: MutationObserver | null = null;
let injected = false;
let rootContentPanel: HTMLElement | null = null;
let uprootedContent: HTMLElement | null = null;
let activeUprootedItem: HTMLElement | null = null;
let loader: PluginLoader | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let injectedSidebar: HTMLElement | null = null;

// --- Debug ---
const DEBUG = true;
let debugEl: HTMLElement | null = null;

function debugLog(msg: string): void {
  console.log(`[Uprooted] ${msg}`);
  if (!DEBUG) return;
  if (!debugEl) {
    debugEl = document.createElement("div");
    debugEl.id = "uprooted-debug";
    debugEl.style.cssText =
      "position:fixed;bottom:0;left:0;right:0;z-index:999999;padding:6px 12px;" +
      "background:#1a1a2e;color:#0f0;font:11px/1.4 monospace;max-height:30vh;" +
      "overflow:auto;border-top:2px solid #0f0;pointer-events:none;";
    (document.body ?? document.documentElement).appendChild(debugEl);
  }
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
  debugEl.appendChild(line);
  // Keep only last 20 lines
  while (debugEl.children.length > 20) debugEl.firstChild?.remove();
}

// --- Public API ---

export function startObserving(pluginLoader: PluginLoader): void {
  loader = pluginLoader;

  debugLog(`startObserving called. location=${window.location.href} title=${document.title}`);
  debugLog(`body children=${document.body?.children.length} total elements=${document.querySelectorAll("*").length}`);

  observer = new MutationObserver((mutations) => {
    const hasExternalChange = mutations.some(
      (m) => !(m.target as Element).closest?.("[data-uprooted]"),
    );
    if (!hasExternalChange) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tryInject, 80);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Try immediately in case settings is already open
  tryInject();
}

export function stopObserving(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  clearTimeout(debounceTimer);
  cleanup();
  loader = null;
}

// --- DOM Discovery ---

/** Find a leaf element whose trimmed textContent exactly matches `text`. */
function findByExactText(text: string, root: Element = document.body): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      if (el.children.length === 0 && el.textContent?.trim() === text) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  return walker.nextNode() as HTMLElement | null;
}

/** Find a leaf element whose textContent includes `text`. */
function findByTextIncludes(text: string, root: Element = document.body): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      if (el.children.length === 0 && el.textContent?.includes(text)) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  return walker.nextNode() as HTMLElement | null;
}

// --- Core Logic ---

function tryInject(): void {
  // If our elements are still in the DOM, nothing to do
  if (injected && document.querySelector("[data-uprooted]")) return;

  // Reset if previously injected but elements were removed (settings closed/re-rendered)
  if (injected) {
    injected = false;
    rootContentPanel = null;
    uprootedContent = null;
    activeUprootedItem = null;
    // Remove sidebar click listener now — injectSidebarSection will re-add on next inject.
    // Without this, the same element gets a duplicate listener if it survives the re-render.
    if (injectedSidebar) {
      injectedSidebar.removeEventListener("click", onSidebarClick, true);
      injectedSidebar = null;
    }
  }

  // Step 1: Find "APP SETTINGS" header to confirm we're on the settings page
  const appSettingsEl = findByExactText("APP SETTINGS");
  if (!appSettingsEl) return; // Not on settings page - silent return (this fires constantly)

  debugLog(`Found "APP SETTINGS": tag=${appSettingsEl.tagName} class=${appSettingsEl.className}`);

  // Step 2: Find "Advanced" text - the last item in the APP SETTINGS group
  const advancedEl = findByExactText("Advanced");
  if (!advancedEl) {
    debugLog("FAIL: Could not find 'Advanced' text");
    return;
  }
  debugLog(`Found "Advanced": tag=${advancedEl.tagName} class=${advancedEl.className}`);

  // Step 3: Find the settings layout by walking up from APP SETTINGS to find
  // a flex-row ancestor that has both sidebar and content as children
  const layout = findSettingsLayout(appSettingsEl);
  if (!layout) {
    debugLog("FAIL: Could not find settings flex layout");
    // Fallback debug: dump ancestors
    dumpAncestors(appSettingsEl);
    return;
  }
  const { sidebar, content } = layout;
  debugLog(`Found layout: sidebar=${sidebar.tagName}.${sidebar.className} content=${content.tagName}.${content.className}`);

  // Step 4: Find the nav item to clone as a template.
  // Walk up from "Advanced" leaf text to its item-level element.
  const templateItem = findItemElement(advancedEl, sidebar);
  if (!templateItem) {
    debugLog("FAIL: Could not find template item from 'Advanced'");
    return;
  }
  debugLog(`Template item: tag=${templateItem.tagName} class=${templateItem.className} html=${templateItem.outerHTML.slice(0, 120)}`);

  // Step 5: Find where to insert - after the last APP SETTINGS item (Advanced)
  const insertAfterEl = templateItem;

  // Step 6: Inject our sidebar section
  injectSidebarSection(sidebar, appSettingsEl, templateItem, insertAfterEl, content);

  // Step 7: Inject version text
  injectVersionText();

  injected = true;
  debugLog("SUCCESS: Settings sidebar injected");
}

/**
 * Find the settings page flex layout by walking up from a known sidebar element.
 * Returns the sidebar and content panel elements.
 */
function findSettingsLayout(sidebarChild: HTMLElement): { sidebar: HTMLElement; content: HTMLElement } | null {
  let el: HTMLElement | null = sidebarChild;

  // Walk up to find a flex-row ancestor with 2+ children
  for (let depth = 0; depth < 20; depth++) {
    el = el?.parentElement ?? null;
    if (!el || el === document.body || el === document.documentElement) break;

    const style = getComputedStyle(el);
    const isFlexRow =
      style.display === "flex" && (style.flexDirection === "row" || style.flexDirection === "");
    const isGrid = style.display === "grid";

    if ((isFlexRow || isGrid) && el.children.length >= 2) {
      // Candidate: check if one child contains "APP SETTINGS" and the other is wider
      const children = Array.from(el.children).filter(c => c instanceof HTMLElement) as HTMLElement[];

      // Find which child contains our sidebar text
      let sidebarEl: HTMLElement | null = null;
      let contentEl: HTMLElement | null = null;

      for (const child of children) {
        if (child.contains(sidebarChild)) {
          sidebarEl = child;
        } else if (!contentEl) {
          // The first non-sidebar child that is substantial (not a divider/spacer)
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

  // Fallback: try to find content panel by looking for a sibling of any ancestor
  // that is wider than the sidebar path
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

/**
 * From a text leaf element, walk up to find the item-level element
 * (the clickable nav item in the sidebar). Stops before reaching the sidebar container.
 */
function findItemElement(textLeaf: HTMLElement, sidebar: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = textLeaf;
  let lastBeforeSidebar: HTMLElement | null = textLeaf;

  while (el && el !== sidebar) {
    // Check if this element's parent is the sidebar (or the sidebar's scroll container)
    if (el.parentElement === sidebar) {
      return el;
    }

    // Check if this is an item-level element:
    // - Its parent has multiple children (sibling items)
    // - The siblings include other nav items
    const parent = el.parentElement;
    if (parent && parent !== sidebar && parent.children.length >= 3) {
      // This parent has multiple children - el is likely an item
      // Verify by checking that siblings have text content (other nav items)
      let siblingTextCount = 0;
      for (const sib of Array.from(parent.children)) {
        if (sib !== el && sib.textContent?.trim()) siblingTextCount++;
      }
      if (siblingTextCount >= 2) return el;
    }

    lastBeforeSidebar = el;
    el = el.parentElement;
  }

  // If we reached the sidebar, return the last element before it
  return lastBeforeSidebar !== textLeaf ? lastBeforeSidebar : textLeaf.parentElement;
}

/** Debug helper: dump ancestor chain of an element */
function dumpAncestors(el: HTMLElement): void {
  let current: HTMLElement | null = el;
  let depth = 0;
  while (current && current !== document.body && depth < 10) {
    const style = getComputedStyle(current);
    debugLog(
      `  ancestor[${depth}]: ${current.tagName}.${current.className.toString().slice(0, 40)} ` +
      `display=${style.display} flex-dir=${style.flexDirection} overflow-y=${style.overflowY} ` +
      `children=${current.children.length} size=${current.clientWidth}x${current.clientHeight}`
    );
    current = current.parentElement;
    depth++;
  }
}

// --- Sidebar Injection ---

function injectSidebarSection(
  sidebar: HTMLElement,
  appSettingsHeaderEl: HTMLElement,
  templateItem: HTMLElement,
  insertAfterEl: HTMLElement,
  contentPanel: HTMLElement,
): void {
  // Create our section container
  const section = document.createElement("div");
  section.setAttribute("data-uprooted", "section");

  // Clone the section header style from "APP SETTINGS" text element
  const header = appSettingsHeaderEl.cloneNode(true) as HTMLElement;
  header.textContent = "UPROOTED";
  header.setAttribute("data-uprooted", "header");
  section.appendChild(header);

  // Create nav items by cloning the template
  const items = [
    { name: "Uprooted", page: "uprooted" },
    { name: "Plugins", page: "plugins" },
    { name: "Themes", page: "themes" },
  ];

  for (const { name, page } of items) {
    const item = templateItem.cloneNode(true) as HTMLElement;
    item.setAttribute("data-uprooted", "item");
    item.setAttribute("data-uprooted-page", page);

    // Replace all text content in the cloned item
    replaceTextContent(item, name);

    // Remove any "active" classes from the clone
    removeActiveState(item);

    // Remove any React/framework internal props that could cause issues
    cleanClonedElement(item);

    // Attach click handler
    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onUprootedItemClick(item, page, sidebar, contentPanel);
    });

    section.appendChild(item);
  }

  // Insert after the last APP SETTINGS item (insertAfterEl).
  // If insertAfterEl is a direct child of its parent, insert as sibling.
  const insertParent = insertAfterEl.parentElement;
  if (insertParent) {
    if (insertAfterEl.nextSibling) {
      insertParent.insertBefore(section, insertAfterEl.nextSibling);
    } else {
      insertParent.appendChild(section);
    }
  }

  // Listen for clicks on Root's own sidebar items to restore their content
  injectedSidebar = sidebar;
  sidebar.addEventListener("click", onSidebarClick, true);
}

/** Replace all text nodes in an element tree with the given text (only the first text node). */
function replaceTextContent(el: HTMLElement, text: string): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let replaced = false;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.textContent?.trim()) {
      if (!replaced) {
        node.textContent = text;
        replaced = true;
      } else {
        // Remove extra text nodes (e.g. badges, counts)
        node.textContent = "";
      }
    }
  }
}

/** Remove active/selected CSS classes from a cloned element tree. */
function removeActiveState(el: HTMLElement): void {
  const allEls = [el, ...Array.from(el.querySelectorAll("*"))] as HTMLElement[];
  for (const e of allEls) {
    const classes = Array.from(e.classList);
    for (const cls of classes) {
      if (/active|selected|current/i.test(cls)) {
        e.classList.remove(cls);
      }
    }
  }
}

/** Remove React/framework internal attributes from cloned elements. */
function cleanClonedElement(el: HTMLElement): void {
  const allEls = [el, ...Array.from(el.querySelectorAll("*"))] as HTMLElement[];
  for (const e of allEls) {
    // Remove React fiber keys
    for (const attr of Array.from(e.attributes)) {
      if (attr.name.startsWith("__react") || attr.name.startsWith("data-reactid")) {
        e.removeAttribute(attr.name);
      }
    }
    // Remove id to avoid duplicates
    if (e.id) e.removeAttribute("id");
    // Remove href to prevent navigation
    if (e.tagName === "A") e.removeAttribute("href");
  }
}

// --- Content Panel Swapping ---

function onUprootedItemClick(
  clickedItem: HTMLElement,
  pageName: string,
  sidebar: HTMLElement,
  contentPanel: HTMLElement,
): void {
  // Deactivate all Root sidebar items
  deactivateRootItems(sidebar);

  // Deactivate other Uprooted items and activate clicked one
  const uprootedItems = sidebar.querySelectorAll("[data-uprooted-page]");
  for (const item of uprootedItems) {
    removeActiveState(item as HTMLElement);
    (item as HTMLElement).classList.remove("uprooted-sidebar-active");
  }
  clickedItem.classList.add("uprooted-sidebar-active");
  activeUprootedItem = clickedItem;

  // Hide Root's content panel
  if (!rootContentPanel) {
    rootContentPanel = contentPanel;
  }
  rootContentPanel.style.display = "none";

  // Remove existing Uprooted content
  uprootedContent?.remove();

  // Build and insert new content
  const page = buildPage(pageName);
  if (page) {
    page.setAttribute("data-uprooted", "content");
    page.classList.add("uprooted-page");
    rootContentPanel.parentElement?.appendChild(page);
    uprootedContent = page;
  }
}

function buildPage(name: string): HTMLElement | null {
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

/** Deactivate Root's active sidebar item. */
function deactivateRootItems(sidebar: HTMLElement): void {
  const allItems = sidebar.querySelectorAll(
    ":not([data-uprooted]) > :not([data-uprooted])",
  );
  for (const el of allItems) {
    const classes = Array.from(el.classList);
    for (const cls of classes) {
      if (/active|selected|current/i.test(cls)) {
        el.classList.remove(cls);
        (el as HTMLElement).setAttribute("data-uprooted-was-active", cls);
      }
    }
  }
}

/** Handle clicks on Root's own sidebar items to restore their content. */
function onSidebarClick(e: Event): void {
  const target = e.target as HTMLElement;
  if (target.closest("[data-uprooted]")) return;
  restoreRootPage();
}

function restoreRootPage(): void {
  uprootedContent?.remove();
  uprootedContent = null;

  if (rootContentPanel) {
    rootContentPanel.style.display = "";
  }

  const uprootedItems = document.querySelectorAll("[data-uprooted-page]");
  for (const item of uprootedItems) {
    removeActiveState(item as HTMLElement);
    (item as HTMLElement).classList.remove("uprooted-sidebar-active");
  }

  activeUprootedItem = null;
}

// --- Version Text ---

function injectVersionText(): void {
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

// --- Cleanup ---

function cleanup(): void {
  if (injectedSidebar) {
    injectedSidebar.removeEventListener("click", onSidebarClick, true);
    injectedSidebar = null;
  }

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
