/**
 * Link Embeds Plugin -- Discord-style link previews for URLs in chat.
 *
 * Watches for new <a> elements via MutationObserver and renders rich embed
 * cards with OpenGraph metadata. YouTube URLs get thumbnail + play button embeds.
 */

import type { UprootedPlugin } from "../../types/plugin.js";
import { fetchMetadata, clearCache } from "./providers.js";
import { createEmbedCard } from "./embeds.js";

const LINK_PATTERN = /^https?:\/\//;

let observer: MutationObserver | null = null;
const processedLinks = new WeakSet<HTMLAnchorElement>();

function getPluginConfig(): {
  youtube: boolean;
  websites: boolean;
  maxEmbedsPerMessage: number;
} {
  const config =
    window.__UPROOTED_SETTINGS__?.plugins?.["link-embeds"]?.config;
  return {
    youtube: (config?.youtube as boolean) ?? true,
    websites: (config?.websites as boolean) ?? true,
    maxEmbedsPerMessage: (config?.maxEmbedsPerMessage as number) ?? 3,
  };
}

/** Count existing embeds within the closest message-like ancestor. */
function countEmbedsInContext(anchor: HTMLAnchorElement): number {
  // Walk up to find a reasonable message container (a few levels up from the link)
  let container: HTMLElement | null = anchor.parentElement;
  for (let i = 0; i < 5 && container; i++) {
    container = container.parentElement;
  }
  if (!container) container = anchor.parentElement;
  return container?.querySelectorAll(".uprooted-embed").length ?? 0;
}

/** Find the best insertion point for the embed card. */
function findInsertionPoint(anchor: HTMLAnchorElement): {
  parent: Node;
  ref: Node | null;
} {
  // Try to insert after the link's closest block-level parent
  let block: HTMLElement | null = anchor;
  while (block && block !== document.body) {
    const display = getComputedStyle(block).display;
    if (display === "block" || display === "flex" || display === "grid") {
      return { parent: block.parentNode!, ref: block.nextSibling };
    }
    block = block.parentElement;
  }
  // Fallback: insert directly after the anchor
  return { parent: anchor.parentNode!, ref: anchor.nextSibling };
}

async function processLink(anchor: HTMLAnchorElement): Promise<void> {
  if (processedLinks.has(anchor)) return;
  processedLinks.add(anchor);

  const href = anchor.href;
  if (!LINK_PATTERN.test(href)) return;

  // Skip links inside Uprooted's own UI
  if (anchor.closest('[id^="uprooted-"], [data-uprooted]')) return;

  const config = getPluginConfig();

  // Check embed type against settings
  const isYouTube = /(?:youtube\.com|youtu\.be)/.test(href);
  if (isYouTube && !config.youtube) return;
  if (!isYouTube && !config.websites) return;

  // Respect max embeds per message
  if (countEmbedsInContext(anchor) >= config.maxEmbedsPerMessage) return;

  const data = await fetchMetadata(href);
  if (!data) return;

  // Verify the anchor is still in the DOM (may have been removed during fetch)
  if (!anchor.isConnected) return;

  // Re-check limit after async gap
  if (countEmbedsInContext(anchor) >= config.maxEmbedsPerMessage) return;

  const card = createEmbedCard(data);
  const { parent, ref } = findInsertionPoint(anchor);

  try {
    parent.insertBefore(card, ref);
  } catch {
    // Fallback if insertion point is invalid
    anchor.parentNode?.insertBefore(card, anchor.nextSibling);
  }
}

function scanForLinks(root: Node): void {
  const anchors =
    root instanceof HTMLElement
      ? root.querySelectorAll<HTMLAnchorElement>("a[href]")
      : [];

  for (const anchor of anchors) {
    if (!processedLinks.has(anchor) && LINK_PATTERN.test(anchor.href)) {
      processLink(anchor);
    }
  }

  // Also check if the root itself is an anchor
  if (
    root instanceof HTMLAnchorElement &&
    root.href &&
    LINK_PATTERN.test(root.href)
  ) {
    processLink(root);
  }
}

function onMutations(mutations: MutationRecord[]): void {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        scanForLinks(node);
      }
    }
  }
}

export default {
  name: "link-embeds",
  description: "Discord-style link previews for URLs in chat",
  version: "0.4.2",
  authors: [{ name: "Uprooted" }],

  settings: {
    youtube: {
      type: "boolean",
      default: true,
      description: "Show YouTube video embeds",
    },
    websites: {
      type: "boolean",
      default: true,
      description: "Show website link previews",
    },
    maxEmbedsPerMessage: {
      type: "number",
      default: 3,
      min: 1,
      max: 10,
      description: "Maximum embeds per message",
    },
  },

  start() {
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });

    // Process existing links already in the DOM
    scanForLinks(document.body);

    console.log("[Uprooted] Link embeds started");
  },

  stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Remove all embed cards from the DOM
    document
      .querySelectorAll(".uprooted-embed")
      .forEach((el) => el.remove());

    clearCache();

    console.log("[Uprooted] Link embeds stopped");
  },
} satisfies UprootedPlugin;
