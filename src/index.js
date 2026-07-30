export default {
  async fetch(request, env) {
    // -------------------------------------------------------------
    // 1. BASIC AUTHENTICATION CHECK
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
    // 2. DYNAMIC SUBDOMAIN ROUTING LOGIC
    // -------------------------------------------------------------
    const url = new URL(request.url);
    const hostnameParts = url.hostname.split(".");

    // Detect subdomain (e.g., "audit" from "audit.yourdomain.com")
    // Assumes standard 2-part root domains (e.g., yourdomain.com -> 3 parts for subdomain)
    // Works with localhost or cloudflare worker subdomains (e.g. audit.site.workers.dev)
    let subdomain = null;
    if (hostnameParts.length > 2) {
      subdomain = hostnameParts[0].toLowerCase();
    }

    // Determine target HTML path in /public
    let targetPath = url.pathname;

    // If visiting the homepage "/" of a subdomain (e.g., audit.yourdomain.com/)
    if (targetPath === "/" || targetPath === "") {
      if (subdomain && subdomain !== "www") {
        targetPath = `/${subdomain}.html`;
      } else {
        targetPath = "/index.html";
      }
    }

    // Construct rewritten request for Static Assets binding
    const rewrittenUrl = new URL(targetPath, url.origin);
    const rewrittenRequest = new Request(rewrittenUrl, request);

    // Serve asset from public/ folder
    let response = await env.ASSETS.fetch(rewrittenRequest);

    // Fallback: If <subdomain>.html is missing (404), fallback to index.html
    if (response.status === 404 && targetPath !== "/index.html") {
      const fallbackUrl = new URL("/index.html", url.origin);
      response = await env.ASSETS.fetch(new Request(fallbackUrl, request));
    }

    return response;
  },
};