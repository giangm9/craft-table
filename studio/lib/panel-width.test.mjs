import { test } from "node:test";
import assert from "node:assert/strict";
import { PANEL_DEFAULT, PANEL_MIN, clampPanelWidth, dragPanelWidth } from "./panel-width.mjs";

test("dragPanelWidth: right-hand panel — dragging its left edge left widens it, dragging right narrows it", () => {
  assert.equal(dragPanelWidth(360, 900, 800, 1440), 460);
  assert.equal(dragPanelWidth(460, 800, 850, 1440), 410);
});

test("clampPanelWidth: no narrower than the minimum, no wider than 60% of the screen; bad value → default", () => {
  assert.equal(dragPanelWidth(360, 900, 1200, 1440), PANEL_MIN);
  assert.equal(clampPanelWidth(5000, 1280), 768);
  assert.equal(clampPanelWidth("abc", 1440), PANEL_DEFAULT);
  assert.equal(clampPanelWidth(null, 1440), PANEL_DEFAULT);
  assert.equal(clampPanelWidth(420.6, 1440), 421);
  assert.equal(clampPanelWidth(700, 1024), 614, "smaller screen → shrinks to fit");
});
