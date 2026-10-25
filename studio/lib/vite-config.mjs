// Vite for one project, in middleware mode (studio/server.mjs). The PROJECT folder is the root: boards are served
// from /versions/<v>/… and "@ds" resolves to the design system of the version that imports it (ds-resolve.mjs).
// The tool's own files (studio UI, frame entry) are served from wherever the package lives — usually
// node_modules/craft-table — so that folder is allowed too, and React is deduped so a board and the frame entry
// share one React.
//
// A project needs no node_modules of its own (a folder mounted into the Docker image, a project that never ran
// npm install): whatever the tool depends on and the project cannot resolve — react, lucide-react, tailwindcss… —
// is BORROWED from the tool's folder, so boards, the project's CSS and the studio all use the tool's single copy.
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dsResolvePlugin } from "./ds-resolve.mjs";

// Vite's own test for a bare import ("react", "@scope/pkg/sub") as opposed to a path or a URL.
const BARE_IMPORT = /^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/;

/** Is package `name` installed where files of `dir` find it (dir/node_modules, then each parent's)? */
function installed(name, dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, "node_modules", name, "package.json"))) return true;
    if (path.dirname(d) === d) return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The tool's dependencies that the project cannot resolve itself; they come from the tool's folder. */
export function borrowedPackages(projectDir, toolDir) {
  return Object.keys(readJson(path.join(toolDir, "package.json"))?.dependencies ?? {}).filter((name) => !installed(name, projectDir));
}

/** TypeScript settings for esbuild when the project has not installed the tool: each version's tsconfig extends
 *  "craft-table/tsconfig.base.json", which only resolves where the tool is installed — use the tool's own file. */
function toolTsconfigRaw(projectDir, toolDir) {
  const name = readJson(path.join(toolDir, "package.json"))?.name;
  const base = readJson(path.join(toolDir, "tsconfig.base.json"));
  if (!name || !base || installed(name, projectDir)) return undefined;
  return JSON.stringify({ compilerOptions: base.compilerOptions });
}

/** A resolver (plugin `this`): as usual from the importer; when nothing is found, from the tool's folder. */
function resolveOrFromTool(toolDir) {
  const toolImporter = path.join(toolDir, "package.json");
  return async function (id, importer, opts) {
    return (await this.resolve(id, importer, { ...opts, skipSelf: true }))
      ?? (await this.resolve(id, toolImporter, { ...opts, skipSelf: true }));
  };
}

/** Bare imports from project files that the project cannot resolve come from the tool's folder. */
export function toolDepsPlugin({ projectDir, toolDir, borrowed = [] }) {
  const root = `${projectDir.split(path.sep).join("/")}/`;
  const resolve = resolveOrFromTool(toolDir);
  return {
    name: "craft-table:tool-deps",
    enforce: "pre",
    // plugin-react adds React to resolve.dedupe = "always resolve React from the project folder". A project that
    // borrows React has none there: dedupe only what the project really has, so dedupe and this fallback agree.
    config: {
      order: "post",
      handler(config) {
        if (config.resolve?.dedupe) config.resolve.dedupe = config.resolve.dedupe.filter((p) => !borrowed.includes(p));
      },
    },
    resolveId(id, importer, opts) {
      const file = importer?.split("?")[0];
      if (!file?.startsWith(root) || file.includes("/node_modules/") || !BARE_IMPORT.test(id)) return null;
      return resolve.call(this, id, importer, opts);
    },
  };
}

/** The same fallback as an alias entry for the borrowed packages: unlike plugins, aliases also apply inside
 *  Vite's own resolvers — pre-bundling (optimizeDeps.include) and Tailwind's `@import "tailwindcss"`. */
function borrowAlias(borrowed, toolDir) {
  if (!borrowed.length) return [];
  const names = borrowed.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return [{ find: new RegExp(`^(?:${names})(?:/.*)?$`), replacement: "$&", customResolver: resolveOrFromTool(toolDir) }];
}

/** language: the project's (craft-table.json) — the "@ds" plugin's errors show in boards and in Claude's checks. */
export function viteConfig({ projectDir, toolDir, httpServer, hosts = [], language }) {
  const borrowed = borrowedPackages(projectDir, toolDir);
  const tsconfigRaw = toolTsconfigRaw(projectDir, toolDir);
  return {
    root: projectDir,
    configFile: false,
    appType: "custom",
    clearScreen: false,
    // Borrowing: Vite's cache key (the project's lockfile) knows nothing of the tool's versions — re-bundle on every
    // start (optimizeDeps.force), in data/ with the studio's other working files rather than a node_modules/ the
    // project does not have. Still under a "node_modules" folder: plugins tell dependencies by that path
    // (elsewhere plugin-react would run Babel over the bundled react-dom).
    ...(borrowed.length ? { cacheDir: path.join(projectDir, "data", "node_modules", ".vite") } : {}),
    // A string tsconfigRaw replaces Vite's per-file tsconfig lookup (which would fail on the unresolvable "extends").
    ...(tsconfigRaw ? { esbuild: { tsconfigRaw } } : {}),
    plugins: [dsResolvePlugin(projectDir, { lang: language }), toolDepsPlugin({ projectDir, toolDir, borrowed }), react(), tailwindcss()],
    resolve: {
      dedupe: ["react", "react-dom"].filter((p) => !borrowed.includes(p)),
      alias: borrowAlias(borrowed, toolDir),
    },
    // Pre-bundle every package the studio UI uses in the browser. Two reasons: (1) the studio is installed in
    // node_modules, and Vite does not discover/convert packages imported from there — React would arrive as raw
    // CommonJS; (2) a package discovered mid-session makes Vite reload EVERY open page (losing typed text and the
    // canvas position). vite-config.test.mjs checks this list against the UI's real imports.
    optimizeDeps: {
      force: borrowed.length > 0,
      include: [
        "react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "lucide-react",
        "yjs", "@hocuspocus/provider", "y-codemirror.next", "codemirror", "@codemirror/view", "@codemirror/state",
        "@codemirror/lang-markdown", "@codemirror/lang-javascript", "@codemirror/language", "@lezer/highlight",
        "diff", "mermaid", "marked", "highlight.js/lib/core", "highlight.js/lib/languages/typescript",
        "highlight.js/lib/languages/javascript", "highlight.js/lib/languages/sql", "highlight.js/lib/languages/json",
      ],
    },
    server: {
      middlewareMode: true,
      // No Vite error overlay: a board half-typed in the Code panel (or by Claude) would cover EVERY open page of
      // everyone. Errors show in place instead: a red strip in that board's frame + a line in the Code panel.
      hmr: { server: httpServer, overlay: false },
      allowedHosts: [...hosts, "localhost", "127.0.0.1"],
      fs: { allow: [projectDir, toolDir] },
      // A change to a file outside the module graph makes Vite reload the WHOLE page for everyone. Conversation
      // data, specs (.md), images, version info and per-version tsconfig are announced through our own fs.watch; craft-table.json
      // too (the Settings write it and send studio:project — a page reload would throw away what people are typing).
      watch: { ignored: ["**/craft-table.json", "**/threads/**", "**/*.md", "**/.chat-shots/**", "**/tests/**", "**/refs/**", "**/audit/**", "**/data/**", "**/versions/index.json", "**/versions/*/version.json", "**/versions/*/tsconfig.json", "**/*.meta.json"] },
    },
  };
}

/** The studio's HTML entries reference "/studio/…"; rewrite to where the tool is actually served. */
export const withToolBase = (html, base) => html.replaceAll('src="/studio/', `src="${base}/studio/`);
