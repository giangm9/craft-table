import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRect, toDocRect, toViewRect, isUsableRect, textsInRect } from "./geometry.mjs";

test("normalizeRect: dragging in any direction gives the top-left x,y and a positive w,h", () => {
  const want = { x: 10, y: 20, w: 30, h: 40 };
  assert.deepEqual(normalizeRect({ x: 10, y: 20 }, { x: 40, y: 60 }), want); // ↘
  assert.deepEqual(normalizeRect({ x: 40, y: 60 }, { x: 10, y: 20 }), want); // ↖
  assert.deepEqual(normalizeRect({ x: 40, y: 20 }, { x: 10, y: 60 }), want); // ↙
  assert.deepEqual(normalizeRect({ x: 10, y: 60 }, { x: 40, y: 20 }), want); // ↗
});

test("toDocRect: frame scaled down to 0.5 → real px coordinates are doubled, rounded", () => {
  assert.deepEqual(toDocRect({ x: 10.2, y: 5, w: 50, h: 25.4 }, 0.5), { x: 20, y: 10, w: 100, h: 51 });
});

test("toViewRect is the inverse of toDocRect", () => {
  assert.deepEqual(toViewRect({ x: 20, y: 10, w: 100, h: 50 }, 0.5), { x: 10, y: 5, w: 50, h: 25 });
});

test("isUsableRect: a misclick (area too small) does not count as a mark", () => {
  assert.equal(isUsableRect({ x: 0, y: 0, w: 3, h: 40 }), false);
  assert.equal(isUsableRect({ x: 0, y: 0, w: 40, h: 3 }), false);
  assert.equal(isUsableRect({ x: 0, y: 0, w: 8, h: 8 }), true);
});

test("textsInRect: takes text whose center is inside the area, drops duplicates and empty text, truncates long text", () => {
  const items = [
    { text: "Đã giao", x: 10, y: 10, w: 40, h: 10 },     // center (30,15) inside
    { text: "  Đã giao ", x: 60, y: 10, w: 20, h: 10 },  // duplicate after trim
    { text: "Huỷ", x: 200, y: 10, w: 20, h: 10 },        // outside
    { text: "   ", x: 20, y: 20, w: 5, h: 5 },           // empty
    { text: "x".repeat(200), x: 20, y: 30, w: 10, h: 10 },
  ];
  const got = textsInRect(items, { x: 0, y: 0, w: 100, h: 100 });
  assert.deepEqual(got, ["Đã giao", "x".repeat(80) + "…"]);
});

test("textsInRect: caps the number of text snippets", () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ text: `t${i}`, x: 1, y: 1, w: 2, h: 2 }));
  assert.equal(textsInRect(items, { x: 0, y: 0, w: 10, h: 10 }, { limit: 5 }).length, 5);
});

// ── Marking on the board layer: pick the target frame + convert to document px ──
import { pickTarget } from "./geometry.mjs";

const frames = [
  { key: "a:desktop", x: 100, y: 100, w: 640, h: 400 },  // desktop frame at zoom 0.5 (1280 → 640)
  { key: "a:mobile", x: 780, y: 100, w: 195, h: 400 },   // mobile frame at zoom 0.5 (390 → 195)
];

test("pickTarget: area entirely inside one frame → document px = (screen - frame corner) / zoom", () => {
  assert.deepEqual(pickTarget({ x: 120, y: 150, w: 100, h: 50 }, frames, 0.5), { key: "a:desktop", rect: { x: 40, y: 100, w: 200, h: 100 } });
});

test("pickTarget: starts on the background and reaches into a frame → belongs to that frame, clipped to its edges", () => {
  assert.deepEqual(pickTarget({ x: 740, y: 80, w: 100, h: 100 }, frames, 0.5), { key: "a:mobile", rect: { x: 0, y: 0, w: 120, h: 160 } });
});

test("pickTarget: covers 2 frames → the frame with the larger overlap", () => {
  // desktop overlap: 700..740 (40px), mobile overlap: 780..900 (120px) → mobile
  assert.equal(pickTarget({ x: 700, y: 200, w: 200, h: 50 }, frames, 0.5).key, "a:mobile");
});

test("pickTarget: marking only the background → null", () => {
  assert.equal(pickTarget({ x: 0, y: 0, w: 50, h: 50 }, frames, 0.5), null);
});
