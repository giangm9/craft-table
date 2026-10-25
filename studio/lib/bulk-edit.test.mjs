import { test } from "node:test";
import assert from "node:assert/strict";
import { bulkReplace } from "./bulk-edit.mjs";

const files = [
  { rel: "boards/a.tsx", content: 'className="p-3 gap-2"\nclassName="p-3"\n' },
  { rel: "boards/b.tsx", content: "nothing here\n" },
  { rel: "system/t.css", content: "--a: 12px; --b: 12px;" },
];

test("literal: counts per file, changes only files with a match, `$` in the replacement stays literal", async () => {
  const r = await bulkReplace({ files, pattern: "p-3", replacement: "p-$1" });
  assert.equal(r.ok, true);
  assert.equal(r.total, 2);
  assert.deepEqual(r.files.map((f) => [f.rel, f.count]), [["boards/a.tsx", 2]]);
  assert.equal(r.files[0].content, 'className="p-$1 gap-2"\nclassName="p-$1"\n');
  assert.deepEqual(r.files[0].samples[0], { line: 1, before: 'className="p-3 gap-2"', after: 'className="p-$1 gap-2"' });
});

test("regex: groups ($1), flags, case-insensitive", async () => {
  const r = await bulkReplace({ files, pattern: "\\bp-(\\d)", replacement: "px-$1", regex: true });
  assert.equal(r.files[0].content, 'className="px-3 gap-2"\nclassName="px-3"\n');
  const c = await bulkReplace({ files, pattern: "NOTHING", replacement: "x", ignoreCase: true });
  assert.equal(c.total, 1);
  const css = await bulkReplace({ files, pattern: "(\\d+)px", replacement: "calc($1px * 0.5)", regex: true });
  assert.equal(css.files[0].content, "--a: calc(12px * 0.5); --b: calc(12px * 0.5);");
});

test("no match → ok with nothing to change; an invalid regex → an error naming the problem", async () => {
  const none = await bulkReplace({ files, pattern: "zzz", replacement: "y" });
  assert.deepEqual([none.ok, none.total, none.files.length], [true, 0, 0]);
  const bad = await bulkReplace({ files, pattern: "(", replacement: "y", regex: true });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /regular expression|invalid|unterminated/i);
});

test("a catastrophic regex is cut off by the time limit instead of hanging the studio", async () => {
  const evil = [{ rel: "boards/x.tsx", content: `${"a".repeat(40)}!` }];
  const t = Date.now();
  const r = await bulkReplace({ files: evil, pattern: "(a+)+$", replacement: "b", regex: true, timeoutMs: 600 });
  assert.equal(r.ok, false);
  assert.match(r.error, /time/i);
  assert.ok(Date.now() - t < 3000, `took ${Date.now() - t} ms`);
});

test("too many matches → refused (a pattern that is far too broad)", async () => {
  const big = [{ rel: "boards/x.tsx", content: "a".repeat(5000) }];
  const r = await bulkReplace({ files: big, pattern: "a", replacement: "b", maxMatches: 100 });
  assert.equal(r.ok, false);
  assert.match(r.error, /100/);
});
