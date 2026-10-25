import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerifyGuard } from "./verify-guard.mjs";

test("no edits → no checks required", () => {
  const g = createVerifyGuard();
  g.record("read", { path: "boards/screens/a.tsx" }, true);
  assert.deepEqual(g.missing(), []);
});

test("editing .tsx → requires view_frame + check typecheck AFTER the last edit", () => {
  const g = createVerifyGuard();
  g.record("edit", { path: "boards/screens/a.tsx" }, true);
  assert.deepEqual(g.missing().sort(), ["check typecheck", "view_frame"]);
  g.record("check", { what: "typecheck" }, true);
  g.record("view_frame", { entry: "screens/a" }, true);
  assert.deepEqual(g.missing(), []);
  g.record("edit", { path: "boards/screens/a.tsx" }, true); // edited again → must view/check again
  assert.deepEqual(g.missing().sort(), ["check typecheck", "view_frame"]);
});

test("a failing typecheck does not count as checked; a failed edit does not count as an edit", () => {
  const g = createVerifyGuard();
  g.record("edit", { path: "boards/screens/a.tsx" }, false);
  assert.deepEqual(g.missing(), []);
  g.record("write", { path: "boards/screens/a.tsx" }, true);
  g.record("check", { what: "typecheck" }, false);
  g.record("view_frame", {}, true);
  assert.deepEqual(g.missing(), ["check typecheck"]);
});

test("editing the description (.meta.json) / Behavior tab → check lint; editing a .md spec → check spec", () => {
  const g = createVerifyGuard();
  g.record("edit", { path: "boards/screens/a.meta.json" }, true);
  g.record("edit", { path: "boards/screens/a.behavior.md" }, true);
  g.record("edit", { path: "boards/screens/a.tech.md" }, true);
  assert.deepEqual(g.missing().sort(), ["check lint", "check spec"]);
  g.record("check", { what: "lint" }, true);
  g.record("check", { what: "spec", kind: "tech" }, true);
  assert.deepEqual(g.missing(), []);
});

test("checks still fail BUT in files this turn did not edit (a screen someone else is midway through) → our own part counts as checked", () => {
  const g = createVerifyGuard();
  g.record("edit", { path: "boards/screens/orders/today.tsx" }, true);
  g.record("edit", { path: "boards/screens/orders/today.meta.json" }, true);
  g.record("view_frame", {}, true);
  g.record("check", { what: "typecheck" }, false, "✗ tsc lỗi (versions/ban-1/tsconfig.json):\nversions/ban-1/boards/screens/account/home.tsx(3,1): error TS1005");
  g.record("check", { what: "lint" }, false, "✗ 1 chỗ:\nscreens/account/home desc: có code");
  assert.deepEqual(g.missing(), []);
  // The error is IN a file we edited → not done yet.
  g.record("edit", { path: "boards/screens/orders/today.tsx" }, true);
  g.record("view_frame", {}, true);
  g.record("check", { what: "typecheck" }, false, "versions/ban-1/boards/screens/orders/today.tsx(9,2): error TS2322");
  assert.deepEqual(g.missing(), ["check typecheck"]);
  g.record("edit", { path: "boards/screens/orders/today.meta.json" }, true);
  g.record("check", { what: "lint" }, false, "✗ 1 chỗ:\nscreens/orders/today desc: có code");
  assert.ok(g.missing().includes("check lint"));
});

test("design system (system/*.tsx) → typecheck + view_frame, same as a board", () => {
  const g = createVerifyGuard();
  g.record("edit", { path: "system/components/primitives.tsx" }, true);
  assert.deepEqual(g.missing().sort(), ["check typecheck", "view_frame"]);
});

test("browse counts as having looked at the result (like view_frame); a design turn that edited code and browsed and typechecked is done", () => {
  const g = createVerifyGuard();
  g.record("replace", { pattern: "p-3", dry_run: false }, true, "wrote: boards/screens/a.tsx, boards/screens/b.tsx");
  assert.deepEqual(g.missing().sort(), ["check typecheck", "view_frame"]);
  g.record("check", { what: "typecheck" }, true);
  g.record("browse", { all: true }, true);
  assert.deepEqual(g.missing(), []);
});

test("a dry-run replace is not an edit; a run that landed files is", () => {
  const g = createVerifyGuard();
  g.record("replace", { pattern: "p-3", dry_run: true }, true, "dry run");
  assert.deepEqual(g.missing(), []);
  g.record("run", { command: "node codemod.js" }, true, "exit code 0\nlanded: boards/screens/a.tsx, system/tokens.css");
  assert.deepEqual(g.missing().sort(), ["check typecheck", "view_frame"]);
});

test("a run that landed nothing is not an edit", () => {
  const g = createVerifyGuard();
  g.record("run", { command: "ls" }, true, "exit code 0\nstdout:\nboards\nlanded: nothing");
  assert.deepEqual(g.missing(), []);
});
