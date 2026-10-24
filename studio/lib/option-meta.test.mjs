import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOption, optionMetaIssue, OPTION_STATUSES } from "./option-meta.mjs";

test("OPTION_STATUSES are neutral codes", () => {
  assert.deepEqual(OPTION_STATUSES, ["trying", "adopted"]);
});

test("normalizeOption: Claude writes plain text (\"option\": \"a-ban-gon\") → full {of from the id, name taken from the title, trying}", () => {
  const m = normalizeOption("screens/orders/today~a-ban-gon", { title: "Hôm nay · A. Bản gọn", option: "a-ban-gon" });
  assert.deepEqual(m.option, { of: "screens/orders/today", name: "A. Bản gọn", status: "trying" });
  assert.equal(m.title, "Hôm nay · A. Bản gọn");
});

test("normalizeOption: junk from spreading text into an object ({0:'d',1:'-',…, status:'đã chốt'}) → numeric keys dropped, adopted + the adopter kept", () => {
  const junk = { 0: "d", 1: "-", 2: "l", status: "đã chốt", adoptedBy: "x@y", adoptedAt: "t" };
  const m = normalizeOption("screens/orders/today~d-loc-theo-kho", { title: "Hôm nay · D. Chọn kho + lọc đơn", option: junk });
  assert.deepEqual(m.option, { of: "screens/orders/today", name: "D. Chọn kho + lọc đơn", status: "adopted", adoptedBy: "x@y", adoptedAt: "t" });
});

test("normalizeOption: the old Vietnamese statuses are read as codes; an unknown status → trying", () => {
  const old = { title: "A", option: { of: "screens/a", name: "Ba nút", status: "đang thử", createdBy: "u", createdAt: "t" } };
  assert.deepEqual(normalizeOption("screens/a~ba-nut", old).option, { ...old.option, status: "trying" });
  assert.equal(normalizeOption("screens/a~ba-nut", { title: "A", option: { ...old.option, status: "đã chốt" } }).option.status, "adopted");
  assert.equal(normalizeOption("screens/a~ba-nut", { title: "A", option: { ...old.option, status: "lạ" } }).option.status, "trying");
});

test("normalizeOption: correct shape → kept as is; a title without '· name' → name = the part after ~; a screen that is not an option → unchanged", () => {
  const ok = { title: "A", option: { of: "screens/a", name: "Ba nút", status: "trying", createdBy: "u", createdAt: "t" } };
  assert.equal(normalizeOption("screens/a~ba-nut", ok), ok);
  assert.equal(normalizeOption("screens/a~ba-nut", { title: "Màn A" }).option.name, "ba-nut");
  assert.equal(normalizeOption("screens/a~ba-nut", { title: "A", option: { of: "screens/khac", name: "X", status: "lạ" } }).option.of, "screens/a", "of always follows the id");
  const main = { title: "X" };
  assert.equal(normalizeOption("screens/a", main), main);
});

test("optionMetaIssue: an option's info file must have a correctly shaped option; wrong → reported with the correct shape", () => {
  const bad = optionMetaIssue("boards/screens/a~x.meta.json", JSON.stringify({ title: "t", option: "x" }));
  assert.match(bad, /"of": "screens\/a"/);
  assert.match(bad, /"name"/);
  assert.equal(optionMetaIssue("boards/screens/a~x.meta.json", JSON.stringify({ title: "t", option: { of: "screens/a", name: "Ba nút", status: "trying" } })), null);
  assert.equal(optionMetaIssue("boards/screens/a~x.meta.json", JSON.stringify({ title: "t", option: { of: "screens/a", name: "Ba nút", status: "adopted" } })), null);
  assert.match(optionMetaIssue("boards/screens/a~x.meta.json", JSON.stringify({ option: { of: "screens/b", name: "X", status: "trying" } })), /of/);
  assert.match(optionMetaIssue("boards/screens/a~x.meta.json", JSON.stringify({ option: { of: "screens/a", name: " ", status: "trying" } })), /name/);
  assert.match(optionMetaIssue("boards/screens/a~x.meta.json", "{hỏng"), /JSON/);
  assert.equal(optionMetaIssue("boards/screens/a.meta.json", JSON.stringify({ title: "t" })), null);
  assert.equal(optionMetaIssue("boards/screens/a~x.tsx", "x"), null);
});

test("optionMetaIssue: the old Vietnamese statuses are still accepted; the shape it asks for uses the codes", () => {
  for (const st of ["đang thử", "đã chốt"]) assert.equal(optionMetaIssue("boards/screens/a~x.meta.json", JSON.stringify({ option: { of: "screens/a", name: "X", status: st } })), null, st);
  const bad = optionMetaIssue("boards/screens/a~x.meta.json", JSON.stringify({ option: { of: "screens/a", name: "X", status: "lạ" } }));
  assert.match(bad, /"status": "trying"/);
  assert.match(bad, /"adopted"/);
  assert.doesNotMatch(bad, /đang thử|đã chốt/);
  assert.match(optionMetaIssue("boards/screens/a~x.meta.json", JSON.stringify({ option: "x" })), /"status": "trying"/);
});

test("optionMetaIssue follows the language it is given (the project's): vi words it as before; default en", () => {
  const F = "boards/screens/a~x.meta.json";
  const issue = (content, lang) => optionMetaIssue(F, typeof content === "string" ? content : JSON.stringify(content), lang ? { lang } : undefined);
  const viShape = '"option": { "of": "screens/a", "name": "<tên ngắn, vd A. Bản gọn>", "status": "trying" }';
  assert.equal(issue("{hỏng", "vi"), `File thông tin phải là JSON hợp lệ (phương án cần ${viShape}).`);
  assert.equal(issue({ option: "x" }, "vi"), `Phương án phải có ${viShape} — không phải chữ trơn.`);
  assert.equal(issue({ option: { of: "screens/b", name: "X", status: "trying" } }, "vi"), `option.of phải là màn chính "screens/a". Dạng đúng: ${viShape}.`);
  assert.equal(issue({ option: { of: "screens/a", name: " ", status: "trying" } }, "vi"), `option.name phải là tên ngắn của phương án. Dạng đúng: ${viShape}.`);
  assert.equal(issue({ option: { of: "screens/a", name: "X", status: "lạ" } }, "vi"), `option.status phải là "trying" (hoặc "adopted"). Dạng đúng: ${viShape}.`);
  const enShape = '"option": { "of": "screens/a", "name": "<short name, e.g. A. Compact rows>", "status": "trying" }';
  for (const lang of [undefined, "en", "xx"]) {
    assert.equal(issue({ option: "x" }, lang), `An option needs ${enShape} — not plain text.`, String(lang));
  }
  assert.equal(issue("{bad"), `The info file must be valid JSON (an option needs ${enShape}).`);
  assert.equal(issue({ option: { of: "screens/b", name: "X", status: "trying" } }), `option.of must be the main screen "screens/a". Correct shape: ${enShape}.`);
  assert.equal(issue({ option: { of: "screens/a", name: " ", status: "trying" } }), `option.name must be the option's short name. Correct shape: ${enShape}.`);
  assert.equal(issue({ option: { of: "screens/a", name: "X", status: "odd" } }), `option.status must be "trying" (or "adopted"). Correct shape: ${enShape}.`);
  assert.equal(issue({ option: { of: "screens/a", name: "X", status: "trying" } }, "vi"), null);
});
