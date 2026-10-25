// craft-table studio server — one Node process per project (run inside the project folder, or set CRAFT_PROJECT).
//   • Vite in middleware mode: boards are real React built from the project's own design system; edit a file and
//     the page updates (HMR). See lib/vite-config.mjs.
//   • Remote users sign in through any OIDC provider; requests from this machine (Claude's own browser) pass.
//   • Design conversations (threads/*.json): many threads per board, messages carry annotated regions; Claude works
//     in the background, answers and edits boards (threads-api.mjs).
//   • VERSIONS are full copies: versions/<v>/{boards,system} (lib/versions.mjs); "@ds" follows the version of the
//     importing file (lib/ds-resolve.mjs).
//   • Languages (lib/i18n.mjs): every text a viewer reads — pages, API errors — is in the viewer's language (the
//     ct_lang cookie, else the project's); texts of lib/i18n/server.mjs. Console logs are English.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createServer as createVite } from "vite";
import { entryIdFromPath } from "./lib/entries.mjs";
import { readMeta } from "./lib/meta-io.mjs";
import { apiError, createThreadsApi } from "./threads-api.mjs";
import { createSandbox, detectBackend } from "./lib/sandbox.mjs";
import { EFFORTS, modelChoices } from "./lib/run-options.mjs";
import { openHistory } from "./lib/history.mjs";
import { createRecorder } from "./lib/history-recorder.mjs";
import { createCollab } from "./lib/collab.mjs";
import { adoptOption, createOption, removeOption, renameOption } from "./lib/options.mjs";
import { normalizeOption } from "./lib/option-meta.mjs";
import { createShots } from "./lib/shots.mjs";
import { MAX_UPLOAD, UPLOAD_MIME, saveUpload, tooLarge, uploadFile } from "./lib/uploads.mjs";
import { listVersions, readIndex, readVersion, createVersion, updateVersion, setLive, boardsDir, versionDir, isValidVersionId, boardChanged, BOARD_FILE_SUFFIXES } from "./lib/versions.mjs";
import { signSession, readSession, signValue, readValue, safeRedirect, isLocalRequest, fromOtherSite, parseCookies, publicUrlFrom, cookieHeader } from "./lib/session.mjs";
import { createOidc, OidcError } from "./lib/oidc.mjs";
import { loadProject, writeDesktop, toolBase } from "./lib/project.mjs";
import { DESKTOP, cleanDesktop } from "./lib/devices.mjs";
import { viteConfig, withToolBase } from "./lib/vite-config.mjs";
import { normalizeLang, requestLang, StudioError, translate, withLang } from "./lib/i18n.mjs";
import SERVER_TEXT from "./lib/i18n/server.mjs";

// TOOL = this package; ROOT = the project folder (craft-table.json, versions/, threads/, data/).
const TOOL = path.resolve(import.meta.dirname, "..");
const PROJECT = loadProject();
const ROOT = PROJECT.dir;
const TOOL_URL = toolBase(TOOL, ROOT);
loadEnvFile(process.env.STUDIO_ENV_FILE || path.join(ROOT, ".env"));

const PORT = +(process.env.STUDIO_PORT || 5180);
// Where people open the studio: STUDIO_PUBLIC_URL, else STUDIO_PUBLIC_HOST (https, except localhost), else localhost.
const PUBLIC_URL = publicUrlFrom({ url: process.env.STUDIO_PUBLIC_URL, host: process.env.STUDIO_PUBLIC_HOST, port: PORT });
const ISSUER = (process.env.IDP_ISSUER || "").trim();
const CLIENT_ID = process.env.OIDC_CLIENT_ID || "craft-table";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const ALLOWED = (process.env.ALLOWED_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const REDIRECT_URI = `${PUBLIC_URL}/__auth/callback`;
const SESSION_TTL = 12 * 3600;
const FLOW_TTL = 600; // seconds between leaving for the provider's sign-in page and coming back
const VERSIONS_DIR = path.join(ROOT, "versions");
const live = () => readIndex(ROOT).live;
/** The version asked for in the URL (?v=) when it exists, else null (callers then fall back to the live version). */
function pickVersion(v) {
  return v && isValidVersionId(v) && fs.existsSync(path.join(VERSIONS_DIR, v, "version.json")) ? v : null;
}
// Sign-in on (OIDC) only with all three; otherwise only requests from this machine are served (lib/session.mjs).
const REMOTE_READY = Boolean(ISSUER && CLIENT_SECRET && SESSION_SECRET);
const oidc = REMOTE_READY ? createOidc({ issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI }) : null;

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);
const cookies = (req) => parseCookies(req.headers.cookie); // never throws: a malformed value is skipped
/** Language of the person viewing (lib/i18n.mjs): cookie ct_lang, else the project's language, else English. */
const viewerLang = (req) => requestLang(req.headers, PROJECT.config.language);
/** A text of lib/i18n/server.mjs in the viewer's language. */
const t = (req, key, params) => translate(SERVER_TEXT, viewerLang(req), key, params);
const cookie = (n, v, maxAge) => cookieHeader(n, v, maxAge, PUBLIC_URL); // "Secure" only when PUBLIC_URL is https
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function send(res, status, body, headers = {}) {
  const isObj = typeof body === "object" && body !== null;
  res.writeHead(status, { "Content-Type": isObj ? "application/json; charset=utf-8" : "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
/** API error for the viewer: { error: a text of lib/i18n/server.mjs in their language, code }. */
const fail = (req, res, status, key, params) => send(res, status, { error: t(req, key, params), code: key });
/**
 * A caught error for the viewer: a StudioError of a lib (lib/i18n/server.mjs, lib/i18n/data.mjs) in their language with
 * its code and status; any other error keeps its message, with `status`.
 */
const sendError = (req, res, e, status = 400) => send(res, e instanceof StudioError ? e.status : status, apiError(viewerLang(req), e));

// ── Sign-in (OIDC: discovery, token exchange and id_token checks in lib/oidc.mjs) ───────────────────────────────
/**
 * A sign-in / sign-out page: one text in the viewer's language (params already escaped), then a link back to the
 * studio when `link` names one ("signInRetry", "signInAgain").
 */
const page = (req, key, params, link) => `${t(req, key, params)}${link ? ` <a href='/'>${esc(t(req, link))}</a>` : ""}`;
const noSignIn = (req) => t(req, "signInNotConfigured", { url: `http://localhost:${PORT}` });
/** Why sign-in failed, for the viewer: an OidcError in their language, anything else as its message. */
const signInWhy = (req, e) => (e instanceof OidcError ? t(req, e.key, e.params) : String(e?.message || e));
async function startLogin(req, res) {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("base64url");
  const nonce = crypto.randomBytes(16).toString("base64url");
  let href;
  try {
    href = await oidc.authUrl({ state, challenge, nonce });
  } catch (e) {
    console.error(`sign-in: ${e.message}`);
    return send(res, 502, page(req, "signInStartFailed", { why: esc(signInWhy(req, e)) }, "signInRetry"));
  }
  // state + PKCE verifier + nonce stay in a signed cookie of this browser until the provider sends it back.
  const flow = signValue({ v: verifier, state, n: nonce, rd: safeRedirect(req.url), exp: nowSec() + FLOW_TTL }, SESSION_SECRET);
  send(res, 302, "", { "Set-Cookie": cookie("ds_flow", flow, FLOW_TTL), Location: href });
}

async function handleCallback(req, res, url) {
  const done = { "Set-Cookie": cookie("ds_flow", "", 0) };
  const err = url.searchParams.get("error");
  if (err) {
    const why = [err, url.searchParams.get("error_description")].filter(Boolean).join(" — ").slice(0, 200);
    return send(res, 400, page(req, "signInRefusedByProvider", { why: esc(why) }, "signInRetry"), done);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const flow = readValue(cookies(req).ds_flow, SESSION_SECRET);
  if (!code || !flow || flow.state !== state || !(flow.exp > nowSec())) return send(res, 400, page(req, "signInFlowInvalid", {}, "signInRetry"), done);
  try {
    // The id_token is verified (signature, issuer, audience, expiry, nonce) — the email comes from its claims.
    const { email } = await oidc.completeLogin({ code, verifier: flow.v, nonce: flow.n });
    if (ALLOWED.length && !ALLOWED.includes(email)) return send(res, 403, page(req, "signInNotAllowed", { email: esc(email) }), done);
    send(res, 302, "", {
      "Set-Cookie": [cookie("ds_sess", signSession(email, SESSION_SECRET, SESSION_TTL, nowSec()), SESSION_TTL), done["Set-Cookie"]],
      Location: safeRedirect(flow.rd),
    });
  } catch (e) {
    console.error(`sign-in: ${e.code ?? "error"} — ${e.message}`);
    send(res, 502, page(req, "signInFailed", { why: esc(signInWhy(req, e).slice(0, 200)) }, "signInRetry"), done);
  }
}

/** Clear our session, then the provider's end-session page when it has one (otherwise only our cookie goes). */
async function handleLogout(req, res) {
  const clear = { "Set-Cookie": cookie("ds_sess", "", 0) };
  const to = oidc ? await oidc.logoutUrl() : null;
  if (to) return send(res, 302, "", { ...clear, Location: to });
  send(res, 200, page(req, "signedOut", {}, "signInAgain"), clear);
}

/**
 * Email of the person viewing, "claude@local" for this very machine (lib/session.mjs), null when not signed in.
 * A request another web page makes the browser send (CSRF, websocket hijacking) carries no identity — not even
 * "this machine". Never throws (also called in the upgrade event).
 */
function whoIs(req) {
  const h = req.headers;
  // "This machine": the Origin must match the request's own localhost Host; a session: the Host or the public address.
  if (isLocalRequest(req.socket.remoteAddress, h)) return fromOtherSite(req.method, h) ? null : "claude@local";
  if (!REMOTE_READY || fromOtherSite(req.method, h, [PUBLIC_URL])) return null;
  return readSession(cookies(req).ds_sess, SESSION_SECRET, nowSec(), ALLOWED);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new StudioError("requestBodyTooLarge")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new StudioError("requestBadJson")); }
    });
    req.on("error", reject);
  });
}

// ── Board list (per version) ─────────────────────────────────────────────────
/** lang: of the placeholder screen info of a board whose meta cannot be read (the viewer's, or the project's for Claude). */
function listEntries(v = live(), { changed = false, lang = normalizeLang(PROJECT.config.language) ?? "en" } = {}) {
  const DESIGN_DIR = boardsDir(ROOT, v);
  // Compared with the source version to flag screens as "changed" (only when the UI asks — the agent does not need it).
  const from = changed ? readVersion(ROOT, v).from : null;
  const out = [];
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) { if (!d.name.startsWith("_") && !d.name.startsWith(".")) walk(abs); continue; }
      const id = entryIdFromPath(path.relative(DESIGN_DIR, abs).split(path.sep).join("/"));
      if (!id) continue;
      // <screen>.meta.json (co-editable) or the old meta block in the .tsx; an option written in a wrong shape → fixed on read.
      const meta = normalizeOption(id, readMeta(abs));
      const e = meta ? { id, meta } : { id, meta: { title: id, section: translate(SERVER_TEXT, lang, "entryErrorSection"), group: translate(SERVER_TEXT, lang, "entryMissingMetaGroup") } };
      if (from) e.changed = boardChanged(ROOT, v, from, id);
      out.push(e);
    }
  };
  if (fs.existsSync(DESIGN_DIR)) walk(DESIGN_DIR);
  return out.sort((a, b) => (a.meta.order ?? 999) - (b.meta.order ?? 999) || a.id.localeCompare(b.id));
}

// ── Server ──────────────────────────────────────────────────────────────────
const httpServer = http.createServer();
const vite = await createVite(viteConfig({ projectDir: ROOT, toolDir: TOOL, httpServer, hosts: [new URL(PUBLIC_URL).hostname], language: PROJECT.config.language }));


// A file changed → tell the studio to reload the board list over the HMR channel (a custom event, NOT a page reload).
const hot = vite.hot ?? vite.ws;
vite.watcher.on("all", (_ev, file) => {
  if (!file.startsWith(VERSIONS_DIR + path.sep)) return;
  if (file.endsWith(".tsx") && file.includes(`${path.sep}boards${path.sep}`)) hot.send({ type: "custom", event: "studio:entries" });
});
// The screenshot taker shared by the studio's Claude (view_frame / view_region / locate / check spec).
const shots = createShots({ base: `http://127.0.0.1:${PORT}`, tool: TOOL_URL, externalOrigins: PROJECT.config.externalOrigins, desktop: () => PROJECT.config.desktop });
// Where a whole-design conversation may run scripts (lib/sandbox.mjs; CRAFT_SANDBOX): nowhere unless the machine has an isolated sandbox or the owner asked for one.
const SANDBOX = detectBackend();
const sandbox = SANDBOX.backend ? createSandbox({ backend: SANDBOX.backend, root: ROOT, lang: normalizeLang(PROJECT.config.language) ?? "en" }) : null;
console.log(`  Claude's scripts: ${SANDBOX.backend ?? "off"} — ${SANDBOX.reason}`);
const MODELS = modelChoices(process.env); // what a conversation may run with (the message box offers these)
const threads = createThreadsApi({ root: ROOT, project: PROJECT.config, hot, listEntries, live, pickVersion, readBody, send, shots, sandbox, model: MODELS.defaultModel.id, models: MODELS.models });

// ── Versions API ─────────────────────────────────────────────────────────────
//   GET    /__api/versions               the list + the live version
//   POST   /__api/versions               {from, title, note?} → a new copy
//   PATCH  /__api/versions/:id           {title?, status?, note?}
//   POST   /__api/versions/:id/live      make it the live version
//   DELETE /__api/versions/:id           ONLY from 127.0.0.1 (clean-up of test versions), never the live version
async function handleVersions(req, res, url, who) {
  const m = url.pathname.match(/^\/__api\/versions(?:\/([a-z0-9-]+))?(?:\/(live))?$/);
  if (!m) return fail(req, res, 404, "apiNotFound");
  const [, id, action] = m;
  try {
    if (!id && req.method === "GET") return send(res, 200, { versions: listVersions(ROOT), live: live() });
    if (!id && req.method === "POST") {
      const b = await readBody(req);
      if (!pickVersion(b.from)) return fail(req, res, 400, "apiSourceVersionMissing");
      const v = createVersion(ROOT, { from: b.from, title: b.title, note: b.note, by: who });
      history.purgeVersion(v.id); // old snapshots of a version with the same id, deleted earlier
      // Initial snapshots for every file just copied — so the recorder does not take ~300 copied files for "edited outside the studio".
      recorder.baseline();
      hot.send({ type: "custom", event: "studio:versions" });
      return send(res, 201, { version: v });
    }
    if (!id || !pickVersion(id)) return fail(req, res, 404, "apiNoSuchVersion");
    if (!action && req.method === "PATCH") {
      const v = updateVersion(ROOT, id, await readBody(req));
      hot.send({ type: "custom", event: "studio:versions" });
      return send(res, 200, { version: v });
    }
    if (action === "live" && req.method === "POST") {
      setLive(ROOT, id);
      hot.send({ type: "custom", event: "studio:versions" });
      return send(res, 200, { live: id });
    }
    if (!action && req.method === "DELETE") {
      if (who !== "claude@local") return fail(req, res, 403, "apiDeleteOnlyLocal");
      if (id === live()) return fail(req, res, 400, "apiCannotDeleteLive");
      fs.rmSync(versionDir(ROOT, id), { recursive: true, force: true });
      history.purgeVersion(id);
      const idx = readIndex(ROOT);
      fs.writeFileSync(path.join(VERSIONS_DIR, "index.json"), JSON.stringify({ live: idx.live, order: idx.order.filter((x) => x !== id) }, null, 2) + "\n");
      hot.send({ type: "custom", event: "studio:versions" });
      return send(res, 200, { ok: true });
    }
    return fail(req, res, 405, "apiMethodNotAllowed");
  } catch (e) {
    // A lib error meant for the viewer (StudioError, e.g. a bad status from updateVersion) is translated here.
    return sendError(req, res, e);
  }
}
await threads.recover();

// ── History of each screen (data/studio.sqlite) ─────────────────────────────
const history = openHistory(path.join(ROOT, "data", "studio.sqlite"));
const entryOfFile = (rel) => { const s = BOARD_FILE_SUFFIXES.find((x) => rel.endsWith(x)); return s ? rel.slice(0, -s.length) : rel; };
const recorder = createRecorder({
  root: ROOT,
  history,
  attribute: (v, rel) => {
    const tid = threads.activeRunFor(v, entryOfFile(rel));
    return tid ? { author: "claude", source: "claude", threadId: tid } : null;
  },
  onRecord: () => hot.send({ type: "custom", event: "studio:history" }),
});
console.log(`history: ${recorder.baseline()} new initial snapshots`);
// ── Co-editing (Y.js / Hocuspocus) at /__collab — the files on disk stay the source of truth ──
const collab = createCollab({
  root: ROOT,
  dbFile: path.join(ROOT, "data", "studio.sqlite"),
  whoIs,
  onHumanEdit: (v, rel, email) => recorder.markHuman(v, rel, email),
});
// Websockets need the same identity as page requests. Vite's HMR socket alone accepts any client that sends no
// Origin header (a script rather than a browser) and would show it file paths and compile errors with code.
const viteUpgrade = httpServer.listeners("upgrade");
httpServer.removeAllListeners("upgrade");
// An exception in an "upgrade" listener is uncaught and would end the process — answer 400 instead.
httpServer.on("upgrade", (req, socket, head) => {
  socket.on("error", () => {}); // Node drops its own handler at upgrade; a reset by the client must not end the process
  try {
    if (collab.handleUpgrade(req, socket, head)) return;
    if (!whoIs(req)) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    for (const l of viteUpgrade) l.call(httpServer, req, socket, head);
  } catch (e) {
    console.error(`upgrade ${String(req.url).slice(0, 100)}: ${e?.message ?? e}`);
    if (socket.writable) socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
  }
});
let versionsTimer = null;
fs.watch(VERSIONS_DIR, { recursive: true }, (_ev, name) => {
  if (!name) return;
  const abs = path.join(VERSIONS_DIR, name);
  // Screen info (.meta.json) changed → the board list reloads (Vite ignores these files, see watch.ignored).
  if (name.endsWith(".meta.json")) hot.send({ type: "custom", event: "studio:entries" });
  if (name === "index.json" || name.endsWith(`${path.sep}version.json`)) {
    clearTimeout(versionsTimer);
    versionsTimer = setTimeout(() => hot.send({ type: "custom", event: "studio:versions" }), 80);
  }
  recorder.touch(abs);
  collab.fileChanged(abs);
});

//   GET  /__api/history?v=&entry=         a screen's snapshots (newest first)
//   GET  /__api/history/:id               one snapshot + the file's current content (to compare)
//   POST /__api/history/:id/restore       write the snapshot's content to the file (a new snapshot, source "restore")
async function handleHistory(req, res, url, who) {
  const m = url.pathname.match(/^\/__api\/history(?:\/(\d+))?(?:\/(restore))?$/);
  if (!m) return fail(req, res, 404, "apiNotFound");
  const [, id, action] = m;
  if (!id && req.method === "GET") {
    const v = pickVersion(url.searchParams.get("v")) ?? live();
    const entry = url.searchParams.get("entry") ?? "";
    if (!entryIdFromPath(`${entry}.tsx`)) return fail(req, res, 400, "apiBadEntry");
    return send(res, 200, { version: v, revisions: history.list({ version: v, entry }) });
  }
  const r = id ? history.get(id) : undefined;
  if (!r) return fail(req, res, 404, "apiNoSuchSnapshot");
  const file = path.join(boardsDir(ROOT, r.version), r.path);
  if (!action && req.method === "GET") {
    let current = null;
    try { current = fs.readFileSync(file, "utf8"); } catch { /* the file was deleted */ }
    return send(res, 200, { revision: r, current });
  }
  if (action === "restore" && req.method === "POST") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, r.content);
    fs.renameSync(`${file}.tmp`, file);
    // Notes are { key, params } (lib/history.mjs): the UI words them in each viewer's language.
    const nid = history.record({ version: r.version, path: r.path, content: r.content, author: who, source: "restore", note: { key: "restoredSnapshot", params: { id: r.id, ts: r.ts } } });
    hot.send({ type: "custom", event: "studio:history" });
    return send(res, 200, { ok: true, revision: nid });
  }
  return fail(req, res, 405, "apiMethodNotAllowed");
}

//   POST /__api/options           {v, entries[], name} → a new option (id "<screen>~<name>") for these screens
//   POST /__api/options/adopt     {v, entry}  → copy the option over its main screen; history records source "option"
//   POST /__api/options/remove    {v, entry}  → remove the option (delete its files)
//   POST /__api/options/rename    {v, entry, name} → rename the option (the whole group made together; ids kept)
async function handleOptions(req, res, url, who) {
  if (req.method !== "POST") return fail(req, res, 405, "apiMethodNotAllowed");
  const b = await readBody(req);
  const v = b.v == null ? live() : pickVersion(b.v);
  if (!v) return fail(req, res, 400, "apiNoSuchVersion");
  try {
    if (url.pathname === "/__api/options") {
      const ids = createOption(ROOT, v, { entries: b.entries, name: b.name, by: who });
      hot.send({ type: "custom", event: "studio:entries" });
      return send(res, 201, { version: v, ids });
    }
    if (url.pathname === "/__api/options/adopt") {
      const name = normalizeOption(b.entry, readMeta(path.join(boardsDir(ROOT, v), `${b.entry}.tsx`)))?.option?.name ?? b.entry;
      const written = adoptOption(ROOT, v, b.entry, { by: who });
      // A history snapshot with source "option" for each main-screen file just written (the automatic recorder then
      // sees the same content → skips it).
      for (const rel of written) {
        if (rel.startsWith(`${b.entry}.`)) continue;
        history.record({ version: v, path: rel, content: fs.readFileSync(path.join(boardsDir(ROOT, v), rel), "utf8"), author: who, source: "option", note: { key: "adoptedOption", params: { name } } });
      }
      hot.send({ type: "custom", event: "studio:entries" });
      hot.send({ type: "custom", event: "studio:history" });
      return send(res, 200, { version: v, written });
    }
    if (url.pathname === "/__api/options/rename") {
      const renamed = renameOption(ROOT, v, b.entry, { name: b.name });
      hot.send({ type: "custom", event: "studio:entries" });
      return send(res, 200, { version: v, renamed });
    }
    if (url.pathname === "/__api/options/remove") {
      const gone = removeOption(ROOT, v, b.entry);
      hot.send({ type: "custom", event: "studio:entries" });
      return send(res, 200, { version: v, removed: gone });
    }
    return fail(req, res, 404, "apiNotFound");
  } catch (e) {
    return sendError(req, res, e);
  }
}

// ── Images attached to messages (data/uploads/, see lib/uploads.mjs) ────────
//   POST /__api/uploads          body = the image bytes (Content-Type image/*) → { id }
//   GET  /__api/uploads/<id>     the image (signed-in people only — like every /__api)
const UPLOADS = path.join(ROOT, "data", "uploads");
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(tooLarge(limit)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function handleUploads(req, res, url) {
  if (url.pathname === "/__api/uploads" && req.method === "POST") {
    // Content-Type image/* is required: a form on another site cannot send this type without a preflight (CSRF guard).
    if (!String(req.headers["content-type"] ?? "").startsWith("image/")) return fail(req, res, 415, "apiNeedImageType");
    try { return send(res, 201, { id: saveUpload(UPLOADS, await readRaw(req, MAX_UPLOAD)) }); }
    catch (e) { return sendError(req, res, e); }
  }
  const id = url.pathname.slice("/__api/uploads/".length);
  const file = req.method === "GET" ? uploadFile(UPLOADS, id) : null;
  if (!file || !fs.existsSync(file)) return fail(req, res, 404, "apiNoSuchImage");
  res.writeHead(200, { "Content-Type": UPLOAD_MIME[id.split(".").pop()], "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" });
  fs.createReadStream(file).pipe(res);
}

const HTML = {
  "/": path.join(TOOL, "studio", "index.html"),
  "/frame": path.join(TOOL, "studio", "frame.html"),
  "/spec": path.join(TOOL, "studio", "spec.html"),
  "/versions": path.join(TOOL, "studio", "versions.html"),
};

httpServer.on("request", async (req, res) => {
  let url;
  // Host / target that is not a URL: answer 400 here — thrown outside the try below it would end the process.
  try { url = new URL(req.url, `http://${req.headers.host || "localhost"}`); } catch { return send(res, 400, t(req, "pageBadRequest")); }
  try {
    if (url.pathname === "/__auth/callback") {
      if (!REMOTE_READY) return send(res, 503, noSignIn(req));
      return await handleCallback(req, res, url);
    }
    if (url.pathname === "/__auth/logout") return await handleLogout(req, res);
    const who = whoIs(req);
    if (!who) {
      if (!REMOTE_READY) return send(res, 503, noSignIn(req));
      if (url.pathname.startsWith("/__api/")) return fail(req, res, 401, "apiNotSignedIn");
      return await startLogin(req, res);
    }
    if (url.pathname === "/__api/me") return send(res, 200, { email: who });
    if (url.pathname === "/__api/project") {
      const c = PROJECT.config;
      return send(res, 200, { name: c.name, description: c.description, language: c.language, logo: c.logo, source: c.source ? { label: c.source.label, roots: c.source.roots, extensions: c.source.extensions } : null, agent: { sandbox: SANDBOX.backend, sandboxReason: SANDBOX.reason, models: MODELS.models, defaultModel: MODELS.defaultModel, efforts: EFFORTS }, desktop: { width: c.desktop.w, height: c.desktop.h } });
    }
    // The desktop frame size of the project (the Settings): { width, height } or { reset: true } → craft-table.json, then every open page re-reads it.
    if (url.pathname === "/__api/project/desktop") {
      if (req.method !== "PUT") return fail(req, res, 405, "apiMethodNotAllowed");
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) return fail(req, res, 415, "apiNeedJson");
      const b = await readBody(req);
      const size = b?.reset === true ? null : cleanDesktop(b);
      if (b?.reset !== true && !size) return fail(req, res, 400, "apiBadDesktop");
      writeDesktop(ROOT, size);
      PROJECT.config.desktop = size ?? DESKTOP;
      hot.send({ type: "custom", event: "studio:project" });
      return send(res, 200, { desktop: { width: PROJECT.config.desktop.w, height: PROJECT.config.desktop.h } });
    }
    if (url.pathname.startsWith("/__api/threads") || url.pathname === "/__api/spec" || url.pathname === "/__src" || url.pathname === "/__api/src") return await threads.handle(req, res, url, who);
    if (url.pathname.startsWith("/__api/versions")) return await handleVersions(req, res, url, who);
    if (url.pathname.startsWith("/__api/history")) return await handleHistory(req, res, url, who);
    if (url.pathname.startsWith("/__api/options")) return await handleOptions(req, res, url, who);
    if (url.pathname === "/__api/uploads" || url.pathname.startsWith("/__api/uploads/")) return await handleUploads(req, res, url);
    if (url.pathname === "/__api/entries") {
      const q = url.searchParams.get("v");
      const v = q ? pickVersion(q) : live();
      return v ? send(res, 200, { version: v, entries: listEntries(v, { changed: true, lang: viewerLang(req) }) }) : fail(req, res, 404, "apiNoSuchVersion");
    }
    const htmlFile = HTML[url.pathname];
    if (htmlFile && req.method === "GET") {
      // Studio pages speak the viewer's language; a board's frame keeps the project's language (its content) and
      // carries the viewer's in data-ui-lang for the studio's own texts drawn in it (studio/src/i18n/index.ts).
      const ui = viewerLang(req);
      const langs = url.pathname === "/frame" ? { lang: PROJECT.config.language, uiLang: ui } : { lang: ui };
      const raw = withLang(withToolBase(fs.readFileSync(htmlFile, "utf8"), TOOL_URL), langs);
      const html = await vite.transformIndexHtml(url.pathname + url.search, raw);
      return send(res, 200, html);
    }
    vite.middlewares(req, res, () => send(res, 404, t(req, "pageNotFound")));
  } catch (e) {
    // A request the studio refuses (a StudioError: bad JSON, a body too large…) is the viewer's mistake, not a crash.
    if (e instanceof StudioError) { if (!res.headersSent) sendError(req, res, e); return; }
    vite.ssrFixStacktrace?.(e);
    console.error(e);
    if (!res.headersSent) send(res, 500, t(req, "pageStudioError", { message: String(e.message || e).slice(0, 300) }));
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`studio: http://0.0.0.0:${PORT}  public=${PUBLIC_URL}`);
  console.log(REMOTE_READY ? `sign-in: OIDC ${ISSUER}` : `sign-in: none — only this machine (http://localhost:${PORT})`);
  // Requests from this machine skip sign-in, and the Host header is the client's word (lib/session.mjs isLocalRequest).
  if (REMOTE_READY) console.log("sign-in: a proxy or tunnel on this machine must add X-Forwarded-For; never forward raw TCP to 127.0.0.1 (it would pass as this machine)");
  const missing = Object.entries({ IDP_ISSUER: ISSUER, OIDC_CLIENT_SECRET: CLIENT_SECRET, SESSION_SECRET }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length && missing.length < 3) console.warn(`sign-in: ${missing.join(", ")} not set — sign-in stays off`);
  if (REMOTE_READY && SESSION_SECRET.length < 32) console.warn("sign-in: SESSION_SECRET is short — use at least 32 random characters");
  // Warm the discovery cache; if the provider is unreachable now, the next sign-in tries again.
  oidc?.discover().catch((e) => console.warn(`sign-in: ${e.message} — will retry at the next sign-in`));
});
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, async () => { await collab.close().catch(() => {}); await shots.close(); recorder.flush(); history.close(); vite.close().finally(() => process.exit(0)); });
