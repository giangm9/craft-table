import { test } from "node:test";
import assert from "node:assert/strict";
import { writableRel, contentIssue, WRITABLE_EXT } from "./write-guard.mjs";

test("writableRel: boards/ and system/ files of an editable type only", () => {
  for (const ok of ["boards/screens/a.tsx", "boards/screens/a.meta.json", "boards/_kit/x.ts", "system/tokens.css", "system/components/Button.tsx", "boards/screens/a.behavior.md"]) assert.equal(writableRel(ok), true, ok);
  for (const no of ["version.json", "tsconfig.json", "boards/version.json", "system/tsconfig.json", "boards/shots/a.webp", "boards/run.sh", "other/a.tsx", "../boards/a.tsx", "/etc/passwd", "boards/../x.tsx", "boards/a\0.tsx", "", null, 5]) assert.equal(writableRel(no), false, String(no));
  assert.ok(WRITABLE_EXT.test("a.css"));
});

test("contentIssue: CSS that makes Tailwind load or run another file is refused, plain CSS is fine", () => {
  assert.equal(contentIssue("system/tokens.css", ":root { --a: 1px; }"), null);
  assert.match(contentIssue("system/x.css", '@plugin "./evil.js";') ?? "", /plugin/i);
  assert.equal(contentIssue("boards/a.tsx", '@plugin "x"'), null, "only CSS is checked for directives");
});
