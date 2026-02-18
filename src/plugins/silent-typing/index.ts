import type { UprootedPlugin } from "../../types/plugin.js";

let originalFetch: typeof window.fetch | null = null;
let originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;

function isTypingIndicatorUrl(url: string | URL | Request): boolean {
  const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  return urlStr.includes("api.rootapp.com/root.v2.MessageGrpcService/SetTypingIndicator");
}

const silentTypingPlugin: UprootedPlugin = {
  name: "silent-typing",
  description: "Hide that you are typing",
  version: "0.1.0",
  authors: [{ name: "Kurumi Nanase" }],

  start() {
    originalFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      if (isTypingIndicatorUrl(input)) {
        console.log(`[Uprooted:Silent typing] Blocked typing indicator`);
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return originalFetch!.call(window, input, init);
    };

    originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      if (isTypingIndicatorUrl(url)) {
        console.log(`[Uprooted:Silent typing] Blocked typing indicator`);
        return originalXHROpen!.call(this, method, "about:blank", ...rest);
      }
      return originalXHROpen!.call(this, method, url, ...rest);
    };

    console.log("[Uprooted:Silent typing] Network intercepts installed");
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
    console.log("[Uprooted:Silent typing] Intercepts removed");
  },
};

export default silentTypingPlugin;
