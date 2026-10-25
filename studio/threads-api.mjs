// The studio's conversation API + the background Claude runs (lib/agent.mjs).
//   GET    /__api/threads?entry=&v=       threads of a board in one version
//   POST   /__api/threads                 {entry, version?, title?, text, refs} → a new thread + Claude answers
//   GET    /__api/threads/:id
//   PATCH  /__api/threads/:id             {title?, status?}
//   DELETE /__api/threads/:id
//   POST   /__api/threads/:id/messages    {text, refs, images?, viewing?} → Claude answers (viewing: the screen the
//                                         sender is looking at — an option of the same group; Claude's turn works on it)
//   POST   /__api/threads/:id/stop        stop the running Claude turn
//   POST   /__api/threads/:id/retry       run a failed turn again
//   POST   /__api/threads/:id/claude      {text, refs} — Claude answers BY HAND (127.0.0.1 only)
//   GET    /__api/spec?v=&entry=&kind=    a board's .md spec (default: the live version)
// Languages: what a viewer reads (API errors, the source page, a new thread's default title) follows the viewer's
// language (lib/i18n.mjs requestLang); what a Claude turn stores in the conversation follows the project's.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { newThread, addMessage, editRef, setAgent, parseAgentReply, pendingUserMessages, loadThread, saveThread, deleteThread, listThreads, featureOf, isDesignThread, plainMentions } from "./lib/threads.mjs";
import { isValidEntryId } from "./lib/entries.mjs";
import { buildPrompt, runAgent, SESSION_KIND, DESIGN_TIMEOUT_MS } from "./lib/agent.mjs";
import { createQueue } from "./lib/agent-queue.mjs";
import { cleanRunWith, effectiveRun, modelChoices } from "./lib/run-options.mjs";
import { specName, safeSrcPath, sliceLines } from "./lib/spec-core.mjs";
import { boardsDir } from "./lib/versions.mjs";
import { errorText, normalizeLang, requestLang, StudioError, translate } from "./lib/i18n.mjs";
import SERVER_TEXT from "./lib/i18n/server.mjs";
import DATA_TEXT from "./lib/i18n/data.mjs";

const rid = (p) => p + crypto.randomBytes(4).toString("hex");
const nowIso = () => new Date().toISOString();

const knownCode = (c) => typeof c === "string" && (Object.hasOwn(SERVER_TEXT.en, c) || Object.hasOwn(DATA_TEXT.en, c));

/**
 * JSON body of an error for a viewer in `lang`: { error, code } for a StudioError or a lib's refusal given as
 * { code | key, params } (thread-core's { ok: false, code, params, error }) whose code is in lib/i18n/server.mjs or
 * lib/i18n/data.mjs; anything else → { error } with its own text.
 */
export function apiError(lang, err) {
  if (err instanceof StudioError) return { error: errorText(err, lang, SERVER_TEXT, DATA_TEXT), code: err.code };
  if (err && typeof err === "object" && !(err instanceof Error)) {
    const code = knownCode(err.code) ? err.code : knownCode(err.key) ? err.key : null;
    if (code) return { error: errorText(new StudioError(code, err.params ?? {}), lang, SERVER_TEXT, DATA_TEXT), code };
    if (typeof err.error === "string") return { error: err.error };
  }
  return { error: String(err?.message ?? err) };
}

// runAgent/buildPrompt can be injected so tests run with a fake Claude. shots: the shared screenshot taker (lib/shots.mjs).
/** project: the loaded craft-table.json (name, description, language, source) — for Claude's brief and the source page. */
// sandbox: where a whole-design turn may run scripts (lib/sandbox.mjs createSandbox), or null — then those turns have no `run` tool.
// model: the default model; models: [{ id, label }] the models a thread may choose (lib/run-options.mjs).
export function createThreadsApi({ root, project = null, hot, listEntries, live, pickVersion, readBody, send, model, models = modelChoices(process.env).models, shots, sandbox = null, runAgent: run = runAgent, buildPrompt: build = buildPrompt }) {
  const source = project?.source ?? null;
  /** Language of what a Claude turn stores in the conversation (and of the screen info it is given). */
  const projectLang = normalizeLang(project?.language) ?? "en";
  const dir = path.join(root, "threads");
  const versionsDir = path.join(root, "versions");
  const running = new Map(); // threadId → run (has .stop)
  const runOf = new Map();   // threadId → { version, entry } of the running turn (history credits "Claude" as the author)
  const again = new Set();   // a new message arrived while running → run another turn afterwards
  // One Claude turn at a time per screen (version + screen) — two threads on one screen never edit the same files at once.
  const queue = createQueue();
  const queued = new Set();    // threads waiting for their turn
  const cancelled = new Set(); // Stop / delete while waiting → skipped when its turn comes
  // Writes are serialised per thread (read–modify–write never steps on itself).
  const chains = new Map();
  const withThread = (id, fn) => {
    const next = (chains.get(id) ?? Promise.resolve()).then(async () => {
      const t = await loadThread(dir, id);
      if (!t) return null;
      const out = await fn(t);
      if (out) await saveThread(dir, out);
      return out ?? t;
    });
    chains.set(id, next.catch(() => {}));
    return next;
  };

  const specPath = (v, entry, kind) => { const n = specName(entry, kind); return n ? path.join(boardsDir(root, v), n) : null; };

  // agent.progress / agent.error the studio writes are { key, params? } (rendered by src/i18n/agent-status.ts).
  const markQueued = (id) => withThread(id, (x) => setAgent(x, { state: "queued", progress: { key: "queued" }, error: null }, nowIso()));

  async function startAgent(id) {
    if (running.has(id)) { again.add(id); return; }
    // Waiting: a new message joins the coming turn (runTurn reads the thread again). Stop then Retry while still in
    // the queue → keep the old place.
    if (queued.has(id)) { if (cancelled.delete(id)) await markQueued(id); return; }
    const t0 = await loadThread(dir, id);
    if (!t0 || t0.status !== "open" || !pendingUserMessages(t0).length) return;
    if (running.has(id) || queued.has(id)) return; // called twice while the file was being read
    // A screen's whole group (main screen + options) takes one turn at a time; a whole-design turn holds the whole version.
    const key = isDesignThread(t0) ? `${t0.version}:*` : `${t0.version}:${featureOf(t0.entry)}`;
    const wasBusy = queue.busy(key);
    const turn = queue.acquire(key); // take the place now → first in, first out
    queued.add(id);
    if (wasBusy) await markQueued(id);
    const release = await turn;
    queued.delete(id);
    try {
      if (cancelled.delete(id)) return;
      await runTurn(id);
    } finally {
      release();
    }
    if (again.delete(id) || (await loadThread(dir, id).then((x) => x && x.agent.state === "idle" && pendingUserMessages(x).length))) startAgent(id);
  }

  /** One Claude turn for a thread (the screen is already held). Reads the thread again: messages sent while waiting join this turn. */
  async function runTurn(id) {
    const t = await loadThread(dir, id);
    if (!t || t.status !== "open") return;
    const pending = pendingUserMessages(t);
    if (!pending.length) {
      if (t.agent?.state === "queued") await withThread(id, (x) => setAgent(x, { state: "idle", progress: null }));
      return;
    }
    const lastPendingId = pending[pending.length - 1].id;
    const design = isDesignThread(t);
    const meta = design ? { title: t.title } : listEntries(t.version, { lang: projectLang }).find((e) => e.id === t.entry)?.meta ?? { title: t.entry };
    // A thread is shared by the whole group: this turn works on the screen the sender is looking at (an option or the main screen).
    // A whole-design thread has no screen of its own: the one the sender was looking at, if they said, else none.
    const turnEntry = design ? pending[pending.length - 1].viewing ?? null : pending[pending.length - 1].viewing ?? t.entry;

    // What this turn runs with: the thread's own choice (a model that is no longer offered falls back to the default).
    const { model: runModel, effort } = effectiveRun(t, { models, defaultModel: { id: model } });
    const attempt = async (sessionId) => {
      // The prompt carries only the new messages + ids; Claude opens the rest itself with the sandbox tools (locked by ctx).
      const prompt = build({ thread: t, meta, pending, resume: !!sessionId, viewing: turnEntry, lang: projectLang });
      let lastSave = 0;
      const r = run({
        root, ...(project ? { project } : {}), model: runModel, effort, sessionId, prompt, shots,
        ctx: { version: t.version, threadId: t.id, entry: turnEntry },
        ...(design ? { design: true, sandbox, timeoutMs: DESIGN_TIMEOUT_MS } : {}),
        onSession: (sid) => withThread(id, (x) => setAgent(x, { sessionId: sid, sessionKind: SESSION_KIND })),
        onProgress: (p) => {
          const n = Date.now();
          if (n - lastSave < 800) return; // progress written at most ~once a second
          lastSave = n;
          withThread(id, (x) => setAgent(x, { progress: p }));
        },
      });
      running.set(id, r);
      runOf.set(id, { version: t.version, entry: design ? "*" : turnEntry });
      return r;
    };

    await withThread(id, (x) => setAgent(x, { state: "running", startedAt: nowIso(), progress: { key: "readingConversation" }, error: null }, nowIso()));
    // Resume only sessions this sandbox created; a session of the old way of running (`claude -p`, other tools) →
    // a new session, and Claude reads the old messages itself with read_thread.
    // A session is resumed only for the same model (another model reads the conversation itself, with read_thread); a thread
    // that never recorded its model keeps resuming.
    const resumable = t.agent?.sessionKind === SESSION_KIND && (t.agent.lastModel == null || t.agent.lastModel === runModel) ? t.agent.sessionId : null;
    let r = await attempt(resumable);
    // The session cannot be resumed (expired / deleted) → open a new one.
    if (!r.ok && resumable && typeof r.error === "string" && /session|resume|conversation/i.test(r.error)) {
      await withThread(id, (x) => setAgent(x, { sessionId: null }));
      t.agent = { ...t.agent, sessionId: null };
      r = await attempt(null);
    }
    running.delete(id);
    runOf.delete(id);

    await withThread(id, (x) => {
      let y = setAgent(x, { state: r.ok ? "idle" : "error", progress: null, error: r.ok ? null : r.error, lastCostUsd: r.costUsd, lastModel: runModel, lastEffort: effort ?? null, finishedAt: nowIso() }, nowIso());
      if (r.ok) {
        const { text, refs } = parseAgentReply(r.text, { marks: !design || !!turnEntry });
        // Claude marks on the frame of the screen this turn worked on (possibly an option).
        const m = addMessage(y, { role: "claude", author: "claude", text: text || translate(SERVER_TEXT, projectLang, "claudeNoReply"), refs: refs.map((x) => ({ ...x, entry: turnEntry })) }, { id: rid("m_"), now: nowIso() });
        if (m.ok) {
          // Put the reply RIGHT AFTER the last message this turn read — messages the person sent while it ran
          // stay after it and are handled by the next turn.
          const msgs = [...m.thread.messages];
          const reply = msgs.pop();
          const at = msgs.findIndex((z) => z.id === lastPendingId);
          msgs.splice(at >= 0 ? at + 1 : msgs.length, 0, reply);
          y = { ...m.thread, messages: msgs };
        }
      }
      return y;
    });
  }

  /** Stop: running → stop Claude; waiting → give up the place in the queue (back to idle, messages kept, Retry works). */
  async function stop(id) {
    if (running.has(id)) { running.get(id).stop(); return; }
    if (queued.has(id)) cancelled.add(id);
    again.delete(id);
    // Also when the server no longer holds a place (an orphaned "queued" thread) → back to idle.
    await withThread(id, (x) => (x.agent?.state === "queued" ? setAgent(x, { state: "idle", progress: null }, nowIso()) : null));
  }

  /** The studio restarted mid-turn → running / waiting turns count as failed (with a Retry button). */
  async function recover() {
    for (const t of await listThreads(dir)) {
      if (t.agent?.state === "running" || t.agent?.state === "queued") await withThread(t.id, (x) => setAgent(x, { state: "error", progress: null, error: { key: "restarted" } }));
    }
  }

  // Tell the UI when a thread changes (fs.watch — not through Vite, so the page does not reload).
  fs.mkdirSync(dir, { recursive: true });
  let timer = null;
  const watchers = [];
  watchers.push(fs.watch(dir, (_ev, name) => {
    if (!name?.endsWith(".json") || name.startsWith(".")) return;
    clearTimeout(timer);
    timer = setTimeout(() => hot.send({ type: "custom", event: "studio:threads" }), 60);
  }));
  // A .md spec changed (any version) → tell the UI to reload the Spec panel.
  let specTimer = null;
  fs.mkdirSync(versionsDir, { recursive: true });
  watchers.push(fs.watch(versionsDir, { recursive: true }, (_ev, name) => {
    if (!name?.endsWith(".md")) return;
    clearTimeout(specTimer);
    specTimer = setTimeout(() => hot.send({ type: "custom", event: "studio:spec" }), 60);
  }));

  async function handle(req, res, url, who) {
    const lang = requestLang(req.headers, project?.language);
    /** Error JSON for the viewer: a text of lib/i18n/server.mjs in their language, plus its code. */
    const fail = (status, key, params) => send(res, status, { error: translate(SERVER_TEXT, lang, key, params), code: key });
    /** A refusal of thread-core ({ ok: false, code, params, error }) worded for the viewer from its code. */
    const refuse = (r) => send(res, 400, apiError(lang, r));

    if (url.pathname === "/__api/spec") {
      const qv = url.searchParams.get("v");
      const v = qv ? pickVersion(qv) : live();
      if (!v) return fail(404, "apiNoSuchVersion");
      const p = specPath(v, url.searchParams.get("entry") ?? "", url.searchParams.get("kind") ?? "behavior");
      if (!p) return fail(400, "apiBadEntryKind");
      return fs.existsSync(p) ? send(res, 200, { markdown: fs.readFileSync(p, "utf8") }) : fail(404, "apiNoSpec");
    }
    if (url.pathname === "/__src") return sendSource(res, url, lang);
    if (url.pathname === "/__api/src") return sendSnippet(res, url, fail);
    const m = url.pathname.match(/^\/__api\/threads(?:\/(t_[a-z0-9]+))?(?:\/(messages|refs|stop|retry|claude))?$/);
    if (!m) return fail(404, "apiNotFound");
    const [, id, action] = m;
    if (req.method !== "GET" && !String(req.headers["content-type"] || "").startsWith("application/json")) {
      return fail(415, "apiNeedJson");
    }
    const author = who === "claude@local" ? "claude" : who;

    if (!id && req.method === "GET") return send(res, 200, { threads: await listThreads(dir, url.searchParams.get("entry") || undefined, url.searchParams.get("v") || undefined) });

    if (!id && req.method === "POST") {
      const b = await readBody(req);
      const firstText = typeof b.text === "string" ? b.text.trim() : "";
      // Title made from the first line, without the [#n] markers (they only mean something next to a mark).
      const auto = plainMentions(firstText.split("\n")[0]).replace(/\[#\d+\]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
      // Nothing to name it after → the default title, stored in its creator's language.
      const title = (typeof b.title === "string" && b.title.trim()) || auto || translate(SERVER_TEXT, lang, "threadDefaultTitle");
      const version = b.version == null ? live() : pickVersion(b.version);
      if (!version) return fail(400, "apiVersionMissing");
      const rw = cleanRunWith(b.runWith, models);
      if (!rw.ok) return fail(400, rw.code);
      const nt = newThread({ entry: b.entry, version, title, author, runWith: rw.runWith }, { id: rid("t_"), now: nowIso() });
      if (!nt.ok) return refuse(nt);
      const withMsg = addMessage(nt.thread, { role: "user", author, text: firstText, refs: b.refs, images: b.images, viewing: b.viewing }, { id: rid("m_"), now: nowIso() });
      if (!withMsg.ok) return refuse(withMsg);
      await saveThread(dir, withMsg.thread);
      // noAgent: only for tests run on this very machine (no real Claude turn spent).
      if (!(b.noAgent && who === "claude@local")) startAgent(withMsg.thread.id);
      return send(res, 201, { thread: withMsg.thread });
    }

    if (!id) return fail(405, "apiMethodNotAllowed");
    if (!(await loadThread(dir, id))) return fail(404, "apiNoSuchThread");

    if (!action && req.method === "GET") return send(res, 200, { thread: await loadThread(dir, id) });
    if (!action && req.method === "PATCH") {
      const b = await readBody(req);
      // The model and effort the NEXT turn runs with (an empty object / empty strings = the studio's default).
      const rw = b.runWith === undefined ? null : cleanRunWith(b.runWith, models);
      if (rw && !rw.ok) return fail(400, rw.code);
      const t = await withThread(id, (x) => {
        const { runWith: _drop, ...rest } = x;
        const keep = rw ? rw.runWith : x.runWith;
        return {
          ...rest,
          ...(keep && Object.keys(keep).length ? { runWith: keep } : {}),
          title: typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : x.title,
          status: b.status === "open" || b.status === "closed" ? b.status : x.status,
          updatedAt: nowIso(),
        };
      });
      return send(res, 200, { thread: t });
    }
    if (!action && req.method === "DELETE") {
      await stop(id);
      await deleteThread(dir, id);
      return send(res, 200, { ok: true });
    }
    if (action === "messages" && req.method === "POST") {
      const b = await readBody(req);
      let err = null;
      const t = await withThread(id, (x) => {
        const r = addMessage({ ...x, status: "open" }, { role: "user", author, text: b.text, refs: b.refs, images: b.images, viewing: b.viewing }, { id: rid("m_"), now: nowIso() });
        if (!r.ok) { err = r; return null; }
        return r.thread;
      });
      if (err) return refuse(err);
      if (!(b.noAgent && who === "claude@local")) startAgent(id);
      return send(res, 201, { thread: t });
    }
    // Edit a mark already sent: { messageId, index, action: remove|restore|redraw, ref } (lib/thread-core.mjs editRef).
    if (action === "refs" && req.method === "PATCH") {
      const b = await readBody(req);
      let err = null;
      const t = await withThread(id, (x) => {
        const r = editRef(x, { messageId: b.messageId, index: b.index, action: b.action, ref: b.ref }, { by: author, now: nowIso() });
        if (!r.ok) { err = r; return null; }
        return r.thread;
      });
      return err ? refuse(err) : send(res, 200, { thread: t });
    }
    if (action === "stop" && req.method === "POST") {
      await stop(id);
      return send(res, 200, { ok: true });
    }
    if (action === "retry" && req.method === "POST") {
      startAgent(id);
      return send(res, 200, { ok: true });
    }
    if (action === "claude" && req.method === "POST") {
      if (who !== "claude@local") return fail(403, "apiClaudeOnly");
      const b = await readBody(req);
      let err = null;
      const t = await withThread(id, (x) => {
        const r = addMessage(x, { role: "claude", author: "claude", text: b.text, refs: b.refs }, { id: rid("m_"), now: nowIso() });
        if (!r.ok) { err = r; return null; }
        return r.thread;
      });
      return err ? refuse(err) : send(res, 201, { thread: t });
    }
    return fail(405, "apiMethodNotAllowed");
  }

  // READ-ONLY page of the project's app source code (linked from the Technical tab). Only the safeSrcPath area, and
  // the real path (symlinks resolved) must stay inside the source folder. A project without "source" has nothing to show.
  const SRC = source?.path ?? null;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  /** Read a source file safely: safeSrcPath + the real path must be inside the source folder. */
  function readSafe(rel0) {
    if (!SRC) return { err: 404 };
    const rel = safeSrcPath(rel0 ?? "", source);
    if (!rel) return { err: 400 };
    let real;
    try { real = fs.realpathSync(path.join(SRC, rel)); } catch { return { err: 404 }; }
    if (!real.startsWith(fs.realpathSync(SRC) + path.sep)) return { err: 400 };
    return { rel, lines: fs.readFileSync(real, "utf8").split("\n") };
  }
  // A code excerpt (JSON) for the code viewer in a spec: the quoted lines + 3 lines of context, at most 80.
  function sendSnippet(res, url, fail) {
    const r = readSafe(url.searchParams.get("path"));
    if (r.err) return r.err === 404 ? fail(404, "apiNoFile") : fail(r.err, "apiPathNotAllowed");
    const from = Math.max(1, Number(url.searchParams.get("from")) || 1);
    const to = Math.max(from, Number(url.searchParams.get("to")) || from);
    send(res, 200, { path: r.rel, ...sliceLines(r.lines, from, to, Number(url.searchParams.get("pad") ?? 3), 80) });
  }

  function sendSource(res, url, lang) {
    const t = (key, params) => translate(SERVER_TEXT, lang, key, params);
    if (!SRC) return send(res, 404, t("srcNotDeclared"));
    const rel = safeSrcPath(url.searchParams.get("path") ?? "", source);
    if (!rel) return send(res, 400, t("srcPathNotAllowed"));
    let real;
    try { real = fs.realpathSync(path.join(SRC, rel)); } catch { return send(res, 404, t("srcNoFile")); }
    if (!real.startsWith(fs.realpathSync(SRC) + path.sep)) return send(res, 400, t("srcPathNotAllowed"));
    const from = Number(url.searchParams.get("from")) || 0, to = Number(url.searchParams.get("to")) || from;
    const lines = fs.readFileSync(real, "utf8").split("\n");
    let sha = "";
    try { sha = fs.readFileSync(path.join(SRC, ".git", "HEAD"), "utf8").trim(); } catch { /* not a git checkout */ }
    // HEAD is "ref: refs/heads/<branch>" on a branch, a commit id when detached.
    const at = sha.includes("ref: refs/heads/") ? t("srcReadOnlyBranch", { branch: esc(sha.replace("ref: refs/heads/", "")) }) : t("srcReadOnly", { head: esc(sha) });
    const rows = lines.map((l, i) => {
      const n = i + 1, hit = from && n >= from && n <= to;
      return `<tr id="L${n}" class="${hit ? "hit" : ""}"><td class="n"><a href="#L${n}">${n}</a></td><td class="c">${esc(l) || " "}</td></tr>`;
    }).join("");
    send(res, 200, `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(rel)}${from ? `:${from}` : ""} · ${esc(source.label)}</title><style>
body{margin:0;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1c2333;background:#f7f8fa}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #dce0e8;padding:10px 16px;font:600 14px system-ui,sans-serif}
header small{font-weight:400;color:#5e6a80;margin-left:8px}
table{border-collapse:collapse;width:100%;background:#fff}td{padding:0 12px;vertical-align:top;white-space:pre}
td.n{width:1%;text-align:right;color:#8b94a6;user-select:none;border-right:1px solid #eef0f4}td.n a{color:inherit;text-decoration:none}
tr.hit td{background:#eef9f3}tr.hit td.n{color:#155f3d;font-weight:700;border-right-color:#41bb83}
</style></head><body><header>${esc(source.label)}/${esc(rel)}${from ? `:${from}${to !== from ? `-${to}` : ""}` : ""}<small>${at}</small></header>
<table>${rows}</table><script>var e=document.getElementById("L${Math.max(1, from - 6)}");if(e)e.scrollIntoView();</script></body></html>`);
  }

  /** The Claude turn running on screen (version, entry) → its thread id, or null. */
  const activeRunFor = (version, entry) => { for (const [id, r] of runOf) if (r.version === version && (r.entry === entry || r.entry === "*")) return id; return null; };

  const close = () => { for (const w of watchers) w.close(); clearTimeout(timer); clearTimeout(specTimer); };
  return { handle, recover, startAgent, stop, activeRunFor, close };
}
