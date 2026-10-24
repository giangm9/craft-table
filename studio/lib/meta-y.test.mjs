import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { metaToY, yToMeta, applyMeta, metaJson } from "./meta-y.mjs";

const META = { title: "Hôm nay · hiện tại", section: "Màn hình", group: "Bán hàng", order: 300, status: "hiện tại", desc: "Mô tả.", viewports: ["desktop", "mobile"], scenarios: [{ id: "a", title: "A", desc: "dA" }, { id: "b", title: "B" }] };

test("metaToY → yToMeta: data round-trips unchanged; scenarios are a Y.Array<Y.Map>", () => {
  const d = new Y.Doc(), m = d.getMap("meta");
  metaToY(m, META);
  assert.ok(m.get("scenarios") instanceof Y.Array);
  assert.deepEqual(yToMeta(m), META);
});

test("metaJson: fixed field order, 2-space indent, trailing newline", () => {
  const s = metaJson({ desc: "x", title: "T", scenarios: [], order: 1 });
  assert.equal(s, '{\n  "title": "T",\n  "order": 1,\n  "desc": "x",\n  "scenarios": []\n}\n');
});

test("applyMeta: file changed from outside → only the fields that differ change, scenarios matched by id (the old map is kept for the same id)", () => {
  const d = new Y.Doc(), m = d.getMap("meta");
  metaToY(m, META);
  const keepB = m.get("scenarios").get(1);
  const next = { ...META, desc: "Mô tả mới.", scenarios: [{ id: "b", title: "B đổi" }, { id: "c", title: "C mới" }] };
  let ops = 0; d.on("update", () => ops++);
  applyMeta(m, next, "external");
  assert.deepEqual(yToMeta(m), next);
  assert.equal(m.get("scenarios").get(0), keepB, "a scenario with the same id keeps the same object (concurrent edits are not lost)");
  assert.equal(ops, 1, "one transaction");
  applyMeta(m, next, "external");
  assert.equal(ops, 1, "no difference → no change");
});

test("applyMeta: reordering scenarios → the new order is applied, content unchanged", () => {
  const d = new Y.Doc(), m = d.getMap("meta");
  metaToY(m, META);
  const next = { ...META, scenarios: [{ id: "b", title: "B" }, { id: "a", title: "A", desc: "dA" }] };
  applyMeta(m, next, "external");
  assert.deepEqual(yToMeta(m).scenarios, next.scenarios);
});
