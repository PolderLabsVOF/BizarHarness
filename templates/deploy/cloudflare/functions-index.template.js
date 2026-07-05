// Cloudflare Workers entry — Bizar dashboard
// This file becomes functions/index.js in the deployment.

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Serve static assets from Pages KV
  if (url.pathname.startsWith("/assets/")) {
    return env.ASSETS.fetch(request);
  }

  // SPA fallback — serve index.html for all non-asset routes
  return env.ASSETS.fetch(new Request(url.origin + "/index.html", request));
}
