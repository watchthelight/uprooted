/**
 * Sentry Blocker -- Blocks Sentry error tracking to protect user privacy.
 *
 * Root sends telemetry to Sentry (o4509469920133120.ingest.us.sentry.io) with:
 *   - sendDefaultPii: true (IP addresses on every event)
 *   - replaysOnErrorSampleRate: 0.25 (DOM replays: mouse, inputs, snapshots)
 *   - tracesSampleRate: 0.025 (page load traces)
 *   - enableLogs (production logs)
 *   - Auth headers (Bearer tokens) in request breadcrumbs
 *
 * This plugin intercepts fetch, XMLHttpRequest, and sendBeacon to block all
 * requests to *.sentry.io. Fetch-level blocking is used instead of Sentry.init
 * override because Sentry initializes at module evaluation time in Root's bundle.
 */

import type { UprootedPlugin } from "../../types/plugin.js";

let originalFetch: typeof window.fetch | null = null;
let originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;
let originalSendBeacon: typeof navigator.sendBeacon | null = null;
let blockedCount = 0;

function isSentryUrl(url: string | URL | Request): boolean {
  const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  return urlStr.includes("sentry.io");
}

const sentryBlockerPlugin: UprootedPlugin = {
  name: "sentry-blocker",
  description: "Blocks Sentry error tracking to protect your privacy",
  version: "0.3.6-rc",
  authors: [{ name: "Uprooted" }],

  start() {
    blockedCount = 0;

    // Wrap fetch
    originalFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      if (isSentryUrl(input)) {
        blockedCount++;
        console.log(`[Uprooted:sentry-blocker] Blocked fetch to sentry.io (${blockedCount} total)`);
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return originalFetch!.call(window, input, init);
    };

    // Wrap XMLHttpRequest.open
    originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      if (isSentryUrl(url)) {
        blockedCount++;
        console.log(`[Uprooted:sentry-blocker] Blocked XHR to sentry.io (${blockedCount} total)`);
        // Point to an invalid URL so send() is a no-op
        return originalXHROpen!.call(this, method, "about:blank", ...rest);
      }
      return originalXHROpen!.call(this, method, url, ...rest);
    };

    // Wrap sendBeacon
    originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null): boolean {
      if (isSentryUrl(url)) {
        blockedCount++;
        console.log(`[Uprooted:sentry-blocker] Blocked sendBeacon to sentry.io (${blockedCount} total)`);
        return true;
      }
      return originalSendBeacon!(url, data);
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
  },
};

export default sentryBlockerPlugin;
