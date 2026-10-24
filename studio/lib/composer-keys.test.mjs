import { test } from "node:test";
import assert from "node:assert/strict";
import { enterAction } from "./composer-keys.mjs";

const k = (o) => ({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, keyCode: 13, ...o });

test("regular composer: Enter sends; Shift+Enter (or Alt+Enter) adds a line break; Ctrl/⌘+Enter also sends", () => {
  assert.equal(enterAction(k({}), false), "send");
  assert.equal(enterAction(k({ shiftKey: true }), false), null);
  assert.equal(enterAction(k({ altKey: true }), false), null);
  assert.equal(enterAction(k({ ctrlKey: true }), false), "send");
  assert.equal(enterAction(k({ metaKey: true }), false), "send");
});

test("large composer (multi-line text): Enter adds a line break, only Ctrl/⌘+Enter sends", () => {
  assert.equal(enterAction(k({}), true), null);
  assert.equal(enterAction(k({ shiftKey: true }), true), null);
  assert.equal(enterAction(k({ ctrlKey: true }), true), "send");
  assert.equal(enterAction(k({ metaKey: true }), true), "send");
});

test("typing with diacritics (the IME is composing) → Enter does not send; other keys → no action", () => {
  assert.equal(enterAction(k({ isComposing: true }), false), null);
  assert.equal(enterAction(k({ keyCode: 229 }), false), null);
  assert.equal(enterAction(k({ key: "a", keyCode: 65 }), false), null);
});
