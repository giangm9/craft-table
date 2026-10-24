import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createServer, resolveConfig } from "vite";
import { viteConfig, withToolBase } from "./vite-config.mjs";

const TOOL = path.resolve(import.meta.dirname, "..", "..");

/** A project with one version "main" and one board, and nothing installed: no node_modules here or above. */
function bareProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-bare-"));
  const files = {
    "craft-table.json": JSON.stringify({ name: "Bare" }),
    "versions/index.json": JSON.stringify({ live: "main", order: ["main"] }),
    "versions/main/version.json": JSON.stringify({ id: "main", title: "Main" }),
    // As `craft-table init` writes it: only resolvable where craft-table is installed.
    "versions/main/tsconfig.json": JSON.stringify({ extends: "craft-table/tsconfig.base.json", include: ["boards", "system"] }),
    "versions/main/system/tokens.css": '@import "tailwindcss";\n',
    "versions/main/boards/x.tsx": [
      'import { useState } from "react";',
      'import { Check } from "lucide-react";',
      "export default function X() {",
      "  const [n] = useState(1);",
      "  return <p><Check size={16} />{n}</p>;",
      "}",
    ].join("\n"),
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

/** Every package the studio UI imports in the browser: follow relative imports from the HTML entry modules. */
function browserPackages() {
  const src = path.resolve(import.meta.dirname, "..", "src");
  const seen = new Set(), pkgs = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = fs.readFileSync(file, "utf8");
    // Not after "@" or a letter: a CSS `@import "tailwindcss"` quoted in a text (a dictionary) is not a JS import.
    for (const m of code.matchAll(/(?<![@\w])(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
      const spec = m[1];
      if (spec.startsWith(".")) {
        const base = path.resolve(path.dirname(file), spec);
        const hit = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
        if (hit && /\.(m?js|tsx?)$/.test(hit)) visit(hit);
      } else if (!spec.startsWith("node:") && !spec.startsWith("/")) pkgs.add(spec);
    }
  };
  for (const e of ["main.tsx", "frame-entry.tsx", "spec-entry.tsx", "versions-entry.tsx"]) visit(path.join(src, e));
  return [...pkgs];
}

test("viteConfig: the project folder is the root; the tool folder is readable too; one React for tool + boards", () => {
  const c = viteConfig({ projectDir: "/p", toolDir: "/t", httpServer: {}, hosts: ["studio.example.com"] });
  assert.equal(c.root, "/p");
  assert.equal(c.configFile, false);
  assert.deepEqual(c.server.fs.allow, ["/p", "/t"]);
  assert.deepEqual(c.resolve.dedupe, ["react", "react-dom"]);
  assert.ok(c.server.allowedHosts.includes("studio.example.com") && c.server.allowedHosts.includes("localhost"));
  assert.equal(c.server.middlewareMode, true);
  assert.equal(c.server.hmr.overlay, false);
  assert.deepEqual(c.plugins.flat().map((p) => p?.name).filter(Boolean).slice(0, 1), ["craft-table:ds-by-version"]);
});

test("viteConfig: the \"@ds\" plugin's errors are in the project's language", () => {
  const blocked = (language) => {
    const ds = viteConfig({ projectDir: "/p", toolDir: "/t", httpServer: {}, language }).plugins.find((p) => p.name === "craft-table:ds-by-version");
    try { ds.transform('@plugin "./evil.js";', "/p/versions/main/system/tokens.css"); } catch (e) { return e.message; }
    return "(not blocked)";
  };
  assert.match(blocked("vi"), /bị chặn/);
  assert.match(blocked("en"), /blocked/);
  assert.match(blocked(undefined), /blocked/);
});

test("withToolBase: HTML entry scripts point at the tool's URL", () => {
  const html = '<script type="module" src="/studio/src/main.tsx"></script><link rel="icon" href="/icons/x.png">';
  assert.equal(withToolBase(html, "/node_modules/craft-table"), '<script type="module" src="/node_modules/craft-table/studio/src/main.tsx"></script><link rel="icon" href="/icons/x.png">');
  assert.equal(withToolBase(html, "/@fs/w/craft-table").includes('src="/@fs/w/craft-table/studio/src/main.tsx"'), true);
});

test("viteConfig: every package the studio UI uses in the browser is pre-bundled (installed in node_modules, Vite would not)", () => {
  const include = new Set(viteConfig({ projectDir: "/p", toolDir: "/t", httpServer: {} }).optimizeDeps.include);
  const used = browserPackages();
  assert.ok(used.includes("react-dom/client") && used.includes("yjs"), `scan found ${used.join(", ")}`);
  for (const p of [...used, "react/jsx-runtime", "react/jsx-dev-runtime"]) assert.ok(include.has(p), `not pre-bundled: ${p}`);
});

test("viteConfig: React is deduped to the project's copy only when the project has one; a bare project uses the tool's", async () => {
  const dedupe = async (projectDir) => (await resolveConfig(viteConfig({ projectDir, toolDir: TOOL, httpServer: {} }), "serve")).resolve.dedupe;
  const installed = bareProject();
  fs.symlinkSync(path.join(TOOL, "node_modules"), path.join(installed, "node_modules"));
  const bare = bareProject();
  try {
    assert.ok((await dedupe(installed)).includes("react"));
    // plugin-react adds React to dedupe (= resolve it from the project folder); a bare folder has none to give.
    assert.deepEqual((await dedupe(bare)).filter((p) => p.startsWith("react")), []);
  } finally {
    for (const d of [installed, bare]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("a project with nothing installed: its boards and CSS use the tool's packages, and the same React as the frame entry", { timeout: 120_000 }, async () => {
  const dir = bareProject();
  const boardFile = path.join(dir, "versions", "main", "boards", "x.tsx");
  const config = viteConfig({ projectDir: dir, toolDir: TOOL, httpServer: http.createServer() });
  const server = await createServer(config);
  const env = server.environments.client;
  const resolve = (id, importer, opts) => env.pluginContainer.resolveId(id, importer, opts).then((r) => r?.id);
  try {
    const fromEntry = await resolve("react", path.join(TOOL, "studio", "src", "frame-entry.tsx"));
    assert.ok(fromEntry, "the frame entry resolves react");
    const url = fromEntry.startsWith(`${dir}/`) ? fromEntry.slice(dir.length) : `/@fs${fromEntry}`;
    // Served for real. Also waits for pre-bundling to finish: closing Vite in the middle of it never settles.
    assert.ok(await server.transformRequest(url));
    // Everything was pre-bundled up front, from the tool's folder (no page reload when a package is first used).
    const bundled = Object.keys(env.depsOptimizer.metadata.optimized);
    assert.deepEqual(config.optimizeDeps.include.filter((p) => !bundled.includes(p)), []);
    // …into a node_modules folder: plugins tell dependencies by that path (plugin-react would run Babel on react-dom).
    assert.match(server.config.cacheDir, /\/node_modules\//);

    const board = await server.transformRequest("/versions/main/boards/x.tsx");
    assert.ok(board.code.includes(url), `the board imports another React than ${url}:\n${board.code.slice(0, 600)}`);
    assert.match(board.code, /lucide-react/);
    assert.equal(await resolve("react", boardFile), fromEntry);
    // Any package the tool ships, even one it only has indirectly (react-dom's scheduler), resolves from its folder.
    // (scan mode: plain resolution, without starting a new round of pre-bundling)
    assert.equal(await resolve("scheduler", boardFile, { scan: true }), path.join(TOOL, "node_modules", "scheduler", "index.js"));
    // `@import "tailwindcss"` in the project's own tokens.css: Tailwind resolves it through Vite's resolver.
    assert.match((await server.transformRequest("/versions/main/system/tokens.css")).code, /tailwindcss v4/);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
