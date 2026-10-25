import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOAT_MIN, defaultFloatRect, clampFloatRect, dragFloatRect, resizeFloatRect } from "./panel-float.mjs";

test("defaultFloatRect: bottom right with a margin, a comfortable size that always fits", () => {
  assert.deepEqual(defaultFloatRect(1280, 800), { x: 884, y: 164, w: 380, h: 620 });
  const small = defaultFloatRect(1024, 600);
  assert.ok(small.y >= 0 && small.h <= 600 - 16 && small.h >= FLOAT_MIN.h - 1, JSON.stringify(small));
});

test("clampFloatRect: never smaller than the minimum, never outside the window", () => {
  assert.deepEqual(clampFloatRect({ x: -50, y: -20, w: 380, h: 500 }, 1280, 800), { x: 0, y: 0, w: 380, h: 500 });
  assert.deepEqual(clampFloatRect({ x: 1200, y: 780, w: 380, h: 500 }, 1280, 800), { x: 900, y: 300, w: 380, h: 500 });
  assert.deepEqual(clampFloatRect({ x: 10, y: 10, w: 100, h: 100 }, 1280, 800), { x: 10, y: 10, w: FLOAT_MIN.w, h: FLOAT_MIN.h });
  const big = clampFloatRect({ x: 0, y: 0, w: 5000, h: 5000 }, 1280, 800);
  assert.deepEqual([big.w, big.h], [1280, 800]);
});

test("dragFloatRect: the window follows the pointer and stays inside", () => {
  const r = { x: 884, y: 164, w: 380, h: 620 };
  assert.deepEqual(dragFloatRect(r, -200, -100, 1280, 800), { x: 684, y: 64, w: 380, h: 620 });
  assert.deepEqual(dragFloatRect(r, 900, 900, 1280, 800), { x: 900, y: 180, w: 380, h: 620 });
  assert.deepEqual(dragFloatRect(r, -5000, -5000, 1280, 800), { x: 0, y: 0, w: 380, h: 620 });
});

test("resizeFloatRect: the bottom right corner moves, the top left stays; minimum size; not past the window edge", () => {
  const r = { x: 600, y: 100, w: 380, h: 500 };
  assert.deepEqual(resizeFloatRect(r, 100, 50, 1280, 800), { x: 600, y: 100, w: 480, h: 550 });
  assert.deepEqual(resizeFloatRect(r, -500, -500, 1280, 800), { x: 600, y: 100, w: FLOAT_MIN.w, h: FLOAT_MIN.h });
  assert.deepEqual(resizeFloatRect(r, 2000, 2000, 1280, 800), { x: 600, y: 100, w: 680, h: 700 });
});
