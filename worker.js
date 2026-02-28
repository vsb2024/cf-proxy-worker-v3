export default {
  async fetch(request, env, ctx) {
    // Settings
    const TARGET_ORIGIN = "https://online-casino-be.com";
    const BASE_PATH = "/casino/be"; // on your domain
    const BLOCK_SEARCH_INDEXING = false; // Block search engine indexing
    const url = new URL(request.url);

    // Process only our prefix; return 404 for everything else
    if (!url.pathname.startsWith(BASE_PATH)) {
      return new Response("Not Found", { status: 404 });
    }

    // Build target URL: /casino/be/foo -> https://online-casino-be.com/foo
    let upstreamPath = url.pathname.slice(BASE_PATH.length) || "/";
    // Fetch directly from origin IP to bypass CF-to-CF subrequest issues
    const ORIGIN_IP = "206.189.243.237";
    const upstreamUrl = new URL(upstreamPath + url.search, `https://${ORIGIN_IP}`);

    // Prepare proxied request (method/body/headers)
    const reqHeaders = new Headers(request.headers);
    // Host must be the real domain so the origin serves correct content
    reqHeaders.set("Host", new URL(TARGET_ORIGIN).host);
    // Remove Accept-Encoding to simplify HTML rewriting (Cloudflare will compress itself)
    reqHeaders.delete("Accept-Encoding");

    const proxyRequest = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers: reqHeaders,
      body: request.method === "GET" || request.method === "HEAD" ? null : await request.clone().arrayBuffer(),
      redirect: "manual"
    });

    const upstreamResp = await fetch(proxyRequest);

    // Rewrite Location for 30x redirects
    if (upstreamResp.status >= 300 && upstreamResp.status < 400) {
      const loc = upstreamResp.headers.get("Location");
      if (loc) {
        const rewritten = rewriteAbsoluteToProxy(loc, TARGET_ORIGIN, BASE_PATH, url);
        const h = new Headers(upstreamResp.headers);
        h.set("Location", rewritten);
        return new Response(null, { status: upstreamResp.status, headers: h });
      }
      return upstreamResp;
    }

    // Rewrite Set-Cookie (Domain=online-casino-be.com -> Domain=www.vanguardngr.com)
    const outHeaders = new Headers(upstreamResp.headers);
    const setCookies = getAllSetCookie(outHeaders);
    if (setCookies.length) {
      // Clear existing and add rewritten cookies
      outHeaders.delete("Set-Cookie");
      for (const sc of setCookies) {
        outHeaders.append("Set-Cookie", rewriteSetCookieDomain(sc, url.hostname));
      }
    }

    // Content type
    const contentType = upstreamResp.headers.get("Content-Type") || "";

    // HTML: rewrite links and srcset
    if (contentType.includes("text/html")) {
      const rewriter = new HTMLRewriter()
        .on('a[href]', new AttrRewriter('href', TARGET_ORIGIN, BASE_PATH, url))
        .on('link[href]', new AttrRewriter('href', TARGET_ORIGIN, BASE_PATH, url))
        .on('script[src]', new AttrRewriter('src', TARGET_ORIGIN, BASE_PATH, url))
        .on('img[src]', new AttrRewriter('src', TARGET_ORIGIN, BASE_PATH, url))
        .on('form[action]', new AttrRewriter('action', TARGET_ORIGIN, BASE_PATH, url))
        .on('source[srcset]', new SrcSetRewriter('srcset', TARGET_ORIGIN, BASE_PATH, url))
        .on('img[srcset]', new SrcSetRewriter('srcset', TARGET_ORIGIN, BASE_PATH, url));

      // Add meta robots tag for blocking indexing
      if (BLOCK_SEARCH_INDEXING) {
        rewriter.on('head', new NoIndexInjector());
      }

      // Remove source security headers to avoid breaking embedding
      sanitizeHeadersForProxy(outHeaders);

      // Add X-Robots-Tag header for blocking indexing
      if (BLOCK_SEARCH_INDEXING) {
        outHeaders.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
      }

      return rewriter.transform(new Response(upstreamResp.body, {
        status: upstreamResp.status,
        headers: outHeaders
      }));
    }

    // CSS: sometimes useful to rewrite url(/...) => url(/casino/be/...)
    if (contentType.includes("text/css")) {
      const css = await upstreamResp.text();
      const rewrittenCss = css
        // Replace only paths that don't already start with basePath
        .replaceAll(/\burl\((['"]?)\/(?!casino\/be|\/)/g, `url($1${BASE_PATH}/`)
        .replaceAll(new RegExp(escapeRegExp(TARGET_ORIGIN) + "(?!" + escapeRegExp(BASE_PATH) + ")", "g"), ``);
      sanitizeHeadersForProxy(outHeaders);
      outHeaders.set("Content-Length", String(new TextEncoder().encode(rewrittenCss).length));
      return new Response(rewrittenCss, { status: upstreamResp.status, headers: outHeaders });
    }

    // Other types — just proxy
    sanitizeHeadersForProxy(outHeaders);
    return new Response(upstreamResp.body, { status: upstreamResp.status, headers: outHeaders });
  }
};

// === Helper functions ===

// Rewrite absolute/root URL to our prefix
function rewriteAbsoluteToProxy(href, targetOrigin, basePath, reqUrlObj) {
  try {
    const u = new URL(href, targetOrigin);
    const t = new URL(targetOrigin);
    // If link points to source domain — rewrite to proxy path
    if (u.origin === t.origin) {
      // Check if path already starts with basePath
      if (u.pathname.startsWith(basePath)) {
        return u.pathname + (u.search || "") + (u.hash || "");
      }
      return basePath + (u.pathname.startsWith("/") ? u.pathname : `/${u.pathname}`) + (u.search || "") + (u.hash || "");
    }
    // If link is root (when href started with "/")
    if (href.startsWith("/")) {
      // Check if path already starts with basePath
      if (href.startsWith(basePath)) {
        return href;
      }
      return basePath + href;
    }
    // Otherwise — keep as is (external domains)
    return href;
  } catch {
    // relative without protocol etc.
    if (href.startsWith("/")) {
      // Check if path already starts with basePath
      if (href.startsWith(basePath)) {
        return href;
      }
      return basePath + href;
    }
    // Leave relative links — browser will resolve relative to current path
    return href;
  }
}

class AttrRewriter {
  constructor(attr, targetOrigin, basePath, reqUrlObj) {
    this.attr = attr;
    this.targetOrigin = targetOrigin;
    this.basePath = basePath;
    this.reqUrlObj = reqUrlObj;
  }
  element(el) {
    const val = el.getAttribute(this.attr);
    if (!val) return;
    el.setAttribute(this.attr, rewriteAbsoluteToProxy(val, this.targetOrigin, this.basePath, this.reqUrlObj));
  }
}

class SrcSetRewriter {
  constructor(attr, targetOrigin, basePath, reqUrlObj) {
    this.attr = attr;
    this.targetOrigin = targetOrigin;
    this.basePath = basePath;
    this.reqUrlObj = reqUrlObj;
  }
  element(el) {
    const val = el.getAttribute(this.attr);
    if (!val) return;
    const parts = val.split(",").map(s => s.trim()).map(entry => {
      const [urlPart, sizePart] = entry.split(/\s+/, 2);
      const newUrl = rewriteAbsoluteToProxy(urlPart, this.targetOrigin, this.basePath, this.reqUrlObj);
      return sizePart ? `${newUrl} ${sizePart}` : newUrl;
    });
    el.setAttribute(this.attr, parts.join(", "));
  }
}

class NoIndexInjector {
  element(el) {
    el.append('<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">', { html: true });
  }
}

function sanitizeHeadersForProxy(h) {
  h.delete("Content-Security-Policy");
  h.delete("X-Frame-Options");
  h.delete("X-Content-Security-Policy");
  h.delete("X-WebKit-CSP");
  // Let browser determine size after modifications
  h.delete("Content-Length");
}

function getAllSetCookie(headers) {
  // In Workers, headers.getAll is available in CF environment
  if (typeof headers.getAll === "function") {
    return headers.getAll("Set-Cookie") || [];
  }
  // Fallback: some environments concatenate with comma (not always correct, but let's try)
  const one = headers.get("Set-Cookie");
  if (!one) return [];
  return [one];
}

function rewriteSetCookieDomain(sc, newDomain) {
  // Change/add Domain
  const parts = sc.split(";").map(p => p.trim());
  let hasDomain = false;
  const out = parts.map(p => {
    if (/^Domain=/i.test(p)) {
      hasDomain = true;
      return `Domain=${newDomain}`;
    }
    return p;
  });
  if (!hasDomain) {
    out.push(`Domain=${newDomain}`);
  }
  // Security: ensure SameSite=Lax if not specified
  if (!out.some(p => /^SameSite=/i.test(p))) {
    out.push("SameSite=Lax");
  }
  return out.join("; ");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}