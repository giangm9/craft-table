// "@ds" (the design system) resolves BY THE VERSION of the importing file: a board in versions/<v>/ uses
// versions/<v>/system — a new version can change buttons/colours without touching an old one. Files outside
// versions/ (the studio UI) use the design system of the LIVE version (versions/index.json.live; index unreadable →
// the first version that has a version.json — lib/versions.mjs liveVersion).
// The plugin's errors show in a board's frame (Vite's error) and in Claude's checks: they follow the PROJECT
// language, given as dsResolvePlugin(rootDir, { lang }) — texts in lib/i18n/data.mjs.
import path from "node:path";
import { cssDangers } from "./css-guard.mjs";
import { dataText } from "./i18n/data.mjs";
import { liveVersion } from "./versions.mjs";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * Target of "@ds" / "@ds-css" for an importer. Paths use "/" (Vite normalizes them so).
 * live = null (live version unknown) → a file outside versions/ has no target: null.
 */
export function dsTarget(importer, root, live) {
  const clean = String(importer ?? "").split("?")[0];
  const pre = `${root}/versions/`;
  let v = live;
  if (clean.startsWith(pre)) {
    const seg = clean.slice(pre.length).split("/")[0];
    if (ID_RE.test(seg)) v = seg;
  }
  if (!v) return null;
  const sys = `${root}/versions/${v}/system`;
  return { ds: `${sys}/components/index.ts`, css: `${sys}/tokens.css` };
}

/** Creating/deleting files in versions/ (creating/deleting a version = a few hundred files) → skip HMR. Vite runs in
 *  middleware mode, so every "reload" applies to EVERY open page (typed text lost, board position lost). Editing a
 *  file still updates. */
export function ignoreHot(file, type, root, inGraph = false) {
  // A temp write + rename over the old file (co-editing, adopting an option) also reports "create": a file already
  // in the module graph (used by a frame) must update like a normal edit.
  if (type === "create" && inGraph) return false;
  return type !== "update" && String(file).startsWith(`${root}/versions/`);
}

/**
 * Vite plugin replacing the static aliases "@ds" / "@ds/*" / "@ds-css".
 * @param {string} rootDir the project folder
 * @param {{ lang?: string }} [opts] lang: the project's language ("en" | "vi", default "en") — of its error texts
 */
export function dsResolvePlugin(rootDir, { lang = "en" } = {}) {
  const root = rootDir.split(path.sep).join("/");
  /** @param {string} key @param {Record<string, unknown>} params */
  const say = (key, params) => dataText(lang, key, params);
  return {
    name: "craft-table:ds-by-version",
    enforce: "pre",
    async resolveId(id, importer, opts) {
      if (id !== "@ds" && id !== "@ds-css" && !id.startsWith("@ds/")) return null;
      const t = dsTarget(importer, root, liveVersion(rootDir));
      if (!t) throw new Error(say("dsNoLive", { root }));
      if (id === "@ds") return t.ds;
      if (id === "@ds-css") return t.css;
      // "@ds/x" → let Vite add the extension (.ts/.tsx).
      return this.resolve(`${path.posix.dirname(t.ds)}/${id.slice(4)}`, importer, { ...opts, skipSelf: true });
    },
    // CSS in versions/ goes through Tailwind INSIDE the server: @plugin/@config = running a JS/TS file with the
    // server's rights. Blocked here (before Tailwind — this plugin comes first, enforce "pre") to cover both Claude
    // and people editing through the editor.
    transform(code, id) {
      const file = String(id).split("?")[0];
      if (!file.endsWith(".css") || !file.startsWith(`${root}/versions/`)) return null;
      const bad = cssDangers(code);
      if (bad.length) throw new Error(say("dsCssBlocked", { file: file.slice(root.length + 1), found: bad.join(", ") }));
      return null;
    },
    hotUpdate({ type, file, modules }) {
      if (ignoreHot(file, type, root, (modules?.length ?? 0) > 0)) return [];
    },
  };
}
