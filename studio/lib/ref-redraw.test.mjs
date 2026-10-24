import { test } from "node:test";
import assert from "node:assert/strict";
import { afterRemovePending, placeDrawn } from "./ref-redraw.mjs";

const a = { scenario: null, viewport: "desktop", rect: { x: 1, y: 1, w: 5, h: 5 }, texts: [] };
const b = { ...a, rect: { x: 9, y: 9, w: 5, h: 5 } };
const nr = { ...a, viewport: "mobile", rect: { x: 2, y: 3, w: 4, h: 5 }, texts: ["Lưu"] };

test("placeDrawn: not redrawing → the new mark is added at the end of the draft list", () => {
  assert.deepEqual(placeDrawn([a], null, nr), { pending: [a, nr], sent: null });
});

test("placeDrawn: redrawing draft mark i → replaced in place, its number kept", () => {
  assert.deepEqual(placeDrawn([a, b], { kind: "pending", i: 0 }, nr), { pending: [nr, b], sent: null });
  // That mark was removed while waiting for the redraw → add a new one instead of overwriting another mark.
  assert.deepEqual(placeDrawn([a], { kind: "pending", i: 3 }, nr), { pending: [a, nr], sent: null });
});

test("placeDrawn: redrawing a sent mark → the draft list is untouched, returns a command to send to the server", () => {
  assert.deepEqual(placeDrawn([a], { kind: "sent", messageId: "m1", index: 2, n: 5 }, nr), { pending: [a], sent: { messageId: "m1", index: 2, ref: nr } });
});

test("afterRemovePending: removing draft mark i → a redraw target on that same mark is cancelled, later marks shift down one number", () => {
  assert.equal(afterRemovePending({ kind: "pending", i: 1 }, 1), null);
  assert.deepEqual(afterRemovePending({ kind: "pending", i: 2 }, 0), { kind: "pending", i: 1 });
  assert.deepEqual(afterRemovePending({ kind: "pending", i: 0 }, 2), { kind: "pending", i: 0 });
  const sent = { kind: "sent", messageId: "m1", index: 0, n: 1 };
  assert.equal(afterRemovePending(sent, 0), sent);
  assert.equal(afterRemovePending(null, 0), null);
});
