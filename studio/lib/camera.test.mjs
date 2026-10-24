import { test } from "node:test";
import assert from "node:assert/strict";
import { clampZoom, zoomAt, fitCamera, toWorld } from "./camera.mjs";

// Camera {x, y, z}: the world point (wx, wy) appears on screen at (x + wx*z, y + wy*z).

test("clampZoom: stays within [0.1, 3]", () => {
  assert.equal(clampZoom(0.01), 0.1);
  assert.equal(clampZoom(5), 3);
  assert.equal(clampZoom(1.2), 1.2);
});

test("zoomAt: the point under the cursor stays put while zooming", () => {
  const cam = { x: 40, y: 20, z: 0.5 };
  const p = { x: 300, y: 200 };
  const before = toWorld(cam, p);
  const next = zoomAt(cam, p, 2);
  assert.equal(next.z, 1);
  const after = toWorld(next, p);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9);
});

test("zoomAt: at the zoom ceiling the camera does not drift", () => {
  const cam = { x: 0, y: 0, z: 3 };
  assert.deepEqual(zoomAt(cam, { x: 100, y: 100 }, 2), cam);
});

test("fitCamera: content fits the width with a margin, centered horizontally, pinned to the top", () => {
  const c = fitCamera({ w: 2000, h: 5000 }, { w: 1000, h: 800 }, 40);
  assert.equal(c.z, (1000 - 80) / 2000);
  assert.equal(c.x, 40);
  assert.equal(c.y, 40);
});

test("fitCamera: content smaller than the screen is not scaled past 1, centered horizontally", () => {
  const c = fitCamera({ w: 400, h: 300 }, { w: 1000, h: 800 }, 40);
  assert.equal(c.z, 1);
  assert.equal(c.x, 300);
  assert.equal(c.y, 40);
});
