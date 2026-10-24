import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { applyText, mergeExternal } from "./text-merge.mjs";

test("applyText: changes only the part that differs, in one update", () => {
  const d = new Y.Doc(), t = d.getText("content"); t.insert(0, "Người bán duyệt đơn.");
  let ops = 0; d.on("update", () => ops++);
  applyText(t, "Người bán duyệt từng đơn.");
  assert.equal(t.toString(), "Người bán duyệt từng đơn.");
  assert.equal(ops, 1);
  applyText(t, "Người bán duyệt từng đơn.");
  assert.equal(ops, 1, "no change → no update");
});

test("mergeExternal: Claude edits paragraph 2 on disk while a person types in paragraph 1 → both are kept", () => {
  const d = new Y.Doc(), t = d.getText("content");
  t.insert(0, "Đoạn một.\n\nĐoạn hai.");
  const base = Y.encodeStateAsUpdate(d);       // when the file was written
  t.insert(9, " (người gõ thêm)");             // a person types after the file was written
  mergeExternal(d, "content", base, "Đoạn một.\n\nĐoạn hai đã sửa.", "claude");
  assert.equal(t.toString(), "Đoạn một. (người gõ thêm)\n\nĐoạn hai đã sửa.");
});

test("mergeExternal: both deleting the same paragraph neither doubles nor deletes too much", () => {
  const d = new Y.Doc(), t = d.getText("content");
  t.insert(0, "A\nB\nC");
  const base = Y.encodeStateAsUpdate(d);
  t.delete(2, 2);                               // the person deletes "B\n"
  mergeExternal(d, "content", base, "A\nC", "claude"); // Claude also deletes "B\n"
  assert.equal(t.toString(), "A\nC");
});

test("mergeExternal: nobody typed anything → content = file", () => {
  const d = new Y.Doc(), t = d.getText("content");
  t.insert(0, "# Tiêu đề\nnội dung cũ");
  const base = Y.encodeStateAsUpdate(d);
  mergeExternal(d, "content", base, "# Tiêu đề\nnội dung mới hẳn\n- thêm dòng", "git");
  assert.equal(t.toString(), "# Tiêu đề\nnội dung mới hẳn\n- thêm dòng");
});

test("mergeExternal: the origin is attached to the update (to know who changed it)", () => {
  const d = new Y.Doc(), t = d.getText("content");
  t.insert(0, "x");
  const base = Y.encodeStateAsUpdate(d);
  const origins = [];
  d.on("update", (_u, origin) => origins.push(origin));
  mergeExternal(d, "content", base, "xy", "claude");
  assert.deepEqual(origins, ["claude"]);
});

test("mergeExternal twice in a row (the person is still typing, file not written yet) → uses the new base, no doubling", () => {
  const d = new Y.Doc(), t = d.getText("content");
  t.insert(0, "Một.\nHai.");
  let base = Y.encodeStateAsUpdate(d);
  t.insert(0, "[gõ] ");                                       // a person types, before the file is written
  base = mergeExternal(d, "content", base, "Một.\nHai.\nBa.", "claude");       // Claude, 1st time
  base = mergeExternal(d, "content", base, "Một.\nHai.\nBa.\nBốn.", "claude"); // Claude, 2nd time
  assert.equal(t.toString(), "[gõ] Một.\nHai.\nBa.\nBốn.");
  assert.ok(base instanceof Uint8Array);
});
