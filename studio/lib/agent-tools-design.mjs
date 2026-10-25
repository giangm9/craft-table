// The extra tools of a WHOLE-DESIGN turn (agent.mjs adds them to the base set of agent-tools.mjs):
//   replace  find-and-replace across many files — dry run first, all or nothing, the same write rules as edit / write
//   browse   Puppeteer: look at many frames (pictures, heights, every problem the page reports, a check run inside the page),
//            or at every scenario of every screen as a report of what is broken
//   run      a shell command in the sandbox (sandbox.mjs) — only when the machine has one
// Each tool: { name, description, shape (zod), handler(args) → { content: [...], isError? } }, like the base tools.
// Every text Claude reads here follows the PROJECT language (lib/i18n/agent.mjs).
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isValidEntryId } from "./entries.mjs";
import { bulkReplace } from "./bulk-edit.mjs";
import { writableRel, contentIssue } from "./write-guard.mjs";
import { normalizeLang, translate } from "./i18n.mjs";
import AGENT from "./i18n/agent.mjs";

export const DESIGN_TOOL_NAMES = ["replace", "browse", "run"];

const MAX_FILES = 600;        // files one replace looks at
const MAX_FILE_BYTES = 1_500_000;
const MAX_FRAMES = 40;        // frames one browse call may list
const MAX_ALL_FRAMES = 600;   // frames browse all: true goes over
const MAX_PICTURES = 6;
const BROWSE_PARALLEL = 3;
const RUN_MAX_S = 300, RUN_DEFAULT_S = 120;
const OUT_MAX = 12_000;       // characters of command output given back

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });
const image = (buf) => ({ type: "image", data: Buffer.from(buf).toString("base64"), mimeType: "image/png" });
const plural = (n, one, many) => (n === 1 ? one : many);

/** "boards/**\/*.tsx" → a RegExp over a whole relative path (`**` any depth, `*` inside one folder, `?` one character). */
export function globToRegExp(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = esc.replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, "(?:.*/)?");
  return new RegExp(`^${body}$`);
}

/**
 * deps: { root, ctx: { version, threadId, entry }, shots, sandbox (null = no `run` tool), lang }.
 * A design turn holds the whole version (agent-queue.mjs), so nobody else is writing while these tools run.
 */
export function createDesignTools({ root, ctx, shots, sandbox = null, lang = "en" }) {
  const l = normalizeLang(lang) ?? "en";
  const T = (key, params) => translate(AGENT, l, key, params);
  const vdir = path.join(root, "versions", ctx.version);
  const boards = path.join(vdir, "boards");

  const walk = (dir, fn) => {
    if (!fs.existsSync(dir)) return;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name.startsWith(".") || d.name === "node_modules") continue;
      const a = path.join(dir, d.name);
      if (d.isDirectory()) walk(a, fn); else if (d.isFile()) fn(a);
    }
  };
  const rel = (abs) => path.relative(vdir, abs).split(path.sep).join("/");
  const validEntry = (e) => isValidEntryId(e) && fs.existsSync(path.join(boards, `${e}.tsx`));
  const screens = () => {
    const out = [];
    walk(boards, (a) => {
      if (!a.endsWith(".meta.json")) return;
      const id = path.relative(boards, a).replace(/\.meta\.json$/, "").split(path.sep).join("/");
      if (id.split("/").some((s) => s.startsWith("_"))) return;
      let m = {};
      try { m = JSON.parse(fs.readFileSync(a, "utf8")); } catch { /* broken meta — the screen is still listed */ }
      out.push({ id, meta: m });
    });
    return out.sort((a, b) => a.id.localeCompare(b.id));
  };
  const writeAtomic = (abs, content) => {
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, abs);
  };

  const replace = {
    name: "replace",
    description: T("toolReplace", { version: ctx.version, max: MAX_FILES }),
    shape: {
      pattern: z.string().min(1).max(500),
      replacement: z.string().max(2000),
      regex: z.boolean().optional(),
      ignore_case: z.boolean().optional(),
      paths: z.string().max(200).optional(),
      dry_run: z.boolean().optional(),
    },
    async handler({ pattern, replacement, regex = false, ignore_case = false, paths, dry_run = true }) {
      const only = paths ? globToRegExp(paths) : null;
      const files = [];
      let tooMany = false;
      for (const dir of ["boards", "system"]) {
        walk(path.join(vdir, dir), (abs) => {
          const r = rel(abs);
          if (!writableRel(r) || (only && !only.test(r))) return;
          try { if (fs.statSync(abs).size > MAX_FILE_BYTES) return; } catch { return; }
          if (files.length >= MAX_FILES) { tooMany = true; return; }
          files.push({ rel: r, content: fs.readFileSync(abs, "utf8") });
        });
      }
      if (tooMany) return fail(T("replaceTooMany", { max: MAX_FILES }));
      if (!files.length) return text(T("replaceNoFiles", { paths: paths ?? "boards/ system/" }));
      const r = await bulkReplace({ files, pattern, replacement, regex, ignoreCase: ignore_case });
      if (!r.ok) return fail(T("replaceBadPattern", { error: r.error }));
      if (!r.files.length) return text(T("replaceNoMatch", { files: files.length }));
      if (dry_run) {
        const shown = r.files.slice(0, 40);
        const list = shown.map((f) => [`${f.rel} — ${f.count}×`, ...f.samples.map((s) => `    ${s.line}: ${s.before}  →  ${s.after}`)].join("\n")).join("\n");
        return text(T("replaceDry", { total: r.total, files: r.files.length, list, more: r.files.length - shown.length }));
      }
      // All or nothing: a half-applied bulk change is harder to understand than a refused one.
      const refused = r.files.map((f) => ({ f, issue: contentIssue(f.rel, f.content, { lang: l }) })).filter((x) => x.issue);
      if (refused.length) return fail(T("replaceRefused", { list: refused.map((x) => `- ${x.f.rel} — ${x.issue}`).join("\n") }));
      for (const f of r.files) writeAtomic(path.join(vdir, f.rel), f.content);
      return text(T("replaceWrote", { total: r.total, files: r.files.length, list: r.files.map((f) => f.rel).join(", ") }));
    },
  };

  const frameShape = z.object({ entry: z.string(), scenario: z.string().optional(), viewport: z.enum(["desktop", "mobile"]).optional(), theme: z.enum(["light", "dark"]).optional() });
  const browse = {
    name: "browse",
    description: T("toolBrowse", { maxFrames: MAX_FRAMES }),
    shape: {
      frames: z.array(frameShape).max(MAX_FRAMES).optional(),
      all: z.boolean().optional(),
      viewport: z.enum(["desktop", "mobile", "both"]).optional(),
      entries: z.string().max(100).optional(),
      theme: z.enum(["light", "dark"]).optional(),
      eval: z.string().max(2000).optional(),
    },
    async handler({ frames, all = false, viewport = "desktop", entries, theme, eval: evalJs }) {
      let list;
      if (all) {
        const only = entries ? globToRegExp(entries) : null;
        const vps = viewport === "both" ? ["desktop", "mobile"] : [viewport];
        list = screens().filter((s) => !only || only.test(s.id))
          .flatMap((s) => (s.meta.scenarios?.length ? s.meta.scenarios : [{ id: "-" }]).flatMap((sc) => vps.map((v) => ({ entry: s.id, scenario: sc.id, viewport: v, theme }))));
        if (list.length > MAX_ALL_FRAMES) list = list.slice(0, MAX_ALL_FRAMES);
      } else {
        if (!frames?.length) return fail(T("browseNoFrames"));
        if (frames.length > MAX_FRAMES) return fail(T("browseTooMany", { max: MAX_FRAMES }));
        for (const f of frames) if (!validEntry(f.entry)) return fail(T("noScreenIn", { entry: f.entry, version: ctx.version }));
        list = frames.map((f) => ({ ...f, viewport: f.viewport ?? viewport, theme: f.theme ?? theme }));
      }
      const withPictures = !all && list.length <= MAX_PICTURES;
      const results = new Array(list.length);
      let next = 0;
      const worker = async () => {
        while (next < list.length) {
          const i = next++;
          const f = list[i];
          try {
            const r = await shots.inspect({ version: ctx.version, entry: f.entry, scenario: f.scenario === "-" ? undefined : f.scenario, viewport: f.viewport, theme: f.theme, evalJs, shot: withPictures });
            results[i] = { f, r };
          } catch (e) {
            results[i] = { f, r: { png: null, height: 0, errors: [String(e?.message ?? e).slice(0, 200)], boardError: true } };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(BROWSE_PARALLEL, list.length) }, worker));
      const problems = (r) => [...(r.boardError ? ["the board did not draw"] : []), ...r.errors, ...(r.evalError ? [`eval: ${r.evalError}`] : [])];
      const lines = results.map(({ f, r }) => T("browseLine", { entry: f.entry, scenario: f.scenario, viewport: f.viewport, height: r.height, problems: problems(r), value: r.value === undefined ? undefined : JSON.stringify(r.value) }));
      const broken = results.filter(({ r }) => problems(r).length);
      const summary = T("browseSummary", { frames: results.length, broken: broken.length });
      // A long list of fine frames is noise: show the broken ones in full, the rest only when the list is short.
      const body = all && results.length > 12 ? broken.map(({ f, r }) => T("browseLine", { entry: f.entry, scenario: f.scenario, viewport: f.viewport, height: r.height, problems: problems(r), value: undefined })) : lines;
      const note = !all && list.length > MAX_PICTURES ? `\n${T("browseNoPictures", { max: MAX_PICTURES })}` : "";
      const content = [{ type: "text", text: `${summary}\n${body.join("\n")}${note}`.trim() }];
      if (withPictures) for (const { r } of results) if (r.png) content.push(image(r.png));
      return { content };
    },
  };

  const run = sandbox && {
    name: "run",
    description: T("toolRun", { version: ctx.version, backend: sandbox.backend, isolated: sandbox.backend !== "process", max: RUN_MAX_S }),
    shape: { command: z.string().min(1).max(8000), timeout_s: z.number().int().min(1).max(RUN_MAX_S).optional() },
    async handler({ command, timeout_s = RUN_DEFAULT_S }) {
      const r = await sandbox.run({ command, timeoutMs: timeout_s * 1000, version: ctx.version });
      const cut = (s) => (s.length > OUT_MAX ? `${s.slice(0, OUT_MAX)}\n${T("runCut")}` : s);
      const parts = [];
      if (r.timedOut) parts.push(T("runTimedOut", { seconds: timeout_s }));
      else parts.push(T("runExit", { code: r.code ?? r.signal ?? "?" }));
      if (r.stdout) parts.push(`stdout:\n${cut(r.stdout)}`);
      if (r.stderr) parts.push(`stderr:\n${cut(r.stderr)}`);
      if (r.truncated) parts.push(T("runCut"));
      parts.push(r.applied.length ? T("runLanded", { list: r.applied.join(", ") }) : T("runLandedNone"));
      if (r.deleted.length) parts.push(T("runDeleted", { list: r.deleted.join(", ") }));
      if (r.rejected.length) parts.push(T("runRefused", { list: r.rejected.map((x) => `- ${x.rel} — ${x.reason}`).join("\n") }));
      if (r.conflicts.length) parts.push(T("runConflicts", { list: r.conflicts.join(", ") }));
      const ok = !r.timedOut && r.code === 0;
      return ok ? text(parts.join("\n")) : fail(parts.join("\n"));
    },
  };

  return [replace, browse, run].filter(Boolean);
}
