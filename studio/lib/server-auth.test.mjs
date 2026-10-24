// The studio server's sign-in wiring, end to end: the real `craft-table start` against a fake OpenID provider built
// from node:http + node:crypto (discovery, JWKS, an authorization endpoint that sends the browser back with a code, a
// token endpoint that checks PKCE and returns a self-signed RS256 id_token carrying the nonce it was given).
//   • studio A: production-style env — IDP_ISSUER, OIDC_CLIENT_ID/SECRET, SESSION_SECRET, ALLOWED_EMAILS and
//     STUDIO_PUBLIC_HOST (no STUDIO_PUBLIC_URL). "Remote" requests carry X-Forwarded-For, as a proxy in front would.
//   • studio B: sign-in not configured → only this machine; requests that other web pages make are refused.
// Ports are OS-assigned; each studio is stopped by its own PID.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { signValue } from "./session.mjs";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const BIN = path.join(REPO, "bin", "craft-table.mjs");
const PUB = "studio.example.test";
const CLIENT_ID = "studio-test";
const CLIENT_SECRET = crypto.randomBytes(16).toString("hex");
const SESSION_SECRET = crypto.randomBytes(32).toString("hex");
const REMOTE = { host: PUB, "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https" };
const OTHER_SITE = { origin: "https://evil.example", "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "empty" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
});

/** One HTTP request to 127.0.0.1:port with exactly these headers (Host defaults to 127.0.0.1:port = this machine). */
function request(port, target, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: target, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

/** Bytes as given (headers http.request would refuse), then whatever comes back until the server closes. */
function raw(port, text, ms = 8000) {
  return new Promise((resolve) => {
    let out = "";
    const s = net.connect(port, "127.0.0.1", () => s.write(text));
    s.on("data", (d) => { out += d; });
    s.on("close", () => resolve(out));
    s.on("error", (e) => resolve(`error ${e.code}`));
    setTimeout(() => { s.destroy(); resolve(out || "timeout"); }, ms);
  });
}

/** WebSocket handshake only → the status (101 = upgraded). */
function wsStatus(port, target, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port, path: target, agent: false, headers: {
      connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": crypto.randomBytes(16).toString("base64"), ...headers,
    } });
    r.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    r.on("response", (res) => { res.resume(); resolve(res.statusCode); });
    r.on("error", (e) => resolve(`error ${e.code ?? e.message}`));
    r.setTimeout(8000, () => { r.destroy(); resolve("timeout"); });
    r.end();
  });
}

/** The Set-Cookie line for one cookie name, with its value. */
function setCookie(res, name) {
  const line = (res.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${name}=`));
  return line ? { line, value: line.slice(name.length + 1).split(";")[0] } : null;
}

// ── Fake OpenID provider ─────────────────────────────────────────────────────────────────────────────────────────
async function fakeProvider() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "test-key";
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };
  const port = await freePort();
  const issuer = `http://127.0.0.1:${port}`;
  const codes = new Map();
  const idp = { issuer, port, nonceOverride: null, tokenRequests: 0 };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sign = (claims) => {
    const h = b64({ alg: "RS256", typ: "JWT", kid }), p = b64(claims);
    return `${h}.${p}.${crypto.sign("sha256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
  };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, issuer);
    const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (u.pathname === "/.well-known/openid-configuration") {
      return json(200, { issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, end_session_endpoint: `${issuer}/session/end` });
    }
    if (u.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (u.pathname === "/auth") {
      // Signs in whoever login_hint names (the test adds it), then back to the client's redirect_uri.
      const q = Object.fromEntries(u.searchParams);
      const code = crypto.randomBytes(12).toString("base64url");
      codes.set(code, { ...q, email: q.login_hint ?? "owner@example.com" });
      res.writeHead(302, { Location: `${q.redirect_uri}?code=${code}&state=${encodeURIComponent(q.state ?? "")}` });
      return res.end();
    }
    if (u.pathname === "/token" && req.method === "POST") {
      idp.tokenRequests++;
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const f = new URLSearchParams(Buffer.concat(chunks).toString());
      const c = codes.get(f.get("code"));
      codes.delete(f.get("code"));
      const pkce = crypto.createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
      if (!c || f.get("client_id") !== CLIENT_ID || f.get("client_secret") !== CLIENT_SECRET || f.get("redirect_uri") !== c.redirect_uri || pkce !== c.code_challenge) {
        return json(400, { error: "invalid_grant" });
      }
      const now = nowSec();
      const nonce = idp.nonceOverride ?? c.nonce;
      return json(200, { access_token: "x", token_type: "Bearer", id_token: sign({ iss: issuer, aud: CLIENT_ID, sub: c.email, email: c.email, email_verified: true, nonce, iat: now, exp: now + 300 }) });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  idp.close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
  return idp;
}

// ── A studio on a throw-away project ─────────────────────────────────────────────────────────────────────────────
function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-auth-"));
  const w = (rel, s) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), s); };
  w("craft-table.json", JSON.stringify({ name: "Sign-in test", language: "en" }));
  w("versions/index.json", JSON.stringify({ live: "main", order: ["main"] }));
  w("versions/main/version.json", JSON.stringify({ id: "main", title: "Main", status: "draft", from: null, createdAt: "2026-10-24T00:00:00.000Z", createdBy: "test", note: "" }));
  w("versions/main/system/tokens.css", "");
  w("versions/main/boards/screens/nometa.tsx", "export default function NoMeta() { return null; }\n"); // a board with no screen info

  for (const d of ["versions/main/boards", "threads", "data"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  return dir;
}

async function startStudio(env) {
  const dir = makeProject();
  const port = await freePort();
  // Only what this test sets: nothing from the caller's environment (a STUDIO_PUBLIC_URL there would change the test).
  const child = spawn(process.execPath, [BIN, "start"], {
    cwd: dir,
    env: { PATH: process.env.PATH, HOME: dir, CRAFT_PROJECT: dir, STUDIO_PORT: String(port), STUDIO_ENV_FILE: path.join(dir, ".env"), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (c) => { log += c; });
  child.stderr.on("data", (c) => { log += c; });
  const exited = new Promise((r) => child.once("exit", () => r()));
  for (const t0 = Date.now(); Date.now() - t0 < 90_000 && child.exitCode === null && !/^sign-in: /m.test(log);) await sleep(100);
  const s = {
    dir, port, child,
    get log() { return log; },
    alive: () => child.exitCode === null && child.signalCode === null,
    async stop() {
      const crashed = !s.alive();
      if (!crashed) {
        child.kill("SIGTERM");
        await Promise.race([exited, sleep(15_000)]);
        if (s.alive()) { child.kill("SIGKILL"); await exited; }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      // A studio that died abruptly leaves Vite's esbuild child writing its dependency bundle into data/ — sweep again.
      if (crashed) { await sleep(3000); fs.rmSync(dir, { recursive: true, force: true }); }
    },
  };
  if (!/^sign-in: /m.test(log)) { await s.stop(); assert.fail(`studio did not start:\n${log.slice(-3000)}`); }
  return s;
}

// ── A: production-style sign-in ──────────────────────────────────────────────────────────────────────────────────
describe("studio with OIDC sign-in (production-style env)", { timeout: 240_000 }, () => {
  let idp, A;
  before(async () => {
    idp = await fakeProvider();
    A = await startStudio({ IDP_ISSUER: idp.issuer, OIDC_CLIENT_ID: CLIENT_ID, OIDC_CLIENT_SECRET: CLIENT_SECRET, SESSION_SECRET, ALLOWED_EMAILS: "Owner@Example.com, second@example.com", STUDIO_PUBLIC_HOST: PUB });
  });
  after(async () => { await A?.stop(); await idp?.close(); });

  /** Remote visitor: page → provider (login_hint = email) → callback. Returns every step. */
  async function signIn(email = "owner@example.com", page = "/screens/x?y=1") {
    const start = await request(A.port, page, { headers: REMOTE });
    const flow = setCookie(start, "ds_flow");
    const auth = new URL(start.headers.location);
    auth.searchParams.set("login_hint", email);
    const atIdp = await request(idp.port, auth.pathname + auth.search, { headers: { host: `127.0.0.1:${idp.port}` } });
    const back = new URL(atIdp.headers.location);
    const done = await request(A.port, back.pathname + back.search, { headers: { ...REMOTE, cookie: `ds_flow=${flow.value}` } });
    return { start, flow, auth, back, done, session: setCookie(done, "ds_sess") };
  }

  test("start-up: the log states the mode; STUDIO_PUBLIC_HOST alone gives an https public URL", () => {
    assert.match(A.log, new RegExp(`^sign-in: OIDC ${idp.issuer}$`, "m"));
    assert.match(A.log, new RegExp(`public=https://${PUB}\\s*$`, "m"));
  });

  test("remote without a session: API → 401, page → provider with redirect_uri, PKCE S256, state and a nonce kept in a Secure signed flow cookie", async () => {
    const me = await request(A.port, "/__api/me", { headers: REMOTE });
    assert.equal(me.status, 401);
    const r = await request(A.port, "/screens/x?y=1", { headers: REMOTE });
    assert.equal(r.status, 302);
    const loc = new URL(r.headers.location);
    assert.equal(`${loc.origin}${loc.pathname}`, `${idp.issuer}/auth`, "the discovered authorization_endpoint");
    const q = Object.fromEntries(loc.searchParams);
    assert.equal(q.redirect_uri, `https://${PUB}/__auth/callback`, "redirect URI unchanged for the first project");
    assert.equal(q.client_id, CLIENT_ID);
    assert.equal(q.response_type, "code");
    assert.equal(q.code_challenge_method, "S256");
    assert.ok(q.state && q.nonce && q.nonce !== q.state && q.nonce.length >= 16, JSON.stringify(q));
    const flow = setCookie(r, "ds_flow");
    assert.match(flow.line, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
    const kept = JSON.parse(Buffer.from(decodeURIComponent(flow.value).split(".")[0], "base64url").toString());
    assert.equal(kept.state, q.state);
    assert.equal(kept.n, q.nonce, "the nonce sent is the one kept for the callback");
    assert.equal(crypto.createHash("sha256").update(kept.v).digest("base64url"), q.code_challenge, "PKCE verifier kept");
    assert.equal(kept.rd, "/screens/x?y=1");
    assert.ok(kept.exp > nowSec() + 500 && kept.exp <= nowSec() + 601, `flow expires in 10 minutes (${kept.exp - nowSec()} s)`);
  });

  test("full sign-in: id_token with our nonce → Secure HttpOnly session, flow cookie cleared, back to the page asked for", async () => {
    const s = await signIn();
    assert.equal(`${s.back.origin}${s.back.pathname}`, `https://${PUB}/__auth/callback`);
    assert.equal(s.done.status, 302, s.done.body);
    assert.equal(s.done.headers.location, "/screens/x?y=1");
    assert.match(s.session.line, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200$/);
    assert.match(setCookie(s.done, "ds_flow").line, /^ds_flow=; .*Max-Age=0$/);
    const me = await request(A.port, "/__api/me", { headers: { ...REMOTE, cookie: `ds_sess=${s.session.value}` } });
    assert.equal(me.status, 200);
    assert.deepEqual(JSON.parse(me.body), { email: "owner@example.com" });
  });

  test("callback: wrong state → 400, flow cookie cleared, no token exchange", async () => {
    const start = await request(A.port, "/", { headers: REMOTE });
    const flow = setCookie(start, "ds_flow");
    const before = idp.tokenRequests;
    const r = await request(A.port, "/__auth/callback?code=anything&state=wrong", { headers: { ...REMOTE, cookie: `ds_flow=${flow.value}` } });
    assert.equal(r.status, 400);
    assert.match(setCookie(r, "ds_flow").line, /Max-Age=0/);
    assert.equal(setCookie(r, "ds_sess"), null);
    assert.equal(idp.tokenRequests, before);
  });

  test("callback: expired flow (signed, right state) → 400, no token exchange", async () => {
    const old = signValue({ v: "verifier", state: "s1", n: "n1", rd: "/", exp: nowSec() - 1 }, SESSION_SECRET);
    const before = idp.tokenRequests;
    const r = await request(A.port, "/__auth/callback?code=c&state=s1", { headers: { ...REMOTE, cookie: `ds_flow=${encodeURIComponent(old)}` } });
    assert.equal(r.status, 400);
    assert.equal(idp.tokenRequests, before);
  });

  test("callback: id_token carrying another nonce → 502, no session", async () => {
    idp.nonceOverride = "not-the-nonce-we-sent";
    try {
      const s = await signIn();
      assert.equal(s.done.status, 502);
      assert.match(s.done.body, /nonce/);
      assert.equal(s.session, null);
    } finally {
      idp.nonceOverride = null;
    }
  });

  test("callback: verified email outside ALLOWED_EMAILS → 403, no session", async () => {
    const s = await signIn("intruder@example.com");
    assert.equal(s.done.status, 403);
    assert.equal(s.done.body, "The account intruder@example.com has no access to this studio.");
    assert.equal(s.session, null);
  });

  test("texts a visitor reads follow their language: the ct_lang cookie, else the project's (en here)", async () => {
    const me = await request(A.port, "/__api/me", { headers: REMOTE });
    assert.deepEqual(JSON.parse(me.body), { error: "Not signed in", code: "apiNotSignedIn" });
    const meVi = await request(A.port, "/__api/me", { headers: { ...REMOTE, cookie: "ct_lang=vi" } });
    assert.deepEqual(JSON.parse(meVi.body), { error: "chưa đăng nhập", code: "apiNotSignedIn" });
    const bad = await request(A.port, "/__auth/callback?code=c&state=s", { headers: REMOTE });
    assert.equal(bad.status, 400);
    assert.equal(bad.body, "The sign-in session is invalid or has expired. <a href='/'>Try again</a>");
    const badVi = await request(A.port, "/__auth/callback?code=c&state=s", { headers: { ...REMOTE, cookie: "ct_lang=vi" } });
    assert.equal(badVi.body, "Phiên đăng nhập không hợp lệ hoặc đã quá hạn. <a href='/'>Thử lại</a>");
    const refused = await request(A.port, "/__auth/callback?error=access_denied&error_description=no", { headers: { ...REMOTE, cookie: "ct_lang=vi" } });
    assert.equal(refused.body, "Nhà cung cấp không cho đăng nhập: access_denied — no. <a href='/'>Thử lại</a>");
  });

  test("logout is answered before the identity check: clears the Secure session cookie, then the provider's end_session_endpoint", async () => {
    const r = await request(A.port, "/__auth/logout", { headers: REMOTE });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, `${idp.issuer}/session/end`);
    assert.match(setCookie(r, "ds_sess").line, /^ds_sess=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/);
  });

  test("websockets (Vite HMR, collab): remote without session → 401; with session → 101; this machine → 101", async () => {
    const { session } = await signIn();
    const withSession = { ...REMOTE, cookie: `ds_sess=${session.value}` };
    const HMR = { "sec-websocket-protocol": "vite-hmr" };
    assert.equal(await wsStatus(A.port, "/", { ...REMOTE, ...HMR }), 401);
    assert.equal(await wsStatus(A.port, "/", { ...withSession, ...HMR }), 101);
    assert.equal(await wsStatus(A.port, "/", HMR), 101);
    assert.equal(await wsStatus(A.port, "/__collab", REMOTE), 401);
    assert.equal(await wsStatus(A.port, "/__collab", withSession), 101);
    assert.equal(await wsStatus(A.port, "/__collab"), 101);
  });

  test("a signed-in browser's session does not ride on requests other web pages make (CSRF, websocket hijacking)", async () => {
    const { session } = await signIn();
    const withSession = { ...REMOTE, cookie: `ds_sess=${session.value}` };
    const forged = await request(A.port, "/__api/versions", { method: "POST", headers: { ...withSession, ...OTHER_SITE, "content-type": "text/plain" }, body: JSON.stringify({ from: "main", title: "planted" }) });
    assert.equal(forged.status, 401);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(A.dir, "versions/index.json"), "utf8")).order, ["main"]);
    const sameSite = await request(A.port, "/__api/me", { headers: { ...withSession, origin: "https://blog.example.test", "sec-fetch-site": "same-site", "sec-fetch-mode": "cors" } });
    assert.equal(sameSite.status, 401);
    assert.equal(await wsStatus(A.port, "/__collab", { ...withSession, origin: "https://evil.example", "sec-fetch-site": "cross-site", "sec-fetch-mode": "websocket" }), 401);
    // The studio's own page (same origin) and a link opened from another site still work.
    const own = await request(A.port, "/__api/me", { headers: { ...withSession, origin: `https://${PUB}`, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" } });
    assert.equal(own.status, 200);
    const link = await request(A.port, "/__api/me", { headers: { ...withSession, "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
    assert.equal(link.status, 200);
  });

  test("a malformed cookie (x=%E0) on a websocket upgrade or a request does not take the studio down", async () => {
    const { session } = await signIn();
    const up = await raw(A.port, `GET / HTTP/1.1\r\nHost: ${PUB}\r\nX-Forwarded-For: 203.0.113.9\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nCookie: x=%E0\r\n\r\n`);
    assert.match(up, /^HTTP\/1\.1 401 /, `${JSON.stringify(up.slice(0, 40))}\n${A.log.slice(-800)}`);
    const collabUp = await raw(A.port, `GET /__collab HTTP/1.1\r\nHost: ${PUB}\r\nX-Forwarded-For: 203.0.113.9\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nCookie: x=%E0\r\n\r\n`);
    assert.match(collabUp, /^HTTP\/1\.1 401 /);
    await sleep(300);
    assert.ok(A.alive(), `studio exited:\n${A.log.slice(-1500)}`);
    // A sibling app's broken cookie next to a valid session: the session still counts, nothing turns into a 500.
    const me = await request(A.port, "/__api/me", { headers: { ...REMOTE, cookie: `x=%E0; ds_sess=${session.value}; y=%` } });
    assert.equal(me.status, 200, me.body);
    assert.deepEqual(JSON.parse(me.body), { email: "owner@example.com" });
    const page = await request(A.port, "/", { headers: { ...REMOTE, cookie: "x=%E0" } });
    assert.equal(page.status, 302);
    assert.ok(A.alive());
  });

  test("a Host header that is not a valid host → 400, the studio stays up", async () => {
    for (const host of ["a b", "[", "x:99999"]) {
      const r = await raw(A.port, `GET /__api/me HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      assert.match(r, /^HTTP\/1\.1 400 /, `Host ${JSON.stringify(host)} → ${JSON.stringify(r.slice(0, 40))}\n${A.log.slice(-800)}`);
    }
    await sleep(300);
    assert.ok(A.alive(), `studio exited:\n${A.log.slice(-1500)}`);
    assert.equal((await request(A.port, "/__api/me")).status, 200);
  });
});

// ── B: no sign-in configured → only this machine ─────────────────────────────────────────────────────────────────
describe("studio without sign-in (only this machine)", { timeout: 240_000 }, () => {
  let B;
  before(async () => { B = await startStudio({}); });
  after(async () => { await B?.stop(); });
  const index = () => JSON.parse(fs.readFileSync(path.join(B.dir, "versions/index.json"), "utf8"));

  test("start-up: the log states local mode", () => {
    assert.match(B.log, new RegExp(`^sign-in: none — only this machine \\(http://localhost:${B.port}\\)$`, "m"));
  });

  test("a web page open in this machine's browser cannot act as this machine (cross-site text/plain POST)", async () => {
    const host = { host: `localhost:${B.port}` };
    const forged = await request(B.port, "/__api/versions", { method: "POST", headers: { ...host, ...OTHER_SITE, "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ from: "main", title: "planted by evil.example" }) });
    assert.equal(forged.status, 503);
    assert.deepEqual(index().order, ["main"], "nothing written");
    // Same without Fetch Metadata (older browsers): an Origin that is not this studio is enough.
    const old = await request(B.port, "/__api/versions", { method: "POST", headers: { ...host, origin: "http://localhost:3000", "content-type": "text/plain" }, body: JSON.stringify({ from: "main", title: "planted" }) });
    assert.equal(old.status, 503);
    const opaque = await request(B.port, "/__api/versions", { method: "POST", headers: { ...host, origin: "null", "content-type": "text/plain" }, body: JSON.stringify({ from: "main", title: "planted" }) });
    assert.equal(opaque.status, 503);
    assert.deepEqual(index().order, ["main"], "nothing written");
  });

  test("the studio's own page and local tools still act as this machine", async () => {
    const n = index().order.length;
    const own = await request(B.port, "/__api/versions", {
      method: "POST",
      headers: { host: `localhost:${B.port}`, origin: `http://localhost:${B.port}`, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "content-type": "application/json" },
      body: JSON.stringify({ from: "main", title: "From the studio" }),
    });
    assert.equal(own.status, 201, own.body);
    assert.equal(index().order.length, n + 1);
    const tool = await request(B.port, "/__api/me"); // chat.mjs, the healthcheck: no Origin, no Fetch Metadata
    assert.deepEqual(JSON.parse(tool.body), { email: "claude@local" });
    const link = await request(B.port, "/__api/me", { headers: { host: `localhost:${B.port}`, "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
    assert.equal(link.status, 200, "a link to the studio from another site still opens it");
  });

  test("texts a viewer reads follow their language (ct_lang cookie, else the project's): pages, API errors, a board with no screen info", async () => {
    const host = { host: `localhost:${B.port}` };
    const vi = { cookie: "ct_lang=vi" };
    const off = await request(B.port, "/", { headers: { ...host, ...OTHER_SITE } });
    assert.equal(off.status, 503);
    assert.equal(off.body, `Sign-in is not set up for this studio — it opens only on the machine that runs it (http://localhost:${B.port}).`);
    const offVi = await request(B.port, "/", { headers: { ...host, ...OTHER_SITE, ...vi } });
    assert.equal(offVi.body, `Xưởng chưa cấu hình đăng nhập — chỉ mở được từ chính máy chạy xưởng (http://localhost:${B.port}).`);

    assert.equal((await request(B.port, "/__auth/logout")).body, "Signed out of the studio. <a href='/'>Sign in again</a>");
    assert.equal((await request(B.port, "/__auth/logout", { headers: vi })).body, "Đã đăng xuất khỏi xưởng. <a href='/'>Đăng nhập lại</a>");

    const none = await request(B.port, "/__api/versions/nope");
    assert.equal(none.status, 404);
    assert.deepEqual(JSON.parse(none.body), { error: "No such version", code: "apiNoSuchVersion" });
    assert.deepEqual(JSON.parse((await request(B.port, "/__api/versions/nope", { headers: vi })).body), { error: "không có phiên bản này", code: "apiNoSuchVersion" });

    const json = { "content-type": "application/json" };
    const broken = await request(B.port, "/__api/versions", { method: "POST", headers: json, body: "{" });
    assert.equal(broken.status, 400);
    assert.deepEqual(JSON.parse(broken.body), { error: "Invalid JSON", code: "requestBadJson" });
    const brokenVi = await request(B.port, "/__api/versions", { method: "POST", headers: { ...json, ...vi }, body: "{" });
    assert.deepEqual(JSON.parse(brokenVi.body), { error: "JSON hỏng", code: "requestBadJson" });

    const svg = { "content-type": "image/svg+xml" };
    const upload = await request(B.port, "/__api/uploads", { method: "POST", headers: svg, body: "<svg onload=alert(1)>" });
    assert.equal(upload.status, 400);
    assert.deepEqual(JSON.parse(upload.body), { error: "Not a PNG, JPEG, WebP or GIF image", code: "uploadNotImage" });
    const uploadVi = await request(B.port, "/__api/uploads", { method: "POST", headers: { ...svg, ...vi }, body: "<svg onload=alert(1)>" });
    assert.equal(JSON.parse(uploadVi.body).error, "không phải ảnh PNG / JPEG / WebP / GIF");

    const metaOf = async (headers) => JSON.parse((await request(B.port, "/__api/entries", { headers })).body).entries.find((e) => e.id === "screens/nometa")?.meta;
    assert.deepEqual(await metaOf({}), { title: "screens/nometa", section: "Errors", group: "Missing meta" });
    assert.deepEqual(await metaOf(vi), { title: "screens/nometa", section: "Lỗi", group: "Thiếu meta" });
  });

  test("websockets from another site → 401 (no hijacking of collab or HMR); from the studio's page → 101", async () => {
    const evil = { host: `localhost:${B.port}`, origin: "https://evil.example", "sec-fetch-site": "cross-site", "sec-fetch-mode": "websocket" };
    assert.equal(await wsStatus(B.port, "/__collab", evil), 401);
    assert.equal(await wsStatus(B.port, "/", { ...evil, "sec-websocket-protocol": "vite-hmr" }), 401);
    const own = { host: `localhost:${B.port}`, origin: `http://localhost:${B.port}`, "sec-fetch-site": "same-origin", "sec-fetch-mode": "websocket" };
    assert.equal(await wsStatus(B.port, "/__collab", own), 101);
  });
});
