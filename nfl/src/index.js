export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const AEM_ORIGIN = "https://dev-media.nfl.com";
    const AEM_PROXY_PATHS = ["/content", "/etc", "/etc.clientlib", "/etc.clientlibs"];

    if (shouldProxyToAem(url.pathname, AEM_PROXY_PATHS)) {
      console.log(`Proxying request for ${url.pathname} to AEM at ${AEM_ORIGIN}`);
      return proxyToAem(request, url, AEM_ORIGIN);
    }

    // -------------------------------------------------------------
    // 1. BASIC AUTHENTICATION
    // -------------------------------------------------------------
    const USERNAME = "admin";
    const PASSWORD = "Verticurl2026!";

    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return new Response("Authentication Required", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Octave Protected Reports"',
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
            "WWW-Authenticate": 'Basic realm="Octave Protected Reports"',
          },
        });
      }
    } else {
      return new Response("Bad Request", { status: 400 });
    }

    // -------------------------------------------------------------
    // 2. FETCH STATIC ASSET (PASS REQUEST DIRECTLY TO PREVENT LOOPS)
    // -------------------------------------------------------------
    // Passing `request` directly lets Cloudflare Pages natively:
    // - Serve public/index.html when visiting /
    // - Serve public/china-region-pov.html when visiting /china-region-pov
    // - Eliminate all 301 redirect loops
    let response = await env.ASSETS.fetch(request);

    // -------------------------------------------------------------
    // 3. ENFORCE UTF-8 FOR HTML & SVG RENDERING
    // -------------------------------------------------------------
    if (url.pathname === "/" || url.pathname.endsWith(".html") || !url.pathname.includes(".")) {
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Content-Type", "text/html; charset=utf-8");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    return response;
  }
};

function shouldProxyToAem(pathname, proxyPaths) {
  return proxyPaths.some((pathPrefix) => {
    return pathname === pathPrefix || pathname.startsWith(pathPrefix + "/");
  });
}

async function proxyToAem(request, sourceUrl, origin) {
  console.log(`Proxying request for ${sourceUrl.pathname} to AEM at ${origin}`);
  const targetUrl = new URL(sourceUrl.pathname + sourceUrl.search, origin);
  const proxyHeaders = new Headers(request.headers);
  const proxyRequestInit = {
    method: request.method,
    headers: proxyHeaders,
    redirect: "manual",
  };

  proxyHeaders.delete("Authorization");
  proxyHeaders.delete("Cookie");
  proxyHeaders.delete("Host");
  proxyHeaders.set("X-Forwarded-Host", sourceUrl.host);
  proxyHeaders.set("X-Forwarded-Proto", sourceUrl.protocol.replace(":", ""));

  if (request.method !== "GET" && request.method !== "HEAD") {
    proxyRequestInit.body = request.body;
  }

  const proxyRequest = new Request(targetUrl.toString(), proxyRequestInit);

  const response = await fetch(proxyRequest);
  const responseHeaders = new Headers(response.headers);
  const location = responseHeaders.get("Location");

  responseHeaders.set("X-AEM-Origin", targetUrl.origin);
  responseHeaders.set("X-AEM-Proxied-Path", targetUrl.pathname);

  if (location) {
    responseHeaders.set("Location", rewriteAemLocation(location, sourceUrl, origin));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

function rewriteAemLocation(location, sourceUrl, origin) {
  try {
    const redirectUrl = new URL(location, origin);
    const aemOrigin = new URL(origin);

    if (redirectUrl.origin === aemOrigin.origin) {
      redirectUrl.protocol = sourceUrl.protocol;
      redirectUrl.host = sourceUrl.host;
    }

    return redirectUrl.toString();
  } catch (_) {
    return location;
  }
}
