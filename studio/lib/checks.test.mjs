import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lint } from "./checks.mjs";

function project({ title = "Gọi `useOrders()` ở src/a.ts:12", behavior = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lint-"));
  const b = path.join(root, "versions", "main", "boards", "screens");
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, "a.tsx"), "export default function A() { return null; }\n");
  fs.writeFileSync(path.join(b, "a.meta.json"), JSON.stringify({ title }));
  if (behavior != null) fs.writeFileSync(path.join(b, "a.behavior.md"), behavior);
  return root;
}

test("lint: plain-language rule runs only when the project turns it on (craft-table.json lint.plainLanguage)", () => {
  const root = project();
  const on = lint(root, "main", ["screens/a"], { plainLanguage: true });
  assert.equal(on.ok, false);
  assert.ok(on.issues.length > 0);
  const off = lint(root, "main", ["screens/a"], { plainLanguage: false });
  assert.deepEqual(off, { ok: true, issues: [], skipped: true });
});

test("lint: the project's language picks the vocabulary and the words of the issues (no language → Vietnamese, as before)", () => {
  const root = project({ title: "A banner shows when the API returns 404", behavior: "Intro\n```js\nx\n```\n" });
  const vi = lint(root, "main", ["screens/a"], { plainLanguage: true });
  assert.deepEqual(lint(root, "main", ["screens/a"], { plainLanguage: true, lang: "vi" }), vi);
  assert.ok(vi.issues.includes("screens/a title: banner"), vi.issues.join("\n"));
  assert.ok(vi.issues.includes("screens/a.behavior.md:2: khối code (tab Hành vi không chứa code)"), vi.issues.join("\n"));
  const en = lint(root, "main", ["screens/a"], { plainLanguage: true, lang: "en" });
  assert.ok(!en.issues.includes("screens/a title: banner"), "banner is an everyday English word");
  for (const x of ["screens/a title: API", "screens/a title: 404", "screens/a.behavior.md:2: code block (the Behavior tab holds no code)"]) assert.ok(en.issues.includes(x), `${x} in:\n${en.issues.join("\n")}`);
});

test("lint: uiLang words the issues for their reader (the command line is English) without changing the vocabulary", () => {
  const root = project({ title: "Một banner hiện ra", behavior: "Intro\n```js\nx\n```\n" });
  const r = lint(root, "main", ["screens/a"], { plainLanguage: true, lang: "vi", uiLang: "en" });
  assert.ok(r.issues.includes("screens/a title: banner"), "still the Vietnamese vocabulary");
  assert.ok(r.issues.includes("screens/a.behavior.md:2: code block (the Behavior tab holds no code)"), r.issues.join("\n"));
});
