import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dsTarget } from "./ds-resolve.mjs";

test("dsTarget: a file inside versions/<v> → that version; outside → the live version", () => {
  const R = "/r";
  assert.deepEqual(dsTarget("/r/versions/ban-2/boards/screens/x.tsx", R, "ban-1"), { ds: "/r/versions/ban-2/system/components/index.ts", css: "/r/versions/ban-2/system/tokens.css" });
  assert.equal(dsTarget("/r/versions/ban-2/system/components/AppShell.tsx", R, "ban-1").ds, "/r/versions/ban-2/system/components/index.ts");
  assert.equal(dsTarget("/r/studio/src/main.tsx", R, "ban-1").ds, "/r/versions/ban-1/system/components/index.ts");
  assert.equal(dsTarget("/r/versions/../x.tsx", R, "ban-1").ds, "/r/versions/ban-1/system/components/index.ts");
  assert.equal(dsTarget(undefined, R, "ban-1").css, "/r/versions/ban-1/system/tokens.css");
  // an importer carrying a Vite query (?v=…) still maps to the right version
  assert.equal(dsTarget("/r/versions/ban-2/boards/a.tsx?t=1", R, "ban-1").ds, "/r/versions/ban-2/system/components/index.ts");
});

test("dsTarget: live version unknown (live null) → a file outside versions/ has no target (null); boards still follow their own version", () => {
  const R = "/r";
  assert.equal(dsTarget("/r/studio/src/main.tsx", R, null), null);
  assert.equal(dsTarget(undefined, R, null), null);
  assert.equal(dsTarget("/r/versions/v2/boards/x.tsx", R, null).ds, "/r/versions/v2/system/components/index.ts");
});

// ── Plugin on a real project (temp folder): the live version is read from the project's versions/ ──
/** versions/<v>/version.json for each version in `released`; an empty folder for `bare`; index.json (raw text) if given. */
function project({ index, released = [], bare = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsr-"));
  for (const v of [...released, ...bare]) fs.mkdirSync(path.join(root, "versions", v), { recursive: true });
  for (const v of released) fs.writeFileSync(path.join(root, "versions", v, "version.json"), "{}");
  if (index !== undefined) {
    fs.mkdirSync(path.join(root, "versions"), { recursive: true });
    fs.writeFileSync(path.join(root, "versions", "index.json"), index);
  }
  return root;
}
const STUDIO_FILE = "/opt/tool/studio/src/main.tsx"; // studio UI: outside the project's versions/
const resolveCtx = { resolve: async (id) => ({ id }) }; // "@ds/x" relies on Vite to add the file extension

test("plugin: the studio UI (outside versions/) uses the design system of the live version in versions/index.json", async () => {
  const root = project({ index: JSON.stringify({ live: "v2", order: ["v2", "v1"] }), released: ["v1", "v2"] });
  const p = dsResolvePlugin(root);
  assert.equal(await p.resolveId("@ds", STUDIO_FILE, {}), `${root}/versions/v2/system/components/index.ts`);
  assert.equal(await p.resolveId("@ds-css", STUDIO_FILE, {}), `${root}/versions/v2/system/tokens.css`);
  assert.deepEqual(await p.resolveId.call(resolveCtx, "@ds/Button", STUDIO_FILE, {}), { id: `${root}/versions/v2/system/components/Button` });
  assert.equal(await p.resolveId("@ds", `${root}/versions/v1/boards/screens/a.tsx`, {}), `${root}/versions/v1/system/components/index.ts`);
  assert.equal(await p.resolveId("react", STUDIO_FILE, {}), null);
});

test("plugin: versions/index.json unreadable (missing, broken, no valid live) → the first version by name that has a version.json", async () => {
  for (const index of [undefined, "{ hỏng", JSON.stringify({ order: ["moi"] }), JSON.stringify({ live: "../x", order: [] })]) {
    const root = project({ index, released: ["moi", "goc"], bare: ["a-chua-co-version-json"] });
    const p = dsResolvePlugin(root);
    assert.equal(await p.resolveId("@ds", STUDIO_FILE, {}), `${root}/versions/goc/system/components/index.ts`, `index.json: ${index}`);
  }
});

test("plugin: a project with no version yet → the studio UI's \"@ds\" fails with a clear error, no guessing; boards in versions/<v>/ still use their own version", async () => {
  for (const root of [project({ bare: ["nhap"] }), project()]) {
    const p = dsResolvePlugin(root, { lang: "vi" });
    for (const id of ["@ds", "@ds-css", "@ds/Button"]) {
      await assert.rejects(p.resolveId.call(resolveCtx, id, STUDIO_FILE, {}), /"@ds".*phiên bản đang chạy.*versions\/index\.json.*version\.json/s, id);
    }
  }
  const root = project({ bare: ["nhap"] });
  assert.equal(await dsResolvePlugin(root).resolveId("@ds", `${root}/versions/nhap/boards/a.tsx`, {}), `${root}/versions/nhap/system/components/index.ts`);
});

import { ignoreHot, dsResolvePlugin } from "./ds-resolve.mjs";

test("the Vite plugin blocks compiling CSS in versions/ that has @plugin/@config (Tailwind would RUN JS/TS files on the server)", () => {
  const p = dsResolvePlugin("/r");
  assert.throws(() => p.transform(`@import "tailwindcss";\n@plugin "./x.ts";`, "/r/versions/ban-1/system/tokens.css?direct"), /@plugin/);
  assert.throws(() => p.transform(`@config "../x.js";`, "/r/versions/ban-2/boards/_kit/a.css"), /@config/);
  assert.equal(p.transform(`@import "tailwindcss";\n.a{}`, "/r/versions/ban-1/system/tokens.css"), null);
  assert.equal(p.transform(`@plugin "x";`, "/r/studio/src/studio.css"), null); // outside versions/: not this layer's job
  assert.equal(p.transform(`export const a = "@plugin";`, "/r/versions/ban-1/boards/a.tsx"), null);
});
test("plugin errors follow the language given (the project's): vi word for word as before; English by default", async () => {
  const root = project();
  const message = async (p, run) => { try { await run(p); } catch (e) { return e.message; } return null; };
  const noLive = (p) => p.resolveId.call(resolveCtx, "@ds", STUDIO_FILE, {});
  assert.equal(await message(dsResolvePlugin(root, { lang: "vi" }), noLive),
    `Không phân giải được "@ds": chưa biết phiên bản đang chạy — ${root}/versions/index.json không đọc được (hoặc thiếu "live") và chưa có thư mục versions/<phiên-bản>/ nào có version.json.`);
  for (const p of [dsResolvePlugin(root), dsResolvePlugin(root, { lang: "en" })]) {
    assert.equal(await message(p, noLive),
      `Can't resolve "@ds": no live version is known — ${root}/versions/index.json can't be read (or has no "live") and no versions/<version>/ folder has a version.json.`);
  }
  const css = (p) => p.transform(`@plugin "./x.ts";\n@config "y.js";`, "/r/versions/ban-1/system/tokens.css?direct");
  assert.equal(await message(dsResolvePlugin("/r", { lang: "vi" }), css),
    'CSS versions/ban-1/system/tokens.css bị chặn: @plugin "./x.ts", @config "y.js" — trong versions/ chỉ được @import "tailwindcss" hoặc "./tệp.css".');
  assert.equal(await message(dsResolvePlugin("/r"), css),
    'CSS versions/ban-1/system/tokens.css blocked: @plugin "./x.ts", @config "y.js" — in versions/ only @import "tailwindcss" or "./file.css" is allowed.');
});

test("ignoreHot: creating/deleting files in versions/ (creating/deleting a version) does not make Vite reload every page; editing a file still updates", () => {
  const R = "/r";
  assert.equal(ignoreHot("/r/versions/ban-2/boards/screens/a.tsx", "create", R), true);
  assert.equal(ignoreHot("/r/versions/ban-2/system/components/x.tsx", "delete", R), true);
  assert.equal(ignoreHot("/r/versions/ban-2/boards/screens/a.tsx", "update", R), false);
  assert.equal(ignoreHot("/r/studio/src/main.tsx", "delete", R), false);
});

test("ignoreHot: a temp-file write + rename (co-editing editor, Adopt this option) over a file the frame IS using → the frame still updates", () => {
  const R = "/r";
  // a rename over the old file → the watcher reports "create"; the file is already a module in the graph → must not be ignored.
  assert.equal(ignoreHot("/r/versions/ban-1/boards/screens/a.tsx", "create", R, true), false);
  // a brand-new file of a just-created version (nothing imports it yet) → still ignored.
  assert.equal(ignoreHot("/r/versions/ban-2/boards/screens/a.tsx", "create", R, false), true);
});
