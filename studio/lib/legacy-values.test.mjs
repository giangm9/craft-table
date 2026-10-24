// Read compatibility for values stored by earlier versions: projects and bookmarks made when the studio
// wrote Vietnamese words keep working; writers now write the neutral codes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authorCode, boardStatusCode, isTempScenarioId, optionStatusCode, specPageId, TEMP_SCENARIO_PREFIX, urlValue, versionStatusCode } from "./legacy-values.mjs";

test("version status: the old words map to codes; codes and unknown values pass through", () => {
  assert.equal(versionStatusCode("đang thiết kế"), "draft");
  assert.equal(versionStatusCode("đã chốt"), "approved");
  assert.equal(versionStatusCode("đã lên app"), "live");
  assert.equal(versionStatusCode("lưu trữ"), "archived");
  for (const v of ["draft", "approved", "live", "archived", "something else"]) assert.equal(versionStatusCode(v), v);
  assert.equal(versionStatusCode(undefined), undefined);
});

test("option status: the old words map to codes; codes and unknown values pass through", () => {
  assert.equal(optionStatusCode("đang thử"), "trying");
  assert.equal(optionStatusCode("đã chốt"), "adopted");
  for (const v of ["trying", "adopted", "x"]) assert.equal(optionStatusCode(v), v);
  assert.equal(optionStatusCode(null), null);
});

test("board status (meta.status): the old words map to codes; any other value is kept as it is", () => {
  assert.equal(boardStatusCode("hiện tại"), "current");
  assert.equal(boardStatusCode("đề xuất"), "proposed");
  assert.equal(boardStatusCode("chốt"), "approved");
  for (const v of ["current", "proposed", "approved", "bản nháp riêng", ""]) assert.equal(boardStatusCode(v), v);
});

test("history authors written by the studio itself: the old words map to codes; emails stay", () => {
  assert.equal(authorCode("khởi tạo"), "init");
  assert.equal(authorCode("ngoài xưởng"), "external");
  for (const v of ["init", "external", "claude", "ana@example.com"]) assert.equal(authorCode(v), v);
});

test("URL values: old bookmarks are read as aliases of the new values", () => {
  assert.equal(urlValue("rp", "lich-su"), "history");
  assert.equal(urlValue("opt", "ten"), "rename");
  assert.equal(urlValue("opt", "chot"), "adopt");
  assert.equal(urlValue("opt", "bo"), "remove");
  assert.equal(urlValue("opt", "moi"), "new");
  assert.equal(urlValue("dev", "ca-trang"), "full");
  assert.equal(urlValue("dev", "android-nho"), "android-small");
  // New values, other values, other parameters: untouched.
  for (const [k, v] of [["rp", "history"], ["opt", "adopt"], ["dev", "full"], ["dev", "iphone-se"], ["e", "bo"], ["t", "moi"]]) assert.equal(urlValue(k, v), v);
  assert.equal(urlValue("rp", null), null);
});

test("spec page ids: the old default slugs ('tong-quan', 'muc') map to the new ones, per path segment", () => {
  assert.equal(specPageId("tong-quan"), "overview");
  assert.equal(specPageId("muc"), "section");
  assert.equal(specPageId("muc-3"), "section-3");
  assert.equal(specPageId("luat/muc-2"), "luat/section-2");
  for (const v of ["overview", "luat/dat-va-luu", "tong-quan-chung", "mucluc", "all"]) assert.equal(specPageId(v), v);
  assert.equal(specPageId(null), null);
});

test("temporary scenario ids: the new prefix, and the old kich-ban-N still counts as temporary", () => {
  assert.equal(TEMP_SCENARIO_PREFIX, "scenario-");
  assert.equal(isTempScenarioId("scenario-3"), true);
  assert.equal(isTempScenarioId("kich-ban-2"), true);
  for (const v of ["it-don", "scenario", "kich-ban", "my-scenario-2", undefined]) assert.equal(isTempScenarioId(v), false);
});
