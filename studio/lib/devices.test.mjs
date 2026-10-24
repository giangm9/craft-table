import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVICES, DEFAULT_DEVICE, FULL_DEVICE, FULL_MAX_H, deviceOf, frameSize, fullHeight } from "./devices.mjs";

test("DEVICES: default is iPhone 14 390×844 (matches old mark coordinates at width 390); ids are unique", () => {
  assert.equal(DEFAULT_DEVICE, "iphone-14");
  assert.deepEqual(deviceOf("iphone-14"), { id: "iphone-14", name: "iPhone 14", w: 390, h: 844 });
  assert.equal(new Set(DEVICES.map((d) => d.id)).size, DEVICES.length);
  assert.ok(DEVICES.length >= 5 && DEVICES.every((d) => d.w >= 320 && d.w <= 480 && d.h >= 560));
});

test("deviceOf: unknown / empty id → default device; 'full' = whole page (no fixed height)", () => {
  assert.equal(deviceOf("khong-co").id, "iphone-14");
  assert.equal(deviceOf(null).id, "iphone-14");
  assert.deepEqual(deviceOf("full"), { id: "full", name: "Whole page", w: 390, h: null });
});

test("device ids are neutral; old URL values still pick the same device (dev=ca-trang, dev=android-nho)", () => {
  assert.equal(FULL_DEVICE, "full");
  assert.deepEqual(deviceOf("ca-trang"), deviceOf("full"));
  assert.equal(deviceOf("android-nho").id, "android-small");
  assert.deepEqual(deviceOf("android-small"), { id: "android-small", name: "Small Android", w: 360, h: 640 });
  for (const d of DEVICES) assert.match(d.id, /^[a-z0-9-]+$/);
});

test("frameSize: desktop fixed at 1280×800 (scrolls inside); mobile follows the device; 'Whole page' → both grow with the content", () => {
  assert.deepEqual(frameSize("desktop", "iphone-se"), { w: 1280, h: 800 });
  assert.deepEqual(frameSize("desktop", undefined), { w: 1280, h: 800 });
  assert.deepEqual(frameSize("mobile", "iphone-se"), { w: 375, h: 667 });
  assert.deepEqual(frameSize("mobile", "full"), { w: 390, h: null });
  assert.deepEqual(frameSize("desktop", "full"), { w: 1280, h: null });
  assert.deepEqual(frameSize("desktop", "ca-trang"), { w: 1280, h: null }, "old bookmark");
});

test("fullHeight: 'Whole page' grows with the content but has a cap — a screen that is 'as tall as the viewport' does not stretch the frame forever", () => {
  assert.equal(fullHeight(1500, 0), 1500);
  assert.equal(fullHeight(50, 0), 120, "at least 120");
  assert.equal(fullHeight(50, 700), 700, "the screen's minHeight");
  assert.equal(fullHeight(99999, 0), FULL_MAX_H);
  assert.equal(fullHeight(Number.NaN, 0), 120);
});
