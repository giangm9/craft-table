import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VIETNAMESE, gateFiles, isExempt, offenders } from "./i18n-gate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const tmp = (name, text) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gate-")), name);
  fs.writeFileSync(f, text);
  return f;
};

test("VIETNAMESE: every Vietnamese letter with a diacritic, both cases, đ/Đ; not plain ASCII or typography", () => {
  const lower = "àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ";
  for (const c of lower + lower.toUpperCase()) assert.ok(VIETNAMESE.test(c), `${c} U+${c.codePointAt(0).toString(16)}`);
  for (const s of ["plain English", "a × b – c … → · “q” ‘s’ ©", "naïve ü ñ ç ß", "0123 {}[]"]) assert.ok(!VIETNAMESE.test(s), s);
});

test("offenders: a Vietnamese line is reported with its file and line number; plain English passes", () => {
  const f = tmp("planted.mjs", "// fine\nconst a = 1;\nconst msg = \"không có\"; // planted\nconst b = 2;\n");
  const hits = offenders([f]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 3);
  assert.match(hits[0].text, /không có/);
  assert.equal(path.resolve(ROOT, hits[0].file), f);
  assert.deepEqual(offenders([tmp("english.tsx", "export const T = { send: \"Send\" };\n// A comment.\n")]), []);
});

test("exempt paths are skipped: tests, dictionaries, Vietnamese rules, the legacy-values module", () => {
  for (const p of ["studio/lib/x.test.mjs", "tests/a.test.mjs", "studio/src/i18n/threads.ts", "studio/src/i18n/sub/x.ts", "studio/lib/i18n/server.mjs", "studio/agent-rules/vi/khoanh.md", "studio/lib/legacy-values.mjs"]) assert.ok(isExempt(p), p);
  for (const p of ["studio/lib/i18n.mjs", "studio/lib/i18n-gate.mjs", "studio/src/main.tsx", "studio/agent-rules/en/khoanh.md", "studio/agent-rules/khoanh.md", "bin/craft-table.mjs", "studio/lib/legacy-values.test.mjs.bak"]) assert.ok(!isExempt(p), p);
  // Real files full of Vietnamese, all exempt → nothing reported.
  assert.deepEqual(offenders([path.join(ROOT, "studio/lib/legacy-values.mjs"), path.join(ROOT, "studio/lib/legacy-values.test.mjs")]), []);
});

test("gateFiles: the package's files under studio/ and bin/ (git), never node_modules", () => {
  const files = gateFiles(ROOT);
  for (const f of ["studio/server.mjs", "bin/craft-table.mjs", "studio/src/main.tsx"]) assert.ok(files.includes(f), f);
  assert.ok(files.every((f) => f.startsWith("studio/") || f.startsWith("bin/")), "only studio/ and bin/");
  assert.ok(!files.some((f) => f.includes("node_modules")));
});

test("the gate's own source passes the gate", () => {
  assert.deepEqual(offenders([path.join(import.meta.dirname, "i18n-gate.mjs")]), []);
});
