import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openHistory } from "./history.mjs";
import { createRecorder } from "./history-recorder.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rec-"));
  const b = path.join(root, "versions", "ban-1", "boards", "screens");
  fs.mkdirSync(path.join(b, "_kit"), { recursive: true });
  fs.writeFileSync(path.join(b, "a.tsx"), "v1");
  fs.writeFileSync(path.join(b, "a.behavior.md"), "# A");
  fs.writeFileSync(path.join(b, "_kit", "x.ts"), "kit");
  return { root, b };
}

test("touch called many times while typing → exactly 1 snapshot after it stops; no change → 0 snapshots", async () => {
  const { root, b } = fixture();
  const h = openHistory(":memory:");
  const seen = [];
  const rec = createRecorder({ root, history: h, quietMs: 40, attribute: () => ({ author: "claude", source: "claude", threadId: "t_9" }), onRecord: (r) => seen.push(r) });
  for (const c of ["v2", "v3", "v4"]) { fs.writeFileSync(path.join(b, "a.tsx"), c); rec.touch(path.join(b, "a.tsx")); await wait(10); }
  await wait(80);
  const l = h.list({ version: "ban-1", entry: "screens/a" });
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].path, l[0].author, l[0].source, l[0].threadId], ["screens/a.tsx", "claude", "claude", "t_9"]);
  assert.equal(h.get(l[0].id).content, "v4");
  assert.deepEqual(seen, [{ id: l[0].id, version: "ban-1", path: "screens/a.tsx" }], "the UI is notified exactly once");
  rec.touch(path.join(b, "a.tsx")); await wait(80);
  assert.equal(h.list({ version: "ban-1", entry: "screens/a" }).length, 1);
});

test("markHuman: the file's next write carries the editor's name; _kit files and files outside boards are ignored", async () => {
  const { root, b } = fixture();
  const h = openHistory(":memory:");
  const rec = createRecorder({ root, history: h, quietMs: 20, attribute: () => null });
  rec.markHuman("ban-1", "screens/a.behavior.md", "ana@example.com");
  fs.writeFileSync(path.join(b, "a.behavior.md"), "# A sửa");
  rec.touch(path.join(b, "a.behavior.md"));
  rec.touch(path.join(b, "_kit", "x.ts"));
  rec.touch(path.join(root, "versions", "index.json"));
  await wait(60);
  const l = h.list({ version: "ban-1", entry: "screens/a" });
  assert.deepEqual(l.map((r) => [r.author, r.source]), [["ana@example.com", "human"]]);
  // Nobody marked it → "outside the studio" (author code "external").
  fs.writeFileSync(path.join(b, "a.behavior.md"), "# A sửa nữa");
  rec.touch(path.join(b, "a.behavior.md")); await wait(60);
  const top = h.list({ version: "ban-1", entry: "screens/a" })[0];
  assert.deepEqual([top.source, top.author], ["external", "external"]);
});

test("baseline: records an initial snapshot for files that have none; running it again records nothing more", () => {
  const { root } = fixture();
  const h = openHistory(":memory:");
  const rec = createRecorder({ root, history: h, quietMs: 20, attribute: () => null });
  assert.equal(rec.baseline(), 2);
  assert.equal(rec.baseline(), 0);
  assert.deepEqual(h.list({ version: "ban-1", entry: "screens/a" }).map((r) => r.source), ["init", "init"]);
});

test("baseline: a file changed while the studio was off → an 'external' snapshot; never recorded before → 'init'", () => {
  const { root, b } = fixture();
  const h = openHistory(":memory:");
  const rec = createRecorder({ root, history: h, quietMs: 20, attribute: () => null });
  rec.baseline();
  fs.writeFileSync(path.join(b, "a.tsx"), "sửa khi tắt");
  fs.writeFileSync(path.join(b, "c.tech.md"), "mới");
  assert.equal(rec.baseline(), 2);
  assert.deepEqual(h.list({ version: "ban-1", entry: "screens/a" }).map((r) => r.source), ["external", "init", "init"]);
  assert.equal(h.list({ version: "ban-1", entry: "screens/c" })[0].source, "init");
});

test("baseline writes neutral codes: author init / external, the note as { key } (rendered in the viewer's language)", () => {
  const { root, b } = fixture();
  const h = openHistory(":memory:");
  const rec = createRecorder({ root, history: h, quietMs: 20, attribute: () => null });
  rec.baseline();
  fs.writeFileSync(path.join(b, "a.tsx"), "changed while off");
  rec.baseline();
  const [ext, init] = h.list({ version: "ban-1", entry: "screens/a" });
  assert.deepEqual([ext.author, ext.source, ext.note], ["external", "external", { key: "changedWhileOff" }]);
  assert.deepEqual([init.author, init.source, init.note], ["init", "init", null]);
});

test("baseline stores the codes themselves in the database (not words that reading happens to map back)", () => {
  const { root, b } = fixture();
  const file = path.join(root, "history.sqlite");
  const h = openHistory(file);
  const rec = createRecorder({ root, history: h, quietMs: 20, attribute: () => null });
  rec.baseline();
  fs.writeFileSync(path.join(b, "a.tsx"), "changed while off");
  rec.baseline();
  h.close();
  const db = new DatabaseSync(file);
  const rows = db.prepare("SELECT author, source, note FROM revision WHERE path = 'screens/a.tsx' ORDER BY id").all();
  db.close();
  assert.deepEqual(rows.map((r) => [r.author, r.source, r.note]), [["init", "init", null], ["external", "external", JSON.stringify({ key: "changedWhileOff" })]]);
});
