import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProject, toolBase, writeDesktop } from "./project.mjs";

// Every folder a test makes goes in one folder per run, removed after each test and at the end.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ct-proj-"));
afterEach(() => { for (const n of fs.readdirSync(ROOT)) fs.rmSync(path.join(ROOT, n), { recursive: true, force: true }); });
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function dir(config) {
  const d = fs.mkdtempSync(path.join(ROOT, "t-"));
  if (config !== undefined) fs.writeFileSync(path.join(d, "craft-table.json"), typeof config === "string" ? config : JSON.stringify(config));
  return d;
}

test("loadProject: reads craft-table.json from CRAFT_PROJECT, else the working directory; fills defaults", () => {
  const d = dir({ name: "Acme" });
  const p = loadProject({ cwd: "/nowhere", env: { CRAFT_PROJECT: d } });
  assert.equal(p.dir, d);
  assert.deepEqual(p.config, { name: "Acme", description: "", language: "en", logo: null, source: null, lint: { plainLanguage: false }, externalOrigins: [], desktop: { w: 1280, h: 800 } });
  assert.equal(loadProject({ cwd: d, env: {} }).dir, d);
});

test("loadProject: missing or broken config → error that says how to start a project", () => {
  assert.throws(() => loadProject({ cwd: dir(), env: {} }), /craft-table\.json.*craft-table init/s);
  assert.throws(() => loadProject({ cwd: dir("{ nope"), env: {} }), /craft-table\.json/);
  assert.throws(() => loadProject({ cwd: dir({ description: "x" }), env: {} }), /name/);
  assert.throws(() => loadProject({ cwd: dir({ name: "A", language: "fr" }), env: {} }), /language/);
});

test("loadProject: source repo (optional) → absolute path, label, allowed folders and file types", () => {
  const d = dir({ name: "A", language: "vi", source: { path: "../app" }, lint: { plainLanguage: true } });
  const p = loadProject({ cwd: d, env: {} });
  assert.deepEqual(p.config.source, { path: path.resolve(d, "../app"), label: "app", roots: ["src"], extensions: ["ts", "tsx", "js", "jsx", "mjs", "md", "sql"] });
  assert.equal(p.config.language, "vi");
  assert.equal(p.config.lint.plainLanguage, true);
  const custom = loadProject({ cwd: dir({ name: "A", source: { path: "/x/y", label: "web", roots: ["src", "docs"], extensions: ["ts"] } }), env: {} });
  assert.deepEqual(custom.config.source, { path: "/x/y", label: "web", roots: ["src", "docs"], extensions: ["ts"] });
  // Folders must stay inside the source repo.
  assert.throws(() => loadProject({ cwd: dir({ name: "A", source: { path: "/x", roots: ["../secrets"] } }), env: {} }), /roots/);
});

test("loadProject: logo is a path the project serves (public/), or nothing", () => {
  assert.equal(loadProject({ cwd: dir({ name: "A", logo: "/icons/logo.png" }), env: {} }).config.logo, "/icons/logo.png");
  assert.throws(() => loadProject({ cwd: dir({ name: "A", logo: "https://evil.example/x.png" }), env: {} }), /logo/);
  assert.throws(() => loadProject({ cwd: dir({ name: "A", logo: "/../x.png" }), env: {} }), /logo/);
});

test("loadProject: externalOrigins — other sites boards may load from (Claude's screenshots allow only these)", () => {
  assert.deepEqual(loadProject({ cwd: dir({ name: "A", externalOrigins: ["https://avatars.example", "http://localhost:9000"] }), env: {} }).config.externalOrigins, ["https://avatars.example", "http://localhost:9000"]);
  for (const bad of ["https://avatars.example/path", "avatars.example", "ftp://x.example", 42]) {
    assert.throws(() => loadProject({ cwd: dir({ name: "A", externalOrigins: [bad] }), env: {} }), /externalOrigins/, String(bad));
  }
  assert.throws(() => loadProject({ cwd: dir({ name: "A", externalOrigins: "https://a.example" }), env: {} }), /externalOrigins/);
});

test("toolBase: URL prefix for the tool's own files — inside the project → plain path, outside → /@fs", () => {
  assert.equal(toolBase("/p/node_modules/craft-table", "/p"), "/node_modules/craft-table");
  assert.equal(toolBase("/w/craft-table", "/w/craft-table/example"), "/@fs/w/craft-table");
  assert.equal(toolBase("/w/craft-table", "/w/acme"), "/@fs/w/craft-table");
});

test("temp folders: no test leaves one behind", () => {
  assert.deepEqual(fs.readdirSync(ROOT), []);
});

test("loadProject: \"desktop\" sets the size of every desktop frame; a wrong one is an error that says what is allowed", () => {
  assert.deepEqual(loadProject({ cwd: dir({ name: "A", desktop: { width: 1920, height: 1080 } }), env: {} }).config.desktop, { w: 1920, h: 1080 });
  assert.throws(() => loadProject({ cwd: dir({ name: "A", desktop: { width: 100, height: 1080 } }), env: {} }), /desktop.*width.*height/s);
});

test("writeDesktop: sets or removes the size in craft-table.json, keeps every other key, and the file reads back", () => {
  const d = dir({ name: "Acme", language: "vi", lint: { plainLanguage: true } });
  writeDesktop(d, { w: 1920, h: 1080 });
  const raw = JSON.parse(fs.readFileSync(path.join(d, "craft-table.json"), "utf8"));
  assert.deepEqual(raw, { name: "Acme", language: "vi", lint: { plainLanguage: true }, desktop: { width: 1920, height: 1080 } });
  assert.deepEqual(loadProject({ cwd: d, env: {} }).config.desktop, { w: 1920, h: 1080 });
  writeDesktop(d, null);
  assert.equal("desktop" in JSON.parse(fs.readFileSync(path.join(d, "craft-table.json"), "utf8")), false, "null → back to the default (the key goes)");
  assert.ok(fs.readFileSync(path.join(d, "craft-table.json"), "utf8").endsWith("\n"));
});
