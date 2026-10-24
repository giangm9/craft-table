// The studio's sign-in session (after the OIDC provider returns an email), plus the request checks around it.
// Cookie = base64url({email,exp}) + "." + its HMAC-SHA256 with SESSION_SECRET.
import crypto from "node:crypto";

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unb64u = (s) => JSON.parse(Buffer.from(s, "base64url").toString());
const mac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("base64url");
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** now in seconds. */
export function signSession(email, secret, ttl, now) {
  const p = b64u({ email: String(email).toLowerCase(), exp: now + ttl });
  return `${p}.${mac(secret, "s:" + p)}`;
}

export function readSession(cookie, secret, now, allowed) {
  if (!cookie || typeof cookie !== "string") return null;
  const [p, s] = cookie.split(".");
  if (!p || !s || !safeEq(s, mac(secret, "s:" + p))) return null;
  try {
    const { email, exp } = unb64u(p);
    if (!email || !(exp > now)) return null;
    if (allowed.length && !allowed.includes(email)) return null;
    return email;
  } catch {
    return null;
  }
}

export function signValue(value, secret) {
  const p = b64u(value);
  return `${p}.${mac(secret, "v:" + p)}`;
}

export function readValue(cookie, secret) {
  if (!cookie || typeof cookie !== "string") return null;
  const [p, s] = cookie.split(".");
  if (!p || !s || !safeEq(s, mac(secret, "v:" + p))) return null;
  try { return unb64u(p); } catch { return null; }
}

/**
 * Cookie header → { name: value }. A malformed %-encoded value (e.g. "x=%E0", set by another app on the same parent
 * domain) is SKIPPED, never thrown — a stray cookie must not break a request, let alone take the server down (the
 * upgrade event). Same name twice: the later one wins (as before), unless the later one is malformed.
 */
export function parseCookies(header) {
  const o = {};
  for (const p of String(header ?? "").split(";")) {
    const i = p.indexOf("=");
    if (i <= 0) continue;
    const name = p.slice(0, i).trim();
    if (!name) continue;
    try { o[name] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* malformed value → skipped */ }
  }
  return o;
}

/** Only internal paths to return to: "/x" yes; "//host", "/\host", "https://" no. */
export function safeRedirect(rd) {
  if (typeof rd !== "string" || !rd.startsWith("/")) return "/";
  if (rd.startsWith("//") || rd.startsWith("/\\")) return "/";
  return rd;
}

// Headers a proxy adds when forwarding — any one of them means the request came through a proxy, even one running on
// this very machine.
const FORWARDING_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip"];
const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const LOCAL_HOST_HEADER = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

/** The socket address is loopback: 127.0.0.0/8, ::1, ::ffff:127.x.x.x. */
function isLoopback(addr) {
  const a = String(addr ?? "").toLowerCase();
  return a === "::1" || LOOPBACK_V4.test(a.startsWith("::ffff:") ? a.slice(7) : a);
}

/**
 * A request from THIS VERY MACHINE (Claude's Puppeteer, chat.mjs, the healthcheck) → "claude@local", no sign-in.
 * All three must hold: a loopback socket · no forwarding header at all · Host is localhost / 127.0.0.1 / [::1].
 * A reverse proxy on the same machine also connects from loopback; the last two checks only stop a proxy that LEAVES
 * A TRACE (a forwarding header, or the public Host the client sent). The Host is the CLIENT's word, so a client that
 * sends "Host: localhost" passes.
 * THEREFORE, when the studio is opened to the outside through anything running on this machine:
 *   • an HTTP proxy / HTTP tunnel on the same machine MUST add X-Forwarded-For (or Forwarded) to EVERY request;
 *   • NEVER use a raw TCP forwarder into loopback (ssh -R, frp/ngrok in tcp mode, socat, kubectl port-forward): it
 *     passes the bytes as they are, adds no header → anyone who sends "Host: localhost" becomes "this machine".
 * A proxy/tunnel connecting to a NON-loopback address (a container, a LAN IP) is safe — the socket is not loopback.
 * Requests that another web page makes (CSRF) are stopped separately, in fromOtherSite().
 */
export function isLocalRequest(remoteAddress, headers = {}) {
  if (!isLoopback(remoteAddress)) return false;
  if (FORWARDING_HEADERS.some((h) => headers[h] !== undefined)) return false;
  return LOCAL_HOST_HEADER.test(String(headers.host ?? ""));
}

/** A readable http/https Origin → URL (host and origin normalised to lowercase); otherwise null. */
function originOf(s) {
  try {
    const u = new URL(String(s));
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * A request that ANOTHER WEB PAGE makes the browser send to the studio (CSRF, websocket hijacking) → true: such a
 * request must carry no identity — neither "this machine" (a foreign page open in a browser on the studio's machine)
 * nor a signed-in session.
 *   • Sec-Fetch-Site (set by the browser, a page cannot forge it): same-origin / none → the studio's own; cross-site,
 *     same-site (e.g. another dev server on localhost:3000) → another page, EXCEPT opening a page with GET/HEAD
 *     (following a link to the studio — writes nothing, and the other page cannot read the result).
 *   • Older browsers without Sec-Fetch-*: the Origin (when present) must match the request's Host, or one of
 *     ownOrigins (the public address — when a proxy rewrites the Host). "null" (file://, sandboxed iframe) is another page.
 *   • No Origin and no Sec-Fetch-Site: a tool on the machine (Node's fetch, curl) or a page opened in an older browser.
 */
export function fromOtherSite(method, headers = {}, ownOrigins = []) {
  const site = headers["sec-fetch-site"];
  if (site === "same-origin" || site === "none") return false;
  const opensPage = (method === "GET" || method === "HEAD") && headers["sec-fetch-mode"] === "navigate";
  if (site !== undefined) return !opensPage;
  if (headers.origin === undefined) return false;
  const o = originOf(headers.origin);
  if (!o) return true;
  if (o.host === String(headers.host ?? "").toLowerCase()) return false;
  return !ownOrigins.some((x) => originOf(x)?.origin === o.origin);
}

const HOST_PORT = /^([a-z0-9-]+(\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(:\d{1,5})?$/i;
const PLAIN_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The address people open the studio at (no trailing "/") — redirect URI = <address>/__auth/callback.
 *   STUDIO_PUBLIC_URL  "https://studio.example.com" — scheme + host[:port] only, no path.
 *   STUDIO_PUBLIC_HOST (older) "studio.example.com" → https; localhost / 127.0.0.1 / [::1] → http. Older form, still
 *                      accepted.
 *   nothing set        http://localhost:<port>
 * A wrong shape → throws (the server stops at start-up rather than run with a guessed address).
 */
export function publicUrlFrom({ url, host, port }) {
  if (url?.trim()) {
    let u;
    try { u = new URL(url.trim()); } catch { u = null; }
    if (!u || !["http:", "https:"].includes(u.protocol) || u.pathname !== "/" || u.search || u.hash || u.username || u.password || url.trim().endsWith("?") || url.trim().endsWith("#")) {
      throw new Error(`STUDIO_PUBLIC_URL must look like https://studio.example.com (no path) — it is "${url}"`);
    }
    return u.origin;
  }
  if (host?.trim()) {
    const h = host.trim();
    if (!HOST_PORT.test(h)) throw new Error(`STUDIO_PUBLIC_HOST must look like studio.example.com[:port] — it is "${host}"`);
    return `${PLAIN_HTTP_HOSTS.has(h.replace(/:\d+$/, "").toLowerCase()) ? "http" : "https"}://${h}`;
  }
  return `http://localhost:${port}`;
}

/** Set-Cookie for a studio cookie. "Secure" only when the studio is opened over https — http on localhost can still sign in. */
export function cookieHeader(name, value, maxAge, publicUrl) {
  const secure = String(publicUrl).startsWith("https://") ? " Secure;" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`;
}
