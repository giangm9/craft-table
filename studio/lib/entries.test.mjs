import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMeta, entryIdFromPath, isValidEntryId } from "./entries.mjs";

test("isValidEntryId: blocks parent-directory paths and odd characters", () => {
  assert.equal(isValidEntryId("screens/orders/list"), true);
  assert.equal(isValidEntryId("../secrets"), false);
  assert.equal(isValidEntryId("screens/../../x"), false);
  assert.equal(isValidEntryId("/abs"), false);
  assert.equal(isValidEntryId("Có dấu"), false);
});

test("extractMeta: reads the object literal after `export const meta =`", () => {
  const src = `import x from "y";
export const meta = {
  title: "Màu sắc",
  section: "Design system",
  group: "Nền tảng",
  order: 1,
  viewports: ["desktop"],
  desc: "Có {ngoặc} trong chuỗi",
};
export default function A() { return null; }`;
  assert.deepEqual(extractMeta(src), {
    title: "Màu sắc", section: "Design system", group: "Nền tảng", order: 1,
    viewports: ["desktop"], desc: "Có {ngoặc} trong chuỗi",
  });
});

test("extractMeta: no meta, meta that is not a literal, or no title → null", () => {
  assert.equal(extractMeta("export default 1"), null);
  assert.equal(extractMeta("export const meta = makeMeta();"), null);
  assert.equal(extractMeta("export const meta = { group: 'x' };"), null);
});

test("extractMeta: arbitrary code in meta cannot run", () => {
  assert.equal(extractMeta("export const meta = { title: process.exit(1) };"), null);
});

test("entryIdFromPath: drops the .tsx extension, skips files/folders that start with _", () => {
  assert.equal(entryIdFromPath("system/colors.tsx"), "system/colors");
  assert.equal(entryIdFromPath("screens/orders/list/current.tsx"), "screens/orders/list/current");
  assert.equal(entryIdFromPath("_kit/Shell.tsx"), null);
  assert.equal(entryIdFromPath("system/_draft.tsx"), null);
  assert.equal(entryIdFromPath("system/colors.ts"), null);
  assert.equal(entryIdFromPath("Hoa/x.tsx"), null);
});

import { metaRange, stripMeta } from "./entries.mjs";
import { readMeta } from "./meta-io.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SRC = `// Đầu file
import x from "y";
export const meta = {
  title: "Màn } thử", // chú thích có }
  desc: \`chuỗi { lạ }\`,
  scenarios: [{ id: "a", title: "A" }],
};

// Bản vẽ AS-IS
export default function B() { return null; }
`;

test("metaRange / stripMeta: exactly the meta block (including ; and one blank line after), ignoring } in strings/comments", () => {
  const r = metaRange(SRC);
  assert.equal(SRC.slice(r.start, r.start + 17), "export const meta");
  const out = stripMeta(SRC);
  assert.equal(out, `// Đầu file\nimport x from "y";\n// Bản vẽ AS-IS\nexport default function B() { return null; }\n`);
  assert.equal(metaRange("export default 1"), null);
});

test("readMeta: reads <screen>.meta.json when it exists; otherwise reads the meta block in the .tsx", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "meta-"));
  fs.writeFileSync(path.join(d, "a.tsx"), SRC);
  assert.equal(readMeta(path.join(d, "a.tsx")).title, "Màn } thử");
  fs.writeFileSync(path.join(d, "a.meta.json"), JSON.stringify({ title: "Từ json", scenarios: [] }));
  assert.equal(readMeta(path.join(d, "a.tsx")).title, "Từ json");
  fs.writeFileSync(path.join(d, "a.meta.json"), "{ hỏng");
  assert.equal(readMeta(path.join(d, "a.tsx")), null, "broken json → null (the catalog reports 'Missing meta')");
});
