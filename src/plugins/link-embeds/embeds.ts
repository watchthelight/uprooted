/**
 * Link Embeds -- DOM construction for Discord-style embed cards.
 */

import type { EmbedData } from "./providers.js";

/** Truncate text to a maximum length, adding ellipsis if needed. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "\u2026";
}

/** Sanitize text content to prevent HTML injection. */
function textNode(text: string): Text {
  return document.createTextNode(text);
}

/**
 * Create a Discord-style embed card for generic links.
 */
export function createEmbedCard(data: EmbedData): HTMLElement {
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

  // Provider name
  if (data.provider) {
    const provider = document.createElement("div");
    provider.className = "uprooted-embed-provider";
    provider.appendChild(textNode(data.provider));
    if (data.color) provider.style.color = data.color;
    body.appendChild(provider);
  }

  // Title (clickable link)
  if (data.title) {
    const title = document.createElement("a");
    title.className = "uprooted-embed-title";
    title.href = data.url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.appendChild(textNode(data.title));
    body.appendChild(title);
  }

  // Description
  if (data.description) {
    const desc = document.createElement("div");
    desc.className = "uprooted-embed-description";
    desc.appendChild(textNode(truncate(data.description, 250)));
    body.appendChild(desc);
  }

  card.appendChild(body);

  // Thumbnail (right-aligned for generic embeds)
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

/**
 * Create a YouTube-specific embed card with thumbnail-to-iframe player.
 */
function createYouTubeEmbed(data: EmbedData): HTMLElement {
  const card = document.createElement("div");
  card.className = "uprooted-embed uprooted-embed--youtube";
  if (data.color) {
    card.style.borderLeftColor = data.color;
  }

  const body = document.createElement("div");
  body.className = "uprooted-embed-body";

  // Provider
  const provider = document.createElement("div");
  provider.className = "uprooted-embed-provider";
  provider.appendChild(textNode("YouTube"));
  provider.style.color = "#FF0000";
  body.appendChild(provider);

  // Title
  if (data.title) {
    const title = document.createElement("a");
    title.className = "uprooted-embed-title";
    title.href = data.url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.appendChild(textNode(data.title));
    body.appendChild(title);
  }

  // Channel name as description
  if (data.description) {
    const desc = document.createElement("div");
    desc.className = "uprooted-embed-description";
    desc.appendChild(textNode(data.description));
    body.appendChild(desc);
  }

  card.appendChild(body);

  // Video thumbnail with play button overlay
  const videoWrap = document.createElement("div");
  videoWrap.className = "uprooted-embed-video";

  const img = document.createElement("img");
  img.className = "uprooted-embed-video-thumb";
  img.src = data.image ?? `https://img.youtube.com/vi/${data.videoId}/hqdefault.jpg`;
  img.alt = data.title ?? "YouTube video";
  img.loading = "lazy";

  const playBtn = document.createElement("div");
  playBtn.className = "uprooted-embed-yt-play";

  // SVG play icon
  playBtn.innerHTML =
    '<svg viewBox="0 0 68 48" width="68" height="48">' +
    '<path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#FF0000"/>' +
    '<path d="M45 24L27 14v20" fill="#fff"/>' +
    "</svg>";

  videoWrap.appendChild(img);
  videoWrap.appendChild(playBtn);

  // Click to swap thumbnail with iframe player
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
