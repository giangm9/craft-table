// The SANDBOX of Claude in the studio: the ONLY tools the agent has (no built-in Bash/Read/Edit). Every tool is locked
// to the thread's context — ctx = { version, threadId, entry }: it reads/edits only inside versions/<version>/ and sees
// only the marks + attached images of that very thread. The project's app source (craft-table.json "source", if any)
// is read-only, through the safe area of the /__src page (safeSrcPath), with the prefix "src:".
// Each tool: { name, description, shape (zod), handler(args) → { content: [...], isError? } } — agent.mjs wraps them
// as an in-process MCP server (createSdkMcpServer). Results are capped in length, with how to read on.
// Every text Claude reads here follows the PROJECT language (lang; lib/i18n/agent.mjs).
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { allRefs, textWithThreadMarks } from "./thread-core.mjs";
import { writableRel, contentIssue } from "./write-guard.mjs";
import { listThreads, loadThread } from "./threads.mjs";
import { isValidEntryId } from "./entries.mjs";
import { safeSrcPath } from "./spec-core.mjs";
import { isUploadId, UPLOAD_MIME } from "./uploads.mjs";
import { normalizeLang, translate } from "./i18n.mjs";
import AGENT from "./i18n/agent.mjs";

const READ_LINES = 400, SEARCH_MAX = 60, THREAD_PAGE = 20, LIST_MAX = 200;
/** craft-table's own rules (boards, specs, marks): one folder per language, the same file names in each. */
export const RULES_ROOT = path.join(import.meta.dirname, "..", "agent-rules");
/** Folder of craft-table's own rules in the project's language (unknown → English). A project adds / overrides rules in its rules/. */
export const defaultRules = (lang) => path.join(RULES_ROOT, normalizeLang(lang) ?? "en");
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
/**
 * Topic names of earlier versions, when the rules had Vietnamese file names. Still accepted when Claude asks for one,
 * and a project's rules/ file with an old name still overrides the built-in rule it used to override.
 */
const LEGACY_TOPICS = { "ban-ve": "boards", "dac-ta": "specs", khoanh: "marks" };
const topicOf = (name) => LEGACY_TOPICS[name] ?? name;

/** Rule topic → .md file; a later folder overrides an earlier one on the same topic. A missing folder is skipped. */
function ruleFiles(dirs) {
  const out = new Map();
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort(); } catch { continue; }
    for (const n of names) { const topic = topicOf(n.slice(0, -3)); if (TOPIC_RE.test(topic)) out.set(topic, path.join(dir, n)); }
  }
  return out;
}
export const ruleTopics = (dirs) => [...ruleFiles(dirs).keys()];

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });
const IMAGE_SEND_MAX = 3.5 * 1024 * 1024; // < the API's 5 MB, even counted as base64
const image = (buf, mimeType = "image/png") => ({ type: "image", data: Buffer.from(buf).toString("base64"), mimeType });
const inside = (dir, p) => p === dir || p.startsWith(dir + path.sep);

/**
 * source: { path, label, roots, extensions } of the project's app repo, or null (no source reading).
 * lang: the project's language — every description and result Claude reads (unknown → English).
 */
export function createAgentTools({ root, source = null, ctx, shots, checks, threadsDir, uploadsDir, lang = "en", rulesDirs = [defaultRules(lang)], design = false }) {
  const T = (key, params) => translate(AGENT, lang, key, params);
  const rules = ruleFiles(rulesDirs);
  const topics = [...rules.keys()];
  const vdir = path.join(root, "versions", ctx.version);
  const boards = path.join(vdir, "boards");

  /**
   * "boards/…" | "system/…" → the real path inside versions/<v>/ (following symlinks); outside → null.
   * A file/folder that does not exist yet (write creates it): realpath of the NEAREST existing parent + the rest.
   */
  function inVersion(rel) {
    if (typeof rel !== "string" || !rel || rel.startsWith("/") || rel.includes("\0") || rel.split(/[\\/]/).includes("..")) return null;
    const abs = path.join(vdir, rel);
    if (!inside(vdir, abs)) return null;
    let base = abs;
    const rest = [];
    while (!fs.existsSync(base)) {
      if (!inside(vdir, base) || base === vdir) return null;
      rest.unshift(path.basename(base));
      base = path.dirname(base);
    }
    let real;
    try { real = path.join(fs.realpathSync(base), ...rest); } catch { return null; }
    return inside(fs.realpathSync(vdir), real) ? { abs: real, rel } : null;
  }
  function inSource(rel) {
    const ok = safeSrcPath(rel, source);
    if (!ok) return null;
    try {
      const real = fs.realpathSync(path.join(source.path, ok));
      return inside(fs.realpathSync(source.path), real) ? { abs: real, rel: ok } : null;
    } catch { return null; }
  }
  const resolveRead = (p) => (String(p).startsWith("src:") ? inSource(String(p).slice(4)) : inVersion(p));
  const srcArea = source ? `"src:<${source.roots.join("|")}>/…"` : "";
  function resolveWrite(p) {
    const r = inVersion(p);
    return r && writableRel(r.rel) ? r : null;
  }
  const writeAtomic = (abs, content) => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, abs);
  };
  const OUT_OF_SCOPE = T("outOfScope", { version: ctx.version, srcArea });
  const blockedContent = (rel, content) => contentIssue(rel, content, { lang });

  function walk(dir, fn, skip = (n) => n.startsWith(".") || n === "node_modules") {
    if (!fs.existsSync(dir)) return;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip(d.name)) continue;
      const a = path.join(dir, d.name);
      if (d.isDirectory()) walk(a, fn, skip); else if (d.isFile()) fn(a);
    }
  }
  function screens() {
    const out = [];
    walk(boards, (a) => {
      if (!a.endsWith(".meta.json")) return;
      const id = path.relative(boards, a).replace(/\.meta\.json$/, "").split(path.sep).join("/");
      if (id.split("/").some((s) => s.startsWith("_"))) return;
      let m = {};
      try { m = JSON.parse(fs.readFileSync(a, "utf8")); } catch { /* broken meta — still listed */ }
      out.push({ id, meta: m });
    });
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
  const metaOf = (entry) => { try { return JSON.parse(fs.readFileSync(path.join(boards, `${entry}.meta.json`), "utf8")); } catch { return null; } };
  const thread = () => loadThread(threadsDir, ctx.threadId);
  const validEntry = (e) => isValidEntryId(e) && fs.existsSync(path.join(boards, `${e}.tsx`));

  const tools = [
    {
      name: "list",
      description: T("toolList"),
      shape: { what: z.enum(["screens", "scenarios", "files", "system", "threads"]), entry: z.string().optional().describe(T("paramEntry")) },
      async handler({ what, entry = ctx.entry }) {
        if (what === "screens") return text(screens().slice(0, LIST_MAX).map((s) => T("listScreen", { id: s.id, title: s.meta.title ?? "?", scenarios: s.meta.scenarios?.length ?? 0, option: s.meta.option ? `${s.meta.option.name}` : null })).join("\n") || T("noScreens"));
        if (what === "system") { const out = []; walk(path.join(vdir, "system"), (a) => out.push(path.relative(vdir, a).split(path.sep).join("/"))); return text(out.sort().slice(0, LIST_MAX).join("\n")); }
        if (!validEntry(entry)) return fail(T("noScreenUseList", { entry, version: ctx.version }));
        if (what === "scenarios") return text((metaOf(entry)?.scenarios ?? []).map((s) => `${s.id} — ${s.title ?? ""}${s.desc ? `: ${s.desc}` : ""}`).join("\n") || T("noScenarios"));
        if (what === "files") return text([".tsx", ".meta.json", ".behavior.md", ".tech.md"].map((x) => `boards/${entry}${x}`).filter((r) => fs.existsSync(path.join(vdir, r))).join("\n"));
        const ts = (await listThreads(threadsDir, entry, ctx.version)).map((t) => T("listThread", { id: t.id, title: t.title, status: t.status, messages: t.messages?.length ?? 0 }));
        return text(ts.join("\n") || T("noThreads"));
      },
    },
    {
      name: "read",
      description: T("toolRead", { max: READ_LINES, version: ctx.version, srcArea, label: source?.label ?? null }),
      shape: { path: z.string(), from: z.number().int().min(1).optional(), lines: z.number().int().min(1).max(READ_LINES).optional() },
      async handler({ path: p, from = 1, lines = READ_LINES }) {
        const r = resolveRead(p);
        if (!r) return fail(OUT_OF_SCOPE);
        let all;
        try { all = fs.readFileSync(r.abs, "utf8").split("\n"); } catch { return fail(T("noFile", { path: p })); }
        const end = Math.min(all.length, from - 1 + lines);
        const body = all.slice(from - 1, end).map((l, i) => `${String(from + i).padStart(5)}│${l}`).join("\n");
        return text(end < all.length ? `${body}\n${T("moreLines", { left: all.length - end, from: end + 1 })}` : body);
      },
    },
    {
      name: "search",
      description: T("toolSearch", { max: SEARCH_MAX, label: source?.label ?? null }),
      shape: { pattern: z.string().min(1).max(200), in: (source ? z.enum(["version", "source"]) : z.enum(["version"])).optional(), glob: z.string().max(60).optional() },
      async handler({ pattern, in: where = "version", glob }) {
        // Plain lowercase text, no regex: a regex from the model can backtrack catastrophically → hangs the whole studio server.
        const needle = pattern.toLowerCase();
        const re = { test: (l) => l.toLowerCase().includes(needle) };
        const g = glob ? new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*+/g, ".*").replace(/\?/g, ".")}$`) : null;
        const hits = [];
        let total = 0;
        const scan = (abs, rel, anyType = false) => {
          if (g && !g.test(path.basename(rel))) return;
          if (!anyType && !/\.(tsx?|mjs|js|json|md|css|sql)$/.test(rel)) return;
          let lines;
          try { lines = fs.readFileSync(abs, "utf8").split("\n"); } catch { return; }
          lines.forEach((l, i) => { if (re.test(l)) { total++; if (hits.length < SEARCH_MAX) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 160)}`); } });
        };
        if (where === "source") {
          if (!source) return fail(T("noSource"));
          // The file types the project declares (safeSrcPath) — no extra filter on the boards' extensions.
          for (const r of source.roots) walk(path.join(source.path, r), (a) => { const rel = path.relative(source.path, a).split(path.sep).join("/"); if (safeSrcPath(rel, source)) scan(a, `src:${rel}`, true); });
        } else {
          walk(vdir, (a) => { const rel = path.relative(vdir, a).split(path.sep).join("/"); if (/^(boards|system)\//.test(rel)) scan(a, rel); });
        }
        if (!hits.length) return text(T("notFound", { text: pattern }));
        return text(hits.join("\n") + (total > hits.length ? `\n${T("moreResults", { left: total - hits.length })}` : ""));
      },
    },
    {
      name: "read_thread",
      description: T("toolReadThread", { page: THREAD_PAGE }),
      shape: { from: z.number().int().min(1).optional() },
      async handler({ from = 1 }) {
        const t = await thread();
        if (!t) return fail(T("threadUnreadable"));
        const refs = allRefs(t);
        const msgs = t.messages.slice(from - 1, from - 1 + THREAD_PAGE);
        const body = msgs.map((m, i) => T("threadMessage", {
          index: from + i,
          who: m.role === "claude" ? "Claude" : m.author,
          text: textWithThreadMarks(t, m, refs),
          refs: refs.filter((r) => r.messageId === m.id).map((r) => ({ n: r.n, removed: !!r.removed, scenario: r.scenario, viewport: r.viewport, entry: r.entry ?? null, redrawn: !!r.redrawn })),
          images: m.images ?? [],
        })).join("\n\n");
        const next = from - 1 + THREAD_PAGE;
        return text((body || T("noMoreMessages")) + (next < t.messages.length ? `\n${T("moreMessages", { left: t.messages.length - next, from: next + 1 })}` : ""));
      },
    },
    {
      name: "view_frame",
      description: T("toolViewFrame"),
      shape: { entry: z.string().optional(), scenario: z.string().optional().describe(T("paramScenario")), viewport: z.enum(["desktop", "mobile"]).optional(), part: z.enum(["top", "full"]).optional() },
      async handler({ entry = ctx.entry, scenario, viewport = "desktop", part = "top" }) {
        if (!validEntry(entry)) return fail(T("noScreenIn", { entry, version: ctx.version }));
        const r = await shots.frame({ version: ctx.version, entry, scenario, viewport, part });
        return { content: [image(r.png), { type: "text", text: T("frameCaption", { entry, scenario, viewport, height: r.height, errors: r.errors }) }] };
      },
    },
    {
      name: "view_region",
      description: T("toolViewRegion"),
      shape: { n: z.number().int().min(1) },
      async handler({ n }) {
        const t = await thread();
        const ref = t && allRefs(t).find((r) => r.n === n);
        if (!ref) return fail(T("noMark", { n }));
        if (ref.removed) return fail(T("markRemoved", { n }));
        const r = await shots.region({ version: ctx.version, entry: ref.entry ?? t.entry, ref }); // a mark on an option → shoot the option
        return { content: [image(r.png), { type: "text", text: T("regionCaption", { n, scenario: ref.scenario, viewport: ref.viewport, x: ref.rect.x, y: ref.rect.y, w: ref.rect.w, h: ref.rect.h, texts: r.texts }) }] };
      },
    },
    {
      name: "view_image",
      description: T("toolViewImage"),
      shape: { id: z.string() },
      async handler({ id }) {
        const t = await thread();
        if (!isUploadId(id) || !t?.messages.some((m) => (m.images ?? []).includes(id))) return fail(T("imageNotInThread", { id }));
        let buf;
        try { buf = fs.readFileSync(path.join(uploadsDir, id)); } catch { return fail(T("imageGone")); }
        if (buf.length <= IMAGE_SEND_MAX) return { content: [image(buf, UPLOAD_MIME[id.split(".").pop()])] };
        // The API takes images up to 5 MB (attachments may be up to 10 MB) → shrink; 1568 px is the size Claude reads best.
        const mb = (buf.length / 1024 / 1024).toFixed(1);
        try {
          return { content: [image(await shots.shrink(buf), "image/jpeg"), { type: "text", text: T("imageShrunk", { mb }) }] };
        } catch (e) {
          return fail(T("imageTooBig", { mb, error: String(e?.message ?? e).slice(0, 200) }));
        }
      },
    },
    {
      name: "locate",
      description: T("toolLocate"),
      shape: { entry: z.string().optional(), scenario: z.string(), viewport: z.enum(["desktop", "mobile"]), text: z.string().min(1) },
      async handler({ entry = ctx.entry, scenario, viewport, text: q }) {
        if (!validEntry(entry)) return fail(T("noScreen", { entry }));
        const hits = await shots.locate({ version: ctx.version, entry, scenario, viewport, text: q });
        // The mark syntax follows the project's language (@mark / @khoanh); thread-core parses both.
        const mark = T("markName");
        return text(hits.length ? hits.map((h) => `${h.tag} "${h.text}" → @${mark}(${scenario || "-"}, ${viewport}, ${h.x}, ${h.y}, ${h.w}, ${h.h})`).join("\n") : T("notFound", { text: q }));
      },
    },
    {
      name: "edit",
      description: T("toolEdit", { version: ctx.version }),
      shape: { path: z.string(), old: z.string().min(1), new: z.string() },
      async handler({ path: p, old, new: neu }) {
        const r = resolveWrite(p);
        if (!r) return fail(T("cannotEdit", { path: p, version: ctx.version }));
        let s;
        try { s = fs.readFileSync(r.abs, "utf8"); } catch { return fail(T("noFileUseWrite", { path: p })); }
        const count = s.split(old).length - 1;
        if (count !== 1) return fail(count ? T("editAmbiguous", { count }) : T("editNotFound"));
        const next = s.replace(old, () => neu);
        const blocked = blockedContent(r.rel, next);
        if (blocked) return fail(blocked);
        writeAtomic(r.abs, next);
        return text(T("edited", { path: p }));
      },
    },
    {
      name: "write",
      description: T("toolWrite", { version: ctx.version }),
      shape: { path: z.string(), content: z.string() },
      async handler({ path: p, content }) {
        const r = resolveWrite(p);
        if (!r) return fail(T("cannotWrite", { path: p, version: ctx.version }));
        const blocked = blockedContent(r.rel, content);
        if (blocked) return fail(blocked);
        writeAtomic(r.abs, content);
        return text(T("written", { path: p, lines: content.split("\n").length }));
      },
    },
    {
      name: "check",
      description: T("toolCheck"),
      shape: { what: z.enum(["typecheck", "lint", "spec"]), entry: z.string().optional(), kind: z.enum(["behavior", "tech"]).optional() },
      async handler({ what, entry, kind = "behavior" }) {
        // The version only (the agent cannot edit the studio UI — errors there are not its job).
        if (what === "typecheck") { const r = await checks.typecheck(root, ctx.version, { studio: false, lang }); return r.ok ? text(r.out || T("typecheckClean")) : fail(r.out); }
        if (what === "lint") {
          // Only the thread's screen by default — errors on other screens (someone else is editing them) are not this turn's job.
          if (entry && !validEntry(entry)) return fail(T("noScreen", { entry }));
          const ids = entry ? [entry] : design ? screens().map((s) => s.id) : [ctx.entry]; // a whole-design turn checks every screen
          const r = checks.lint(root, ctx.version, ids);
          if (r.skipped) return text(T("lintOff"));
          return r.ok ? text(T("lintClean")) : fail(T("lintFailed", { count: r.issues.length, issues: r.issues.slice(0, 40).join("\n") }));
        }
        const e = entry ?? ctx.entry;
        if (!validEntry(e)) return fail(T("noScreen", { entry: e }));
        if (!fs.existsSync(path.join(boards, `${e}.${kind}.md`))) return fail(T("noSpecFile", { path: `boards/${e}.${kind}.md` }));
        const { png, report: r } = await shots.specPage({ version: ctx.version, entry: e, kind });
        const bad = r.badDiagrams.length || r.badEmbeds.length || r.errs.length;
        const msg = T("specReport", { diagrams: r.diagrams, badDiagrams: r.badDiagrams, embeds: r.embeds, badEmbeds: r.badEmbeds, rules: r.rules, errors: r.errs });
        return { content: [image(png), { type: "text", text: msg }], ...(bad ? { isError: true } : {}) };
      },
    },
    {
      name: "rules",
      description: T("toolRules", { topics: topics.join(", ") }),
      shape: { topic: z.string() },
      async handler({ topic }) {
        const file = rules.get(topicOf(topic));
        if (!file) return fail(T("unknownTopic", { topics: topics.join(", ") }));
        return text(fs.readFileSync(file, "utf8"));
      },
    },
  ];
  return tools;
}
