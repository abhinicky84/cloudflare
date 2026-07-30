export default {
  async fetch(request, env) {
    // -------------------------------------------------------------
    // 1. BASIC AUTHENTICATION
    // -------------------------------------------------------------
    const USERNAME = "admin";
    const PASSWORD = "WPPEnterprise";

    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return new Response("Authentication Required", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Protected Area"',
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
            "WWW-Authenticate": 'Basic realm="Protected Area"',
          },
        });
      }
    } else {
      return new Response("Bad Request", { status: 400 });
    }

    // -------------------------------------------------------------
    // 2. SUBDOMAIN & PATH MAPPING (NO REDIRECT LOOP)
    // -------------------------------------------------------------
    const url = new URL(request.url);
    const hostnameParts = url.hostname.split(".");

    // Extract subdomain if using custom domain or workers.dev multi-level subdomain
    let subdomain = null;
    if (hostnameParts.length > 2) {
      subdomain = hostnameParts[0].toLowerCase();
    }

    let targetPath = url.pathname;

    // A. Handle Root Path / Homepage Visits
    if (targetPath === "/" || targetPath === "") {
      if (subdomain && subdomain !== "www" && subdomain !== "development-lifecycle") {
        // Map subdomain (e.g. audit.domain.com) to /audit without appending .html
        targetPath = `/${subdomain}`;
      } else if (subdomain === "development-lifecycle") {
        // Specific map for your deployment
        targetPath = "/development-lifecycle";
      } else {
        targetPath = "/index";
      }
    }

    // Strip trailing .html if requested directly to prevent Cloudflare 301 redirects
    if (targetPath.endsWith(".html")) {
      targetPath = targetPath.slice(0, -5);
    }

    // Construct asset request for Cloudflare's Clean URL engine
    const assetUrl = new URL(targetPath, url.origin);
    let response = await env.ASSETS.fetch(new Request(assetUrl, request));

    // B. Catch Redirect Responses from Cloudflare Assets and Force 200 OK
    if (response.status === 301 || response.status === 302) {
      const location = response.headers.get("Location");
      if (location) {
        // Fetch the location asset directly to break any Cloudflare redirect loop
        const redirectAssetUrl = new URL(location, url.origin);
        response = await env.ASSETS.fetch(new Request(redirectAssetUrl, request));
      }
    }

    // C. Fallback to /index if 404
    if (response.status === 404 && targetPath !== "/index") {
      const fallbackUrl = new URL("/index", url.origin);
      response = await env.ASSETS.fetch(new Request(fallbackUrl, request));
    }

    // -------------------------------------------------------------
    // 3. FIX INLINE SVG / HTML UTF-8 ENCODING
    // -------------------------------------------------------------
    const newHeaders = new Headers(response.headers);
    
    // Ensure charset=utf-8 is set so inline SVGs render crisply
    const contentType = newHeaders.get("Content-Type") || "";
    if (contentType.includes("text/html") || targetPath.includes("development-lifecycle") || targetPath === "/index") {
      newHeaders.set("Content-Type", "text/html; charset=utf-8");
    }

    return new Response(response.body, {
      status: response.status === 301 ? 200 : response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};