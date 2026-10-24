// Sign-in through any OIDC provider, tested against a fake provider: keys are generated here, tokens are signed by
// hand and fetch is a plain function — no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createOidc, verifyIdToken, issuerMatches } from "./oidc.mjs";
import { translate } from "./i18n.mjs";
import { VIETNAMESE } from "./i18n-gate.mjs";
import SERVER_TEXT from "./i18n/server.mjs";

const ISSUER = "https://idp.example.com";
const CLIENT = "studio";
const SECRET = "client-secret";
const REDIRECT = "https://studio.example.com/__auth/callback";
const NOW = 1_800_000_000; // seconds
const NONCE = "nonce-123";

const b64u = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

function keyPair(type, kid, { alg, ...opts } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync(type, opts);
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig" };
  if (alg) jwk.alg = alg;
  return { kid, privateKey, publicKey, jwk };
}
const RSA = keyPair("rsa", "rsa-1", { alg: "RS256", modulusLength: 2048 });
const EC = keyPair("ec", "ec-1", { alg: "ES256", namedCurve: "P-256" });

/** Compact JWS signed with key.privateKey; header gets alg + key.kid unless overridden. */
function sign(alg, key, payload, header = {}) {
  const input = `${b64u({ alg, typ: "JWT", kid: key.kid, ...header })}.${b64u(payload)}`;
  const hash = alg === "EdDSA" ? null : `sha${alg.slice(2)}`;
  const how = alg.startsWith("PS") ? { key: key.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }
    : alg.startsWith("ES") ? { key: key.privateKey, dsaEncoding: "ieee-p1363" } : key.privateKey;
  return `${input}.${crypto.sign(hash, Buffer.from(input), how).toString("base64url")}`;
}

const claims = (over = {}) => ({ iss: ISSUER, aud: CLIENT, sub: "user-1", email: "Owner@Example.com", email_verified: true, nonce: NONCE, iat: NOW - 10, exp: NOW + 3600, ...over });
const opts = (over = {}) => ({ keys: [RSA.jwk, EC.jwk], issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW, ...over });

/** Error code of a check, "ok" when the token is accepted. */
function codeOf(fn) {
  try { fn(); return "ok"; } catch (e) { return e.code ?? `(no code) ${e.message}`; }
}
const check = (token, over) => codeOf(() => verifyIdToken(token, opts(over)));

// ── id_token: signature ─────────────────────────────────────────────────────────────────────────────────────────

test("valid RS256 token: accepted, email comes from the verified claims, lowercased", () => {
  const r = verifyIdToken(sign("RS256", RSA, claims()), opts());
  assert.equal(r.email, "owner@example.com");
  assert.equal(r.claims.sub, "user-1");
});

test("valid ES256 token accepted", () => {
  assert.equal(verifyIdToken(sign("ES256", EC, claims()), opts()).email, "owner@example.com");
});

test("PS256 (RSA key) and EdDSA (Ed25519 key) accepted when the key allows that algorithm", () => {
  const { alg, ...anyRsa } = RSA.jwk;
  const rsaAny = { ...RSA, kid: "rsa-any", jwk: { ...anyRsa, kid: "rsa-any" } };
  const ed = keyPair("ed25519", "ed-1");
  assert.equal(check(sign("PS256", rsaAny, claims()), { keys: [rsaAny.jwk] }), "ok");
  assert.equal(check(sign("RS512", rsaAny, claims()), { keys: [rsaAny.jwk] }), "ok");
  assert.equal(check(sign("EdDSA", ed, claims()), { keys: [ed.jwk] }), "ok");
  const ec384 = keyPair("ec", "ec-384", { namedCurve: "P-384" });
  assert.equal(check(sign("ES384", ec384, claims()), { keys: [ec384.jwk] }), "ok");
});

test("tampered payload, tampered signature, or a different key under the same kid → signature", () => {
  const [h, , s] = sign("RS256", RSA, claims()).split(".");
  assert.equal(check(`${h}.${b64u(claims({ email: "attacker@example.com" }))}.${s}`), "signature");
  const good = sign("RS256", RSA, claims());
  const flipped = good.slice(0, -4) + (good.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal(check(flipped), "signature");
  const other = keyPair("rsa", "rsa-1", { modulusLength: 2048 });
  assert.equal(check(sign("RS256", other, claims())), "signature");
  const [eh, , es] = sign("ES256", EC, claims()).split(".");
  assert.equal(check(`${eh}.${b64u(claims({ sub: "x" }))}.${es}`), "signature");
});

test('alg "none" (any spelling, with or without a signature) → alg', () => {
  for (const alg of ["none", "None", "NONE"]) {
    const input = `${b64u({ alg, typ: "JWT" })}.${b64u(claims())}`;
    assert.equal(check(`${input}.`), "alg", alg);
    assert.equal(check(`${input}.${b64u("x")}`), "alg", alg);
    assert.equal(check(`${b64u({ alg, kid: RSA.kid })}.${b64u(claims())}.`), "alg", alg);
  }
});

test("HS256/384/512 signed with the provider's PUBLIC key bytes (algorithm confusion) → alg", () => {
  const secrets = [RSA.publicKey.export({ type: "spki", format: "pem" }), RSA.publicKey.export({ type: "spki", format: "der" }), RSA.publicKey.export({ type: "pkcs1", format: "pem" }), JSON.stringify(RSA.jwk)];
  for (const [alg, hash] of [["HS256", "sha256"], ["HS384", "sha384"], ["HS512", "sha512"]]) {
    for (const secret of secrets) {
      const input = `${b64u({ alg, typ: "JWT", kid: RSA.kid })}.${b64u(claims())}`;
      assert.equal(check(`${input}.${crypto.createHmac(hash, secret).update(input).digest("base64url")}`), "alg", alg);
    }
  }
});

test("unknown or odd algorithms and critical header extensions → alg", () => {
  assert.equal(check(sign("RS256", RSA, claims(), { alg: "RS1" })), "alg");
  assert.equal(check(sign("RS256", RSA, claims(), { alg: "__proto__" })), "alg");
  assert.equal(check(sign("RS256", RSA, claims(), { alg: undefined })), "alg");
  assert.equal(check(sign("RS256", RSA, claims(), { crit: ["exp"], exp: 1 })), "alg");
});

test("algorithm must match the key type: ES256 on an RSA key, RS256 on an EC key, PS256 on a key marked RS256 → key", () => {
  assert.equal(check(sign("ES256", { ...EC, kid: RSA.kid }, claims())), "key");
  assert.equal(check(sign("RS256", { ...RSA, kid: EC.kid }, claims())), "key");
  assert.equal(check(sign("PS256", RSA, claims())), "key"); // RSA.jwk says alg RS256
  const ec384 = keyPair("ec", "ec-384", { namedCurve: "P-384" });
  assert.equal(check(sign("ES256", { ...EC, kid: "ec-384" }, claims()), { keys: [ec384.jwk] }), "key"); // curve ≠ P-256
  const enc = { ...RSA.jwk, use: "enc" };
  assert.equal(check(sign("RS256", RSA, claims()), { keys: [enc] }), "key");
});

test("RSA key shorter than 2048 bits → key", () => {
  const weak = keyPair("rsa", "weak", { modulusLength: 1024 });
  assert.equal(check(sign("RS256", weak, claims()), { keys: [weak.jwk] }), "key");
});

test("key comes only from the provider's set: unknown kid → unknown_key, even with an embedded jwk / jku header", () => {
  const attacker = keyPair("rsa", "attacker", { modulusLength: 2048 });
  assert.equal(check(sign("RS256", attacker, claims())), "unknown_key");
  assert.equal(check(sign("RS256", attacker, claims(), { jwk: attacker.jwk, jku: "https://evil.example/jwks" })), "unknown_key");
  assert.equal(check(sign("RS256", attacker, claims(), { kid: RSA.kid, jwk: attacker.jwk })), "signature");
});

test("token without kid: the single key that fits is used; several candidates → key", () => {
  const noKid = (alg, key) => sign(alg, key, claims(), { kid: undefined });
  assert.equal(check(noKid("RS256", RSA)), "ok"); // only RSA.jwk fits RS256
  assert.equal(check(noKid("RS256", RSA), { keys: [RSA.jwk, { ...RSA.jwk, kid: "rsa-copy" }] }), "key");
  assert.equal(check(noKid("RS256", RSA), { keys: [EC.jwk] }), "unknown_key");
  const { alg: _r, ...rsaNoAlg } = RSA.jwk;
  const { alg: _e, ...ecNoAlg } = EC.jwk;
  assert.equal(check(noKid("RS256", RSA), { keys: [ecNoAlg, rsaNoAlg] }), "ok", "key type picks the RSA key");
  assert.equal(check(noKid("ES256", EC), { keys: [rsaNoAlg, ecNoAlg] }), "ok", "key type picks the EC key");
});

test("malformed tokens → malformed", () => {
  const good = sign("RS256", RSA, claims());
  const [h, p, s] = good.split(".");
  for (const t of ["", "abc", `${h}.${p}`, `${good}.x`, `${h}.${p}.${s}.x.y`, `${b64u("[1]")}.${p}.${s}`, `${b64u("{not json")}.${p}.${s}`, `${h}.${b64u("[]")}.${s}`, `${h}.${b64u("42")}.${s}`, `${h}.${p}.`, `${h}.${p}.a+b/`, `${h}.${p}.${s}=`]) {
    assert.equal(check(t), "malformed", t.slice(0, 40));
  }
  assert.equal(codeOf(() => verifyIdToken(undefined, opts())), "malformed");
});

// ── id_token: claims ────────────────────────────────────────────────────────────────────────────────────────────

test("expired beyond 60 s of clock skew → exp; inside the skew accepted; exp missing or not a number → exp", () => {
  assert.equal(check(sign("RS256", RSA, claims({ exp: NOW - 61 }))), "exp");
  assert.equal(check(sign("RS256", RSA, claims({ exp: NOW - 60 }))), "exp");
  assert.equal(check(sign("RS256", RSA, claims({ exp: NOW - 59 }))), "ok");
  assert.equal(check(sign("RS256", RSA, claims({ exp: undefined }))), "exp");
  assert.equal(check(sign("RS256", RSA, claims({ exp: String(NOW + 3600) }))), "exp");
});

test("iat more than 60 s in the future → iat; inside the skew accepted; iat missing → iat", () => {
  assert.equal(check(sign("RS256", RSA, claims({ iat: NOW + 61 }))), "iat");
  assert.equal(check(sign("RS256", RSA, claims({ iat: NOW + 59 }))), "ok");
  assert.equal(check(sign("RS256", RSA, claims({ iat: undefined }))), "iat");
  assert.equal(check(sign("RS256", RSA, claims({ iat: "now" }))), "iat");
});

test("nbf later than now + 60 s → nbf", () => {
  assert.equal(check(sign("RS256", RSA, claims({ nbf: NOW + 120 }))), "nbf");
  assert.equal(check(sign("RS256", RSA, claims({ nbf: NOW - 5 }))), "ok");
});

test("wrong iss → iss (exact match with the discovered issuer, a trailing slash is a different issuer)", () => {
  assert.equal(check(sign("RS256", RSA, claims({ iss: "https://evil.example.com" }))), "iss");
  assert.equal(check(sign("RS256", RSA, claims({ iss: `${ISSUER}/` }))), "iss");
  assert.equal(check(sign("RS256", RSA, claims({ iss: undefined }))), "iss");
});

test("wrong aud → aud (string or list)", () => {
  assert.equal(check(sign("RS256", RSA, claims({ aud: "other-app" }))), "aud");
  assert.equal(check(sign("RS256", RSA, claims({ aud: ["other-app"] }))), "aud");
  assert.equal(check(sign("RS256", RSA, claims({ aud: [] }))), "aud");
  assert.equal(check(sign("RS256", RSA, claims({ aud: undefined }))), "aud");
  assert.equal(check(sign("RS256", RSA, claims({ aud: [CLIENT] }))), "ok");
});

test("several audiences: azp must be our client id; azp present must always be our client id → azp", () => {
  assert.equal(check(sign("RS256", RSA, claims({ aud: [CLIENT, "other-app"] }))), "azp");
  assert.equal(check(sign("RS256", RSA, claims({ aud: [CLIENT, "other-app"], azp: "other-app" }))), "azp");
  assert.equal(check(sign("RS256", RSA, claims({ aud: [CLIENT, "other-app"], azp: CLIENT }))), "ok");
  assert.equal(check(sign("RS256", RSA, claims({ azp: "other-app" }))), "azp");
});

test("nonce missing or different, or no nonce expected → nonce", () => {
  assert.equal(check(sign("RS256", RSA, claims({ nonce: undefined }))), "nonce");
  assert.equal(check(sign("RS256", RSA, claims({ nonce: "other" }))), "nonce");
  assert.equal(check(sign("RS256", RSA, claims({ nonce: undefined })), { nonce: undefined }), "nonce");
  assert.equal(check(sign("RS256", RSA, claims({ nonce: "" })), { nonce: "" }), "nonce");
});

test("email required; email_verified false → email_verified; email_verified absent is fine", () => {
  assert.equal(check(sign("RS256", RSA, claims({ email: undefined }))), "email");
  assert.equal(check(sign("RS256", RSA, claims({ email: "" }))), "email");
  assert.equal(check(sign("RS256", RSA, claims({ email: "not an email" }))), "email");
  assert.equal(check(sign("RS256", RSA, claims({ email: ["a@b.c"] }))), "email");
  assert.equal(check(sign("RS256", RSA, claims({ email_verified: false }))), "email_verified");
  assert.equal(check(sign("RS256", RSA, claims({ email_verified: "false" }))), "email_verified");
  assert.equal(check(sign("RS256", RSA, claims({ email_verified: undefined }))), "ok");
});

// ── discovery, authorization request, code exchange ─────────────────────────────────────────────────────────────

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Fake provider: discovery + JWKS + token endpoint; records every call. */
function fakeIdp({ discovery = {}, keys = [RSA.jwk, EC.jwk], issuer = ISSUER } = {}) {
  const idp = {
    calls: [],
    discovery: { issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, end_session_endpoint: `${issuer}/session/end`, ...discovery },
    jwks: { keys },
    token: () => json({ error: "invalid_grant" }, 400),
    fail: new Set(), // paths that answer with a network error
    count: (suffix) => idp.calls.filter((c) => c.url.endsWith(suffix)).length,
    fetchImpl: async (url, init = {}) => {
      const u = String(url);
      idp.calls.push({ url: u, init });
      const p = new URL(u).pathname;
      if (idp.fail.has(p)) throw new TypeError("fetch failed");
      if (p === "/.well-known/openid-configuration") return json(idp.discovery);
      if (p === "/jwks") return json(idp.jwks);
      if (p === "/token") return idp.token(init);
      return json({ error: "not_found" }, 404);
    },
  };
  return idp;
}
const makeOidc = (idp, over = {}) => createOidc({ issuer: ISSUER, clientId: CLIENT, clientSecret: SECRET, redirectUri: REDIRECT, fetchImpl: idp.fetchImpl, clock: () => NOW * 1000, ...over });
const codeOfAsync = (p) => p.then(() => "ok", (e) => e.code ?? `(no code) ${e.message}`);

test("issuerMatches ignores one trailing slash, nothing else", () => {
  assert.equal(issuerMatches("https://idp.example.com/", "https://idp.example.com"), true);
  assert.equal(issuerMatches("https://idp.example.com", "https://idp.example.com/"), true);
  assert.equal(issuerMatches("https://idp.example.com/realms/a", "https://idp.example.com/realms/a/"), true);
  assert.equal(issuerMatches("https://idp.example.com//", "https://idp.example.com"), false);
  assert.equal(issuerMatches("https://idp.example.com.evil.example", "https://idp.example.com"), false);
  assert.equal(issuerMatches(undefined, "https://idp.example.com"), false);
});

test("discovery: issuer in the document ≠ IDP_ISSUER → refused, no sign-in", async () => {
  const idp = fakeIdp({ discovery: { issuer: "https://evil.example.com" } });
  const oidc = makeOidc(idp);
  assert.equal(await codeOfAsync(oidc.discover()), "issuer_mismatch");
  assert.equal(await codeOfAsync(oidc.authUrl({ state: "s", challenge: "c", nonce: "n" })), "issuer_mismatch");
  assert.equal(await codeOfAsync(oidc.completeLogin({ code: "c", verifier: "v", nonce: NONCE })), "issuer_mismatch");
  assert.equal(idp.count("/token"), 0);
});

test("discovery: read from <issuer>/.well-known/openid-configuration, one trailing slash on IDP_ISSUER ignored", async () => {
  const idp = fakeIdp();
  const d = await makeOidc(idp, { issuer: `${ISSUER}/` }).discover();
  assert.equal(idp.calls[0].url, `${ISSUER}/.well-known/openid-configuration`);
  assert.equal(d.issuer, ISSUER);
  assert.equal(d.tokenEndpoint, `${ISSUER}/token`);
});

test("discovery: cached after success; a failure is not cached and is retried on the next attempt", async () => {
  const idp = fakeIdp();
  idp.fail.add("/.well-known/openid-configuration");
  const oidc = makeOidc(idp);
  assert.equal(await codeOfAsync(oidc.discover()), "discovery");
  idp.fail.clear();
  await oidc.discover();
  await oidc.authUrl({ state: "s", challenge: "c", nonce: "n" });
  await oidc.discover();
  assert.equal(idp.count("/.well-known/openid-configuration"), 2);
});

test("discovery: HTTP error, missing endpoint, or an http endpoint for an https issuer → discovery", async () => {
  const bad = fakeIdp();
  bad.discovery = null;
  bad.fetchImpl = async () => json({ error: "x" }, 500);
  assert.equal(await codeOfAsync(makeOidc(bad).discover()), "discovery");
  assert.equal(await codeOfAsync(makeOidc(fakeIdp({ discovery: { jwks_uri: undefined } })).discover()), "discovery");
  assert.equal(await codeOfAsync(makeOidc(fakeIdp({ discovery: { token_endpoint: "http://idp.example.com/token" } })).discover()), "discovery");
  assert.equal(await codeOfAsync(makeOidc(fakeIdp({ discovery: { authorization_endpoint: "not a url" } })).discover()), "discovery");
});

test("plain-http issuer (local provider) may use http endpoints", async () => {
  const local = "http://localhost:9000";
  const d = await makeOidc(fakeIdp({ issuer: local }), { issuer: local }).discover();
  assert.equal(d.tokenEndpoint, `${local}/token`);
});

test("authUrl: discovered authorization_endpoint + client, PKCE S256, state and nonce; existing query kept", async () => {
  const u = new URL(await makeOidc(fakeIdp({ discovery: { authorization_endpoint: `${ISSUER}/oauth2/authorize?tenant=t1` } })).authUrl({ state: "st", challenge: "ch", nonce: "nn" }));
  assert.equal(`${u.origin}${u.pathname}`, `${ISSUER}/oauth2/authorize`);
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    tenant: "t1", client_id: CLIENT, response_type: "code", scope: "openid email profile", redirect_uri: REDIRECT,
    code_challenge: "ch", code_challenge_method: "S256", state: "st", nonce: "nn",
  });
});

test("completeLogin: code + PKCE verifier sent to the discovered token endpoint (client_secret_post); id_token verified → email", async () => {
  const idp = fakeIdp();
  const idToken = sign("RS256", RSA, claims());
  idp.token = (init) => {
    assert.equal(init.method, "POST");
    assert.match(String(init.headers["Content-Type"] ?? init.headers["content-type"]), /application\/x-www-form-urlencoded/);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init.body))), {
      grant_type: "authorization_code", code: "code-1", redirect_uri: REDIRECT, client_id: CLIENT, client_secret: SECRET, code_verifier: "verifier-1",
    });
    return json({ access_token: "at", token_type: "Bearer", id_token: idToken });
  };
  const r = await makeOidc(idp).completeLogin({ code: "code-1", verifier: "verifier-1", nonce: NONCE });
  assert.equal(r.email, "owner@example.com");
  assert.equal(r.idToken, idToken);
  assert.equal(idp.count("/token"), 1);
  assert.equal(idp.count("/jwks"), 1);
});

test("completeLogin: every id_token check applies (nonce, aud, alg none, expired) — the token endpoint is not trusted blindly", async () => {
  const idp = fakeIdp();
  const oidc = makeOidc(idp);
  const run = async (idToken, flow = { nonce: NONCE }) => { idp.token = () => json({ id_token: idToken }); return codeOfAsync(oidc.completeLogin({ code: "c", verifier: "v", nonce: flow.nonce })); };
  assert.equal(await run(sign("RS256", RSA, claims()), { nonce: "another-nonce" }), "nonce");
  assert.equal(await run(sign("RS256", RSA, claims()), {}), "nonce"); // flow cookie from before nonces existed
  assert.equal(await run(sign("RS256", RSA, claims({ aud: "other-app" }))), "aud");
  assert.equal(await run(`${b64u({ alg: "none" })}.${b64u(claims())}.`), "alg");
  assert.equal(await run(sign("RS256", RSA, claims({ exp: NOW - 3600 }))), "exp");
  assert.equal(await run(sign("RS256", RSA, claims())), "ok");
});

test("completeLogin: provider error or no id_token → token_endpoint / no_id_token, with the provider's reason", async () => {
  const idp = fakeIdp();
  const oidc = makeOidc(idp);
  idp.token = () => json({ error: "invalid_grant", error_description: "grant request is invalid" }, 400);
  await assert.rejects(oidc.completeLogin({ code: "c", verifier: "v", nonce: NONCE }), (e) => e.code === "token_endpoint" && /invalid_grant/.test(e.message));
  idp.token = () => new Response("<html>bad gateway</html>", { status: 502 });
  assert.equal(await codeOfAsync(oidc.completeLogin({ code: "c", verifier: "v", nonce: NONCE })), "token_endpoint");
  idp.token = () => json({ access_token: "at", token_type: "Bearer" });
  assert.equal(await codeOfAsync(oidc.completeLogin({ code: "c", verifier: "v", nonce: NONCE })), "no_id_token");
});

test("key rotation: unknown kid → JWKS fetched again, at most once a minute", async () => {
  const idp = fakeIdp({ keys: [RSA.jwk] });
  let t = NOW * 1000;
  const oidc = makeOidc(idp, { clock: () => t });
  const login = (key) => { idp.token = () => json({ id_token: sign("RS256", key, claims()) }); return codeOfAsync(oidc.completeLogin({ code: "c", verifier: "v", nonce: NONCE })); };

  assert.equal(await login(RSA), "ok");
  assert.equal(idp.count("/jwks"), 1);
  assert.equal(await login(RSA), "ok");
  assert.equal(idp.count("/jwks"), 1, "known kid → cached keys");

  const next = keyPair("rsa", "rsa-2", { alg: "RS256", modulusLength: 2048 });
  idp.jwks = { keys: [next.jwk] }; // the provider rotates its key
  t += 61_000;
  assert.equal(await login(next), "ok");
  assert.equal(idp.count("/jwks"), 2, "unknown kid → one refetch");

  const stray = keyPair("rsa", "rsa-3", { alg: "RS256", modulusLength: 2048 });
  t += 10_000;
  assert.equal(await login(stray), "unknown_key");
  assert.equal(await login(stray), "unknown_key");
  assert.equal(idp.count("/jwks"), 2, "less than a minute since the last fetch → no refetch");
  t += 60_000;
  assert.equal(await login(stray), "unknown_key");
  assert.equal(idp.count("/jwks"), 3, "a minute later → one more refetch");
});

test("JWKS unreachable → jwks; retried on the next login", async () => {
  const idp = fakeIdp();
  const oidc = makeOidc(idp);
  idp.token = () => json({ id_token: sign("RS256", RSA, claims()) });
  idp.fail.add("/jwks");
  assert.equal(await codeOfAsync(oidc.completeLogin({ code: "c", verifier: "v", nonce: NONCE })), "jwks");
  idp.fail.clear();
  assert.equal(await codeOfAsync(oidc.completeLogin({ code: "c", verifier: "v", nonce: NONCE })), "ok");
});

// ── Texts: the sign-in error page words an OidcError in the viewer's language (lib/i18n/server.mjs) ──────────────

/** The error a call throws (sync or async), or null. */
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const errOfAsync = (p) => p.then(() => null, (e) => e);

test("OidcError: a text key + params from lib/i18n/server.mjs; its message is the English text (logs)", async () => {
  const nonce = errOf(() => verifyIdToken(sign("RS256", RSA, claims({ nonce: "other" })), opts()));
  assert.equal(nonce.code, "nonce");
  assert.equal(nonce.key, "oidcNonce");
  assert.equal(nonce.message, "id_token does not match this sign-in (nonce)");
  assert.equal(translate(SERVER_TEXT, "vi", nonce.key, nonce.params), "id_token không khớp lượt đăng nhập này (nonce)");

  const unverified = errOf(() => verifyIdToken(sign("RS256", RSA, claims({ email_verified: false })), opts()));
  assert.equal(unverified.code, "email_verified");
  assert.deepEqual(unverified.params, { email: "owner@example.com" });
  assert.equal(unverified.message, "email owner@example.com is not verified at the provider");
  assert.equal(translate(SERVER_TEXT, "vi", unverified.key, unverified.params), "email owner@example.com chưa được xác minh ở nhà cung cấp");

  const idp = fakeIdp();
  idp.token = () => json({ error: "invalid_grant", error_description: "grant request is invalid" }, 400);
  const refused = await errOfAsync(makeOidc(idp).completeLogin({ code: "c", verifier: "v", nonce: NONCE }));
  assert.equal(refused.message, "the provider refused to exchange the code: invalid_grant — grant request is invalid");
  assert.equal(translate(SERVER_TEXT, "vi", refused.key, refused.params), "nhà cung cấp từ chối đổi mã: invalid_grant — grant request is invalid");

  const mismatch = await errOfAsync(makeOidc(fakeIdp({ discovery: { issuer: "https://evil.example.com" } })).discover());
  assert.equal(translate(SERVER_TEXT, "vi", mismatch.key, mismatch.params), `nhà cung cấp tự xưng "https://evil.example.com", khác IDP_ISSUER "${ISSUER}" — từ chối`);
});

test("every OidcError: its key is in both languages, its message is that English text, no Vietnamese in it", async () => {
  const { alg, ...anyRsa } = RSA.jwk;
  const errors = [
    errOf(() => verifyIdToken("x".repeat(20_000), opts())),
    errOf(() => verifyIdToken("a.b", opts())),
    errOf(() => verifyIdToken(`${b64u({ alg: "none" })}.${b64u(claims())}.`, opts())),
    errOf(() => verifyIdToken(sign("RS256", RSA, claims()).slice(0, -2) + "!!", opts())),
    errOf(() => verifyIdToken(sign("RS256", RSA, claims(), { kid: "nope" }), opts())),
    errOf(() => verifyIdToken(sign("RS256", RSA, claims(), { kid: undefined }), opts({ keys: [anyRsa, { ...anyRsa, kid: "b" }] }))),
    errOf(() => verifyIdToken(sign("RS256", RSA, claims({ iss: "https://other" })), opts())),
    errOf(() => verifyIdToken(sign("RS256", RSA, claims({ aud: "other" })), opts())),
    errOf(() => verifyIdToken(sign("RS256", RSA, claims({ exp: NOW - 3600 })), opts())),
    errOf(() => verifyIdToken(sign("RS256", RSA, claims({ iat: NOW + 3600 })), opts())),
    errOf(() => verifyIdToken(sign("RS256", RSA, claims({ email: "nope" })), opts())),
    await errOfAsync(makeOidc(fakeIdp({ discovery: { jwks_uri: undefined } })).discover()),
  ];
  for (const e of errors) {
    assert.ok(e, "every case throws");
    assert.ok(Object.hasOwn(SERVER_TEXT.en, e.key) && Object.hasOwn(SERVER_TEXT.vi, e.key), `${e.code}: key ${e.key} in both languages`);
    assert.equal(e.message, translate(SERVER_TEXT, "en", e.key, e.params), e.code);
    assert.doesNotMatch(e.message, VIETNAMESE, e.code);
  }
});

test("logoutUrl: end_session_endpoint when the provider has one, otherwise null (logout only clears our cookie)", async () => {
  assert.equal(await makeOidc(fakeIdp()).logoutUrl(), `${ISSUER}/session/end`);
  assert.equal(await makeOidc(fakeIdp({ discovery: { end_session_endpoint: undefined } })).logoutUrl(), null);
  const down = fakeIdp();
  down.fail.add("/.well-known/openid-configuration");
  assert.equal(await makeOidc(down).logoutUrl(), null);
});
