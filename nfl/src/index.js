export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const AEM_ORIGIN = "https://dev-media.nfl.com";
    const AEM_PROXY_PATHS = ["/content", "/etc", "/etc.clientlib", "/etc.clientlibs", "/libs"];

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
      newHeaders.set("Cache-Control", "no-store");
      newHeaders.set("X-Worker-Route", "assets");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("X-Worker-Route", "assets");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }
};

function shouldProxyToAem(pathname, proxyPaths) {
  return proxyPaths.some((pathPrefix) => {
    return pathname === pathPrefix || pathname.startsWith(pathPrefix + "/");
  });
}

async function proxyToAem(request, sourceUrl, origin) {
  //console.log(`Proxying request for ${sourceUrl.pathname} to AEM at ${origin}`);
  const targetUrl = new URL(sourceUrl.pathname + sourceUrl.search, origin);
  console.log(`Target URL: ${targetUrl.toString()}`);
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
  // 1. Log the basic metadata immediately
console.log({
  url: proxyRequest.url,
  method: proxyRequest.method,
  headers: Object.fromEntries(proxyRequest.headers.entries()),
  redirect: proxyRequest.redirect
});

// 2. Clone and log the body safely (if it has one)
if (proxyRequest.body) {
  const clonedRequest = proxyRequest.clone();
  clonedRequest.text().then(bodyText => {
    try {
      console.log('Body (JSON):', JSON.parse(bodyText));
    } catch {
      console.log('Body (Text):', bodyText);
    }
  });
}
  //console.log(`Proxy Request: ${proxyRequest.json()}`);
  const response = await fetch(proxyRequest);
  // 1. Log basic metadata safely
console.log(`Status: ${response.status} ${response.statusText}`);
console.log(`URL: ${response.url}`);

// 2. CLONE the response so you don't break your app's stream
const clonedResponse = response.clone();

// 3. Read and log the cloned body (assuming JSON)
try {
  const data = await clonedResponse.json();
  console.log("Response Body Data:", data);
} catch (e) {
  // If it's not JSON, try logging it as plain text
  const text = await clonedResponse.text();
  console.log("Response Body Text:", text);
}
  //console.log(`Proxy Response: ${response.json()}`);
  const responseHeaders = new Headers(response.headers);
  const location = responseHeaders.get("Location");
  //console.log(`Location Header: ${location}`);

  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Worker-Route", "aem-proxy");
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
