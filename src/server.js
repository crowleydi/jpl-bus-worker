/**
 * Thin wrapper around the JSON worker so `/` and `/ui` can serve the picker
 * without bloating src/index.js. Query-param API routes are unchanged.
 */
import worker from "./index.js";
import UI_PAGE from "./ui.html";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function html(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      ...CORS,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const hasApiQuery =
      url.searchParams.has("stop") ||
      url.searchParams.has("from") ||
      url.searchParams.has("to") ||
      url.searchParams.get("stops") === "1" ||
      url.searchParams.get("refresh") === "1";
    const wantsUi =
      url.pathname === "/ui" ||
      url.pathname === "/index.html" ||
      ((url.pathname === "/" || url.pathname === "") && !hasApiQuery);

    if (wantsUi) return html(UI_PAGE);
    return worker.fetch(request, env, ctx);
  },

  scheduled(event, env, ctx) {
    return worker.scheduled(event, env, ctx);
  },
};
