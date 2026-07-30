export default {
  async fetch(request, env) {
    // -------------------------------------------------------------
    // 1. BASIC AUTHENTICATION
    // -------------------------------------------------------------
    const USERNAME = "admin";
    const PASSWORD = "WPP2026!";

    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return new Response("Authentication Required", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Protected Multi-Site Report"',
        },
      });
    }

    const [scheme, encoded] = authHeader.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const [user, pass] = decoded.split(":");

      if (user !== USERNAME || pass !== PASSWORD) {
        return new Response("Invalid Credentials", {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Basic realm="Protected Multi-Site Report"',
          },
        });
      }
    } else {
      return new Response("Bad Request", { status: 400 });
    }

    // -------------------------------------------------------------
    // 2. DYNAMIC SUBDOMAIN & CLEAN URL REWRITING (NO .html in Browser)
    // -------------------------------------------------------------
    const url = new URL(request.url);
    const hostnameParts = url.hostname.split(".");

    // Extract subdomain if accessing via subdomain (e.g. audit.yourdomain.com)
    let subdomain = null;
    if (hostnameParts.length > 2 && !url.hostname.includes("workers.dev")) {
      subdomain = hostnameParts[0].toLowerCase();
    }

    let requestPath = url.pathname;

    // Determine internal target file path inside /public
    let internalFilePath = requestPath;

    // If visiting homepage of a subdomain (e.g. audit.yourdomain.com/)
    if (requestPath === "/" || requestPath === "") {
      if (subdomain && subdomain !== "www") {
        internalFilePath = `/${subdomain}.html`;
      } else {
        internalFilePath = "/index.html";
      }
    } 
    // If path has no extension (e.g. /development-lifecycle), append .html internally
    else if (!requestPath.includes(".")) {
      internalFilePath = `${requestPath}.html`;
    }

    // Rewrite request internally to pull the .html file from /public
    const assetUrl = new URL(internalFilePath, url.origin);
    let response = await env.ASSETS.fetch(new Request(assetUrl, request));

    // Fallback to index.html if the requested path doesn't exist (404)
    if (response.status === 404 && internalFilePath !== "/index.html") {
      const fallbackUrl = new URL("/index.html", url.origin);
      response = await env.ASSETS.fetch(new Request(fallbackUrl, request));
    }

    // -------------------------------------------------------------
    // 3. FIX INLINE SVG DISTORTION (Enforce UTF-8 Encoding)
    // -------------------------------------------------------------
    const updatedHeaders = new Headers(response.headers);

    if (internalFilePath.endsWith(".html")) {
      // FORCES browser to parse inline SVGs with exact UTF-8 coordinates (like Vercel)
      updatedHeaders.set("Content-Type", "text/html; charset=utf-8");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: updatedHeaders,
    });
  },
};