// Sign-in through any OpenID Connect provider: discovery, the authorization request, the code-for-token exchange
// and the id_token check — signature against the provider's published keys (JWKS), then iss / aud / azp / exp /
// iat / nbf / nonce / email. node:crypto only, no JOSE dependency. fetch and the clock are injected (tests).
// An error reaches the sign-in error page: it carries a text key + params (lib/i18n/server.mjs, worded there in the
// viewer's language); its message is the English text (server log); `code` names the failed check (code and tests).
import crypto from "node:crypto";
import { translate } from "./i18n.mjs";
import SERVER_TEXT from "./i18n/server.mjs";

const SKEW = 60; // seconds of clock difference tolerated on exp / iat / nbf
const JWKS_REFETCH_MS = 60_000; // unknown kid → fetch the key set again, at most once a minute
const MAX_TOKEN = 16 * 1024;
const B64U = /^[A-Za-z0-9_-]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

export class OidcError extends Error {
  /** code: the check that failed; key + params: its text in lib/i18n/server.mjs; message: that text in English. */
  constructor(code, key, params = {}) {
    super(translate(SERVER_TEXT, "en", key, params));
    this.name = "OidcError";
    this.code = code;
    this.key = key;
    this.params = params;
  }
}
const fail = (code, key, params) => { throw new OidcError(code, key, params); };

// Asymmetric algorithms only: "none" and HS* (a shared secret — or the provider's PUBLIC key misused as one) are
// never accepted. Each algorithm names the key type (and curve) it may be verified with.
const ALGS = new Map([
  ["RS256", { kty: "RSA", hash: "sha256" }], ["RS384", { kty: "RSA", hash: "sha384" }], ["RS512", { kty: "RSA", hash: "sha512" }],
  ["PS256", { kty: "RSA", hash: "sha256", pss: true }], ["PS384", { kty: "RSA", hash: "sha384", pss: true }], ["PS512", { kty: "RSA", hash: "sha512", pss: true }],
  ["ES256", { kty: "EC", crv: ["P-256"], curve: "prime256v1", hash: "sha256", sigLen: 64 }],
  ["ES384", { kty: "EC", crv: ["P-384"], curve: "secp384r1", hash: "sha384", sigLen: 96 }],
  ["ES512", { kty: "EC", crv: ["P-521"], curve: "secp521r1", hash: "sha512", sigLen: 132 }],
  ["EdDSA", { kty: "OKP", crv: ["Ed25519", "Ed448"], hash: null }],
]);

/** Issuer identifiers are equal when they differ at most by one trailing slash. */
export function issuerMatches(a, b) {
  const trim = (s) => s.replace(/\/$/, "");
  return typeof a === "string" && typeof b === "string" && a !== "" && trim(a) === trim(b);
}

function part(s) {
  if (!B64U.test(s)) fail("malformed", "oidcNotBase64url");
  let v;
  try { v = JSON.parse(Buffer.from(s, "base64url").toString("utf8")); } catch { v = null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("malformed", "oidcNotJsonObject");
  return v;
}

/** The key may sign with `alg`: right type and curve, meant for signatures, and not tied to another algorithm. */
function fits(jwk, alg, spec) {
  return jwk.kty === spec.kty && (!spec.crv || spec.crv.includes(jwk.crv))
    && (jwk.use === undefined || jwk.use === "sig")
    && (jwk.key_ops === undefined || (Array.isArray(jwk.key_ops) && jwk.key_ops.includes("verify")))
    && (jwk.alg === undefined || jwk.alg === alg);
}

/** The provider's key for this token — by kid, or the only fitting key when the token has none. Never from the token. */
function selectKey(keys, header, spec) {
  const list = (Array.isArray(keys) ? keys : []).filter((k) => k && typeof k === "object");
  if (header.kid !== undefined) {
    if (typeof header.kid !== "string") fail("malformed", "oidcBadKid");
    const same = list.filter((k) => k.kid === header.kid);
    if (!same.length) fail("unknown_key", "oidcUnknownKid", { kid: header.kid });
    return same.find((k) => fits(k, header.alg, spec)) ?? fail("key", "oidcKeyUnfit", { kid: header.kid, alg: header.alg });
  }
  const fitting = list.filter((k) => fits(k, header.alg, spec));
  if (fitting.length === 1) return fitting[0];
  return fitting.length ? fail("key", "oidcNoKidManyKeys") : fail("unknown_key", "oidcNoKeyForAlg", { alg: header.alg });
}

function publicKey(jwk, spec) {
  const pub = spec.kty === "RSA" ? { kty: "RSA", n: jwk.n, e: jwk.e } : spec.kty === "EC" ? { kty: "EC", crv: jwk.crv, x: jwk.x, y: jwk.y } : { kty: "OKP", crv: jwk.crv, x: jwk.x };
  let key;
  try { key = crypto.createPublicKey({ key: pub, format: "jwk" }); } catch { fail("key", "oidcBrokenKey"); }
  const t = key.asymmetricKeyType, d = key.asymmetricKeyDetails ?? {};
  const ok = spec.kty === "RSA" ? t === "rsa" && d.modulusLength >= 2048
    : spec.kty === "EC" ? t === "ec" && d.namedCurve === spec.curve
      : t === "ed25519" || t === "ed448";
  return ok ? key : fail("key", spec.kty === "RSA" ? "oidcShortRsaKey" : "oidcWrongKeyType");
}

function signatureOk(spec, key, data, sig) {
  try {
    if (spec.kty === "RSA") {
      const padding = spec.pss ? { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST } : { padding: crypto.constants.RSA_PKCS1_PADDING };
      return crypto.verify(spec.hash, data, { key, ...padding }, sig);
    }
    if (spec.kty === "EC") return sig.length === spec.sigLen && crypto.verify(spec.hash, data, { key, dsaEncoding: "ieee-p1363" }, sig);
    return crypto.verify(null, data, key, sig);
  } catch {
    return false;
  }
}

function checkClaims(c, { issuer, clientId, nonce, now }) {
  if (c.iss !== issuer) fail("iss", "oidcWrongIssuer", { iss: String(c.iss) });
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.length || !aud.every((a) => typeof a === "string") || !aud.includes(clientId)) fail("aud", "oidcNotForStudio", { claim: "aud" });
  if ((aud.length > 1 || c.azp !== undefined) && c.azp !== clientId) fail("azp", "oidcNotForStudio", { claim: "azp" });
  if (!Number.isFinite(c.exp) || now >= c.exp + SKEW) fail("exp", "oidcExpired");
  if (!Number.isFinite(c.iat) || c.iat > now + SKEW) fail("iat", "oidcIssuedInFuture");
  if (c.nbf !== undefined && (!Number.isFinite(c.nbf) || c.nbf > now + SKEW)) fail("nbf", "oidcNotYetValid");
  if (typeof nonce !== "string" || !nonce || c.nonce !== nonce) fail("nonce", "oidcNonce");
  const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) fail("email", "oidcNoEmail");
  if (c.email_verified === false || c.email_verified === "false") fail("email_verified", "oidcEmailUnverified", { email });
  return { email, claims: c };
}

/**
 * Verify an id_token (compact JWS) against the provider's keys (JWK list) → { email, claims }; throws OidcError.
 * issuer = the discovered issuer (exact match), nonce = the one sent in this sign-in's authorization request,
 * now in seconds.
 */
export function verifyIdToken(token, { keys, issuer, clientId, nonce, now }) {
  if (typeof token !== "string" || token.length > MAX_TOKEN) fail("malformed", "oidcMalformed");
  const segs = token.split(".");
  if (segs.length !== 3) fail("malformed", "oidcNotJws");
  const header = part(segs[0]);
  const spec = typeof header.alg === "string" ? ALGS.get(header.alg) : undefined;
  if (!spec || header.crit !== undefined) fail("alg", "oidcBadAlg", { alg: String(header.alg) });
  const claims = part(segs[1]);
  if (!B64U.test(segs[2])) fail("malformed", "oidcBadSignaturePart");
  const key = publicKey(selectKey(keys, header, spec), spec);
  if (!signatureOk(spec, key, Buffer.from(`${segs[0]}.${segs[1]}`), Buffer.from(segs[2], "base64url"))) fail("signature", "oidcBadSignature");
  return checkClaims(claims, { issuer, clientId, nonce, now });
}

function discoveryDoc(doc, issuer) {
  if (!doc || typeof doc !== "object") fail("discovery", "oidcBadDiscovery");
  if (!issuerMatches(doc.issuer, issuer)) fail("issuer_mismatch", "oidcIssuerMismatch", { claimed: String(doc.issuer), issuer });
  const httpsOnly = doc.issuer.startsWith("https://");
  const endpoint = (name, required) => {
    const v = doc[name];
    if (v == null) return required ? fail("discovery", "oidcDiscoveryMissing", { name }) : null;
    let u = null;
    try { u = new URL(v); } catch { /* checked below */ }
    if (!u || !(u.protocol === "https:" || (!httpsOnly && u.protocol === "http:"))) fail("discovery", "oidcDiscoveryInvalid", { name });
    return String(v);
  };
  return {
    issuer: doc.issuer,
    authorizationEndpoint: endpoint("authorization_endpoint", true),
    tokenEndpoint: endpoint("token_endpoint", true),
    jwksUri: endpoint("jwks_uri", true),
    endSessionEndpoint: endpoint("end_session_endpoint", false),
  };
}

async function getJson(fetchImpl, url, code, timeoutMs) {
  let r;
  try { r = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { fail(code, "oidcUnreachable", { url, why: String(e?.message ?? e) }); }
  if (!r.ok) fail(code, "oidcHttpStatus", { url, status: r.status });
  try { return await r.json(); } catch { return fail(code, "oidcNotJson", { url }); }
}

/**
 * One provider + one client. discover() is cached once it succeeds; a failure is retried on the next call.
 *   authUrl({ state, challenge, nonce })       → URL of the provider's sign-in page (PKCE S256)
 *   completeLogin({ code, verifier, nonce })   → { email, claims, idToken } after every id_token check
 *   logoutUrl()                                → end_session_endpoint, or null (then logout only clears our cookie)
 */
export function createOidc({ issuer, clientId, clientSecret, redirectUri, fetchImpl = globalThis.fetch, clock = Date.now, timeoutMs = 10_000 }) {
  let config = null, pending = null;
  function discover() {
    if (config) return Promise.resolve(config);
    pending ??= getJson(fetchImpl, `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, "discovery", timeoutMs)
      .then((doc) => (config = discoveryDoc(doc, issuer)))
      .finally(() => { pending = null; });
    return pending;
  }

  // The provider's keys, cached; fetched again only for an unknown kid and at most once a minute.
  let keys = null, keysAt = -Infinity, keysPending = null;
  function fetchKeys() {
    keysPending ??= (async () => {
      keysAt = clock();
      const doc = await getJson(fetchImpl, (await discover()).jwksUri, "jwks", timeoutMs);
      if (!Array.isArray(doc?.keys)) fail("jwks", "oidcBadJwks");
      return (keys = doc.keys);
    })().finally(() => { keysPending = null; });
    return keysPending;
  }

  return {
    discover,
    async authUrl({ state, challenge, nonce }) {
      const u = new URL((await discover()).authorizationEndpoint);
      const params = { client_id: clientId, response_type: "code", scope: "openid email profile", redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state, nonce };
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return u.href;
    },
    async completeLogin({ code, verifier, nonce, now }) {
      const d = await discover();
      let r;
      try {
        r = await fetchImpl(d.tokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret, code_verifier: verifier }).toString(),
          redirect: "error", // never re-send the client secret to wherever a redirect points
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        fail("token_endpoint", "oidcTokenUnreachable", { why: String(e?.message ?? e) });
      }
      let j = null;
      try { j = await r.json(); } catch { /* not JSON */ }
      if (!r.ok || !j || typeof j !== "object" || j.error) {
        fail("token_endpoint", "oidcTokenRefused", { error: String(j?.error ?? `HTTP ${r.status}`), description: j?.error_description ? String(j.error_description).slice(0, 200) : "" });
      }
      if (typeof j.id_token !== "string") fail("no_id_token", "oidcNoIdToken");
      const at = now ?? Math.floor(clock() / 1000);
      const verify = (ks) => verifyIdToken(j.id_token, { keys: ks, issuer: d.issuer, clientId, nonce, now: at });
      let out;
      try {
        out = verify(keys ?? (await fetchKeys()));
      } catch (e) {
        if (e?.code !== "unknown_key" || clock() - keysAt < JWKS_REFETCH_MS) throw e;
        out = verify(await fetchKeys()); // the provider may have rotated its key
      }
      return { email: out.email, claims: out.claims, idToken: j.id_token };
    },
    async logoutUrl() {
      try { return (await discover()).endSessionEndpoint; } catch { return null; }
    },
  };
}
