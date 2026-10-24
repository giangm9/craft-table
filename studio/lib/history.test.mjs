import { test } from "node:test";
import assert from "node:assert/strict";
import { openHistory } from "./history.mjs";

test("record/list/get + dedupe + group by screen + keep versions apart", () => {
  const h = openHistory(":memory:");
  const a = h.record({ version: "ban-1", path: "screens/x.behavior.md", content: "A", author: "u@x", source: "human" });
  assert.ok(a);
  assert.equal(h.record({ version: "ban-1", path: "screens/x.behavior.md", content: "A", author: "u@x", source: "human" }), null, "same content as the latest snapshot → skipped");
  h.record({ version: "ban-1", path: "screens/x.tsx", content: "T", author: "claude", source: "claude", threadId: "t_1" });
  h.record({ version: "ban-1", path: "screens/xy.tsx", content: "khác màn", author: "u", source: "human" });
  h.record({ version: "ban-2", path: "screens/x.tsx", content: "bản khác", author: "u", source: "human" });
  const l = h.list({ version: "ban-1", entry: "screens/x" });
  assert.deepEqual(l.map((r) => r.path), ["screens/x.tsx", "screens/x.behavior.md"]);
  assert.equal(l[0].threadId, "t_1");
  assert.equal(h.get(a).content, "A");
  assert.equal(h.get(999999), undefined);
});

test("going back to old content is still a new snapshot (A → B → A = 3 snapshots)", () => {
  const h = openHistory(":memory:");
  for (const c of ["A", "B", "A"]) h.record({ version: "ban-1", path: "screens/x.tech.md", content: c, author: "u", source: "human" });
  assert.equal(h.list({ version: "ban-1", entry: "screens/x" }).length, 3);
  assert.equal(h.latestHash("ban-1", "screens/x.tech.md"), h.list({ version: "ban-1", entry: "screens/x" })[2].hash);
});

test("invalid source → error", () => {
  const h = openHistory(":memory:");
  assert.throws(() => h.record({ version: "ban-1", path: "a.tsx", content: "x", author: "u", source: "linh-tinh" }));
});

test("note: a { key, params } note is stored as JSON and read back as the object; a plain-text note stays text", () => {
  const h = openHistory(":memory:");
  const a = h.record({ version: "v", path: "screens/x.tsx", content: "1", author: "u", source: "restore", note: { key: "restoredSnapshot", params: { id: 3, ts: "t" } } });
  const b = h.record({ version: "v", path: "screens/x.tsx", content: "2", author: "u", source: "human", note: "khôi phục mốc #1 (t)" });
  const c = h.record({ version: "v", path: "screens/x.tsx", content: "3", author: "u", source: "human", note: '{"not":"a key"}' });
  assert.deepEqual(h.get(a).note, { key: "restoredSnapshot", params: { id: 3, ts: "t" } });
  assert.equal(h.get(b).note, "khôi phục mốc #1 (t)", "old rows: the text they were written with");
  assert.equal(h.get(c).note, '{"not":"a key"}');
  assert.deepEqual(h.list({ version: "v", entry: "screens/x" }).map((r) => r.note), ['{"not":"a key"}', "khôi phục mốc #1 (t)", { key: "restoredSnapshot", params: { id: 3, ts: "t" } }]);
});

test("old rows written with the Vietnamese author words are read with the codes", () => {
  const h = openHistory(":memory:");
  const a = h.record({ version: "v", path: "screens/x.tsx", content: "1", author: "khởi tạo", source: "init" });
  const b = h.record({ version: "v", path: "screens/x.tsx", content: "2", author: "ngoài xưởng", source: "external" });
  const c = h.record({ version: "v", path: "screens/x.tsx", content: "3", author: "ana@example.com", source: "human" });
  assert.deepEqual([a, b, c].map((id) => h.get(id).author), ["init", "external", "ana@example.com"]);
  assert.deepEqual(h.list({ version: "v", entry: "screens/x" }).map((r) => r.author), ["ana@example.com", "external", "init"]);
});

test("purgeVersion: deletes the snapshots of ONE version (a version deleted / recreated with the same id)", () => {
  const h = openHistory(":memory:");
  h.record({ version: "ban-1", path: "screens/x.tsx", content: "1", author: "u", source: "human" });
  h.record({ version: "thu", path: "screens/x.tsx", content: "2", author: "u", source: "human" });
  assert.equal(h.purgeVersion("thu"), 1);
  assert.equal(h.list({ version: "thu", entry: "screens/x" }).length, 0);
  assert.equal(h.list({ version: "ban-1", entry: "screens/x" }).length, 1);
});
