import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, readSession, safeRedirect, isLocalRequest, fromOtherSite, parseCookies, publicUrlFrom, cookieHeader } from "./session.mjs";

const SECRET = "s3cret-for-test";

test("a signed session reads back as the email (lower case)", () => {
  const c = signSession("Owner@Example.com", SECRET, 3600, 1000);
  assert.equal(readSession(c, SECRET, 1001, []), "owner@example.com");
});

test("expired session, wrong signature, wrong secret → null", () => {
  const c = signSession("a@b.c", SECRET, 10, 1000);
  assert.equal(readSession(c, SECRET, 1011, []), null);
  assert.equal(readSession(c.slice(0, -2) + "xx", SECRET, 1001, []), null);
  assert.equal(readSession(c, "other", 1001, []), null);
  assert.equal(readSession("", SECRET, 1001, []), null);
  assert.equal(readSession("garbage", SECRET, 1001, []), null);
});

test("with an allowlist, an email not on the list → null", () => {
  const c = signSession("x@y.z", SECRET, 3600, 1000);
  assert.equal(readSession(c, SECRET, 1001, ["owner@example.com"]), null);
});

test("safeRedirect: only internal paths, blocks //host and /\\host", () => {
  assert.equal(safeRedirect("/screens/orders?x=1"), "/screens/orders?x=1");
  assert.equal(safeRedirect("//evil.com"), "/");
  assert.equal(safeRedirect("/\\evil.com"), "/");
  assert.equal(safeRedirect("https://evil.com"), "/");
  assert.equal(safeRedirect(undefined), "/");
});

const HOST = { host: "127.0.0.1:5180" };

test("isLocalRequest: loopback socket + this machine's Host + no forwarding header → this machine", () => {
  assert.equal(isLocalRequest("127.0.0.1", HOST), true);
  assert.equal(isLocalRequest("127.0.0.1", { host: "localhost:5180" }), true);
  assert.equal(isLocalRequest("127.0.0.1", { host: "localhost" }), true);
  assert.equal(isLocalRequest("127.0.0.1", { host: "LocalHost:5180" }), true); // host names are case-insensitive
  assert.equal(isLocalRequest("127.0.0.2", HOST), true); // the whole 127.0.0.0/8 range
  assert.equal(isLocalRequest("127.255.255.254", HOST), true);
});

test("isLocalRequest: a socket that is not loopback → not this machine", () => {
  assert.equal(isLocalRequest("172.17.0.5", HOST), false);
  assert.equal(isLocalRequest("10.0.0.1", { host: "localhost:5180" }), false);
  assert.equal(isLocalRequest("::2", { host: "[::1]:5180" }), false);
  assert.equal(isLocalRequest("::ffff:10.0.0.1", HOST), false);
  assert.equal(isLocalRequest("128.0.0.1", HOST), false);
  assert.equal(isLocalRequest(undefined, HOST), false);
  assert.equal(isLocalRequest("", HOST), false);
});

test("isLocalRequest: IPv6 loopback and IPv4-mapped loopback", () => {
  assert.equal(isLocalRequest("::1", { host: "[::1]:5180" }), true);
  assert.equal(isLocalRequest("::1", { host: "[::1]" }), true);
  assert.equal(isLocalRequest("::1", { host: "localhost:5180" }), true);
  assert.equal(isLocalRequest("::ffff:127.0.0.1", HOST), true);
  assert.equal(isLocalRequest("::ffff:127.1.2.3", HOST), true);
  assert.equal(isLocalRequest("::FFFF:127.0.0.1", HOST), true);
});

test("isLocalRequest: ANY forwarding header → came through a proxy → not this machine (even an empty value)", () => {
  for (const h of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip"]) {
    assert.equal(isLocalRequest("127.0.0.1", { ...HOST, [h]: "1.2.3.4" }), false, h);
    assert.equal(isLocalRequest("::1", { host: "[::1]:5180", [h]: "" }), false, `${h} empty`);
  }
  assert.equal(isLocalRequest("127.0.0.1", { ...HOST, forwarded: "for=1.2.3.4;proto=https" }), false);
});

test("isLocalRequest: Host must be localhost, 127.0.0.1 or [::1] (a proxy on the same machine keeps the public Host)", () => {
  assert.equal(isLocalRequest("127.0.0.1", {}), false); // no Host
  assert.equal(isLocalRequest("127.0.0.1", { host: "" }), false);
  assert.equal(isLocalRequest("127.0.0.1", { host: "studio.example.com" }), false);
  assert.equal(isLocalRequest("127.0.0.1", { host: "studio.example.com:443" }), false);
  assert.equal(isLocalRequest("127.0.0.1", { host: "0.0.0.0:5180" }), false);
  assert.equal(isLocalRequest("127.0.0.1", { host: "127.0.0.2:5180" }), false);
  assert.equal(isLocalRequest("127.0.0.1", { host: "localhost.:5180" }), false);
  assert.equal(isLocalRequest("127.0.0.1", { host: "localhost.example.com" }), false);
  assert.equal(isLocalRequest("127.0.0.1", { host: "localhost@evil.example" }), false);
  assert.equal(isLocalRequest("127.0.0.1", { host: "localhost:5180:1" }), false);
  assert.equal(isLocalRequest("127.0.0.1", { host: "::1" }), false); // IPv6 in Host needs square brackets
});

// ── Requests sent by another website (CSRF, websocket hijacking) ─────────────────────────────────────────────────────
const LH = { host: "localhost:5180" };

test("fromOtherSite: tools on the machine (no Origin, no Fetch Metadata) and the studio's own pages → no", () => {
  assert.equal(fromOtherSite("GET", LH), false); // chat.mjs, healthcheck, curl
  assert.equal(fromOtherSite("POST", { ...LH, "sec-fetch-mode": "cors" }), false); // Node's fetch
  assert.equal(fromOtherSite("POST", { ...LH, origin: "http://localhost:5180", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" }), false);
  assert.equal(fromOtherSite("GET", { ...LH, "sec-fetch-site": "none", "sec-fetch-mode": "navigate" }), false); // typed address, bookmark
  assert.equal(fromOtherSite("GET", { ...LH, origin: "http://localhost:5180", "sec-fetch-site": "same-origin", "sec-fetch-mode": "websocket" }), false);
});

test("fromOtherSite: Sec-Fetch-Site cross-site / same-site (except opening a page with GET) → yes", () => {
  const evil = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
  assert.equal(fromOtherSite("POST", { ...LH, ...evil, "sec-fetch-mode": "no-cors", "content-type": "text/plain" }), true);
  assert.equal(fromOtherSite("POST", { ...LH, ...evil, "sec-fetch-mode": "navigate" }), true); // a form POST from another site
  assert.equal(fromOtherSite("GET", { ...LH, "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" }), true);
  assert.equal(fromOtherSite("GET", { ...LH, ...evil, "sec-fetch-mode": "websocket" }), true); // websocket hijacking
  assert.equal(fromOtherSite("GET", { ...LH, origin: "http://localhost:3000", "sec-fetch-site": "same-site", "sec-fetch-mode": "cors" }), true); // another dev server on the same machine
  assert.equal(fromOtherSite("GET", { ...LH, "sec-fetch-site": "lạ", "sec-fetch-mode": "cors" }), true); // an odd value → treated as another site
  // Opening the studio from a link on another site still works (GET/HEAD navigation — writes nothing).
  assert.equal(fromOtherSite("GET", { ...LH, "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }), false);
  assert.equal(fromOtherSite("HEAD", { ...LH, "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate" }), false);
});

test("fromOtherSite: old browsers without Fetch Metadata → Origin must be the studio's (Host or public address)", () => {
  assert.equal(fromOtherSite("POST", { ...LH, origin: "https://evil.example" }), true);
  assert.equal(fromOtherSite("POST", { ...LH, origin: "http://localhost:3000" }), true); // another port = another origin
  assert.equal(fromOtherSite("POST", { ...LH, origin: "null" }), true); // file://, iframe sandbox
  assert.equal(fromOtherSite("POST", { ...LH, origin: "không phải url" }), true);
  assert.equal(fromOtherSite("POST", { ...LH, origin: "http://localhost:5180" }), false);
  assert.equal(fromOtherSite("POST", { host: "LocalHost:5180", origin: "http://localhost:5180" }), false); // host names are case-insensitive
  assert.equal(fromOtherSite("POST", { host: "localhost", origin: "http://localhost" }), false); // default port
  assert.equal(fromOtherSite("POST", { host: "studio.example.com", origin: "https://studio.example.com" }), false); // behind a TLS proxy
  // A proxy that changes Host (e.g. 127.0.0.1:5180): Origin = the public address is still the studio's — but only when it is passed in.
  const behind = { host: "127.0.0.1:5180", origin: "https://studio.example.com" };
  assert.equal(fromOtherSite("POST", behind), true);
  assert.equal(fromOtherSite("POST", behind, ["https://studio.example.com"]), false);
  assert.equal(fromOtherSite("POST", behind, ["https://STUDIO.example.com/"]), false);
  assert.equal(fromOtherSite("POST", { host: "127.0.0.1:5180", origin: "https://evil.example" }, ["https://studio.example.com"]), true);
});

test("parseCookies: a broken %-encoded value is skipped (no throw), the other cookies are still read", () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies("x=%E0"), {});
  assert.deepEqual(parseCookies("x=%E0; ds_sess=abc.def; y=%; z=%zz"), { ds_sess: "abc.def" });
  assert.deepEqual(parseCookies(" a = 1 ;b=x%20y; c=k=v=; noeq; =v"), { a: "1", b: "x y", c: "k=v=" });
  assert.deepEqual(parseCookies("a=1; a=2"), { a: "2" }); // as before: the later one wins
  assert.deepEqual(parseCookies("a=1; a=%E0"), { a: "1" }); // a broken one does not override a readable one
});

test("publicUrlFrom: STUDIO_PUBLIC_URL wins, only scheme + host are kept", () => {
  assert.equal(publicUrlFrom({ url: "https://studio.example.com", host: "other.example.com", port: 5180 }), "https://studio.example.com");
  assert.equal(publicUrlFrom({ url: "https://studio.example.com/", port: 5180 }), "https://studio.example.com");
  assert.equal(publicUrlFrom({ url: "https://studio.example.com:8443", port: 5180 }), "https://studio.example.com:8443");
  assert.equal(publicUrlFrom({ url: "http://localhost:5180", port: 5180 }), "http://localhost:5180");
  assert.equal(publicUrlFrom({ url: "  ", host: "studio.example.com", port: 5180 }), "https://studio.example.com"); // empty → as if not set
});

test("publicUrlFrom: a malformed STUDIO_PUBLIC_URL → an error right at startup", () => {
  for (const url of ["studio.example.com", "ftp://studio.example.com", "https://studio.example.com/studio", "https://studio.example.com/?x=1", "https://studio.example.com/#a", "https://u:p@studio.example.com"]) {
    assert.throws(() => publicUrlFrom({ url, port: 5180 }), /STUDIO_PUBLIC_URL/, url);
  }
});

test("publicUrlFrom: STUDIO_PUBLIC_HOST (old) → https, except localhost / 127.0.0.1 / [::1] → http; text kept as is", () => {
  assert.equal(publicUrlFrom({ host: "studio.example.com", port: 5180 }), "https://studio.example.com");
  assert.equal(publicUrlFrom({ host: "studio.example.com:8443", port: 5180 }), "https://studio.example.com:8443");
  assert.equal(publicUrlFrom({ host: "localhost:5180", port: 5180 }), "http://localhost:5180");
  assert.equal(publicUrlFrom({ host: "localhost", port: 5180 }), "http://localhost");
  assert.equal(publicUrlFrom({ host: "127.0.0.1:5180", port: 5180 }), "http://127.0.0.1:5180");
  assert.equal(publicUrlFrom({ host: "[::1]:5180", port: 5180 }), "http://[::1]:5180");
  assert.equal(publicUrlFrom({ host: "LOCALHOST:5180", port: 5180 }), "http://LOCALHOST:5180");
  for (const host of ["studio.example.com/x", "https://studio.example.com", "a b.example.com", "studio.example.com:port"]) {
    assert.throws(() => publicUrlFrom({ host, port: 5180 }), /STUDIO_PUBLIC_HOST/, host);
  }
});

test("publicUrlFrom: nothing set → http://localhost:<port>", () => {
  assert.equal(publicUrlFrom({ port: 5180 }), "http://localhost:5180");
  assert.equal(publicUrlFrom({ url: "", host: "", port: 6000 }), "http://localhost:6000");
});

test("cookieHeader: the Secure flag only when the public address is https (http localhost can still sign in)", () => {
  const s = cookieHeader("ds_sess", "a b", 60, "https://studio.example.com");
  assert.equal(s, "ds_sess=a%20b; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60");
  const h = cookieHeader("ds_sess", "x", 0, "http://localhost:5180");
  assert.equal(h, "ds_sess=x; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  assert.doesNotMatch(cookieHeader("ds_flow", "x", 600, "http://studio.example.com"), /Secure/);
  assert.match(cookieHeader("ds_flow", "x", 600, publicUrlFrom({ host: "studio.example.com", port: 5180 })), /; Secure;/);
});
