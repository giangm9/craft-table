import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { optionId, optionBase, isOptionId, createOption, adoptOption } from "./options.mjs";
import { entryIdFromPath, isValidEntryId } from "./entries.mjs";
import { StudioError, errorText } from "./i18n.mjs";
import DATA from "./i18n/data.mjs";

/** `fn` must throw a StudioError `code` → its text in Vietnamese (as a vi viewer reads it, the wording of before). */
function rejects(fn, code) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err instanceof StudioError, `StudioError expected, got ${err}`);
  assert.equal(err.code, code);
  return errorText(err, "vi", DATA);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opt-"));
  const b = path.join(root, "versions", "ban-1", "boards", "screens", "orders");
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(root, "versions", "ban-1", "version.json"), "{}");
  for (const [n, title] of [["list", "Đơn hàng"], ["today", "Hôm nay"]]) {
    fs.writeFileSync(path.join(b, `${n}.tsx`), `export default function B() { return <p>${n} gốc</p>; }\n`);
    fs.writeFileSync(path.join(b, `${n}.meta.json`), JSON.stringify({ title, section: "Màn hình", group: "Bán hàng", order: 2 }, null, 2) + "\n");
  }
  fs.writeFileSync(path.join(b, "list.behavior.md"), "# Đơn hàng\n");
  return { root, b };
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

test("optionId: a name with diacritics / spaces → slug; recognizes option ids", () => {
  assert.equal(optionId("screens/orders/list", "Ba nút bấm thẳng"), "screens/orders/list~ba-nut-bam-thang");
  assert.equal(optionId("screens/orders/list", "  Đổi màu!!  "), "screens/orders/list~doi-mau");
  assert.equal(optionId("screens/orders/list", "!!!"), "screens/orders/list~option", "no letters → the neutral default slug");
  assert.equal(isOptionId("screens/orders/list~ba-nut"), true);
  assert.equal(isOptionId("screens/orders/list"), false);
  assert.equal(optionBase("screens/orders/list~ba-nut"), "screens/orders/list");
  assert.equal(optionBase("screens/orders/list"), "screens/orders/list");
});

test("an id with '~' is valid (once, in the last segment); '..~x', '~' in a folder, two '~' → not valid", () => {
  assert.equal(isValidEntryId("screens/orders/list~ba-nut"), true);
  assert.equal(entryIdFromPath("screens/orders/list~ba-nut.tsx"), "screens/orders/list~ba-nut");
  for (const bad of ["..~x", "screens/..~x", "screens~x/a", "screens/a~b~c", "screens/a~", "screens/a~B", "~x", "screens/~x"]) {
    assert.equal(isValidEntryId(bad), false, bad);
    assert.equal(entryIdFromPath(`${bad}.tsx`), null, bad);
  }
});

test("createOption: copies every file of each screen, meta gets option {of, name, status, createdBy}; a duplicate name → -2", () => {
  const { root, b } = fixture();
  const ids = createOption(root, "ban-1", { entries: ["screens/orders/list", "screens/orders/today"], name: "Ba nút", by: "a@x" });
  assert.deepEqual(ids, ["screens/orders/list~ba-nut", "screens/orders/today~ba-nut"]);
  assert.equal(fs.readFileSync(path.join(b, "list~ba-nut.tsx"), "utf8"), fs.readFileSync(path.join(b, "list.tsx"), "utf8"));
  assert.equal(fs.readFileSync(path.join(b, "list~ba-nut.behavior.md"), "utf8"), "# Đơn hàng\n");
  assert.ok(!fs.existsSync(path.join(b, "today~ba-nut.behavior.md")), "the original screen has no spec → none created");
  const m = readJson(path.join(b, "list~ba-nut.meta.json"));
  assert.equal(m.title, "Đơn hàng");
  assert.equal(m.option.of, "screens/orders/list");
  assert.equal(m.option.name, "Ba nút");
  assert.equal(m.option.status, "trying");
  assert.equal(m.option.createdBy, "a@x");
  const again = createOption(root, "ban-1", { entries: ["screens/orders/list"], name: "Ba nút", by: "b@x" });
  assert.deepEqual(again, ["screens/orders/list~ba-nut-2"]);
});

test("createOption refuses: missing screen, a screen that is already an option, unknown version, empty name", () => {
  const { root } = fixture();
  assert.equal(rejects(() => createOption(root, "ban-1", { entries: ["screens/orders/khong-co"], name: "X", by: "a" }), "optionScreenMissing"), "không có màn: screens/orders/khong-co");
  createOption(root, "ban-1", { entries: ["screens/orders/list"], name: "X", by: "a" });
  assert.equal(rejects(() => createOption(root, "ban-1", { entries: ["screens/orders/list~x"], name: "Y", by: "a" }), "optionScreenIsOption"), "màn đã là phương án: screens/orders/list~x");
  assert.equal(rejects(() => createOption(root, "../x", { entries: ["screens/orders/list"], name: "Y", by: "a" }), "optionVersionMissing"), "không có phiên bản: ../x");
  assert.equal(rejects(() => createOption(root, "ban-2", { entries: ["screens/orders/list"], name: "Y", by: "a" }), "optionVersionMissing"), "không có phiên bản: ban-2");
  assert.equal(rejects(() => createOption(root, "ban-1", { entries: [], name: "Y", by: "a" }), "optionNoScreens"), "chọn ít nhất một màn");
  assert.equal(rejects(() => createOption(root, "ban-1", { entries: ["screens/orders/list"], name: "  ", by: "a" }), "optionNameMissing"), "thiếu tên phương án");
  assert.equal(rejects(() => createOption(root, "ban-1", { entries: ["../x"], name: "Y", by: "a" }), "optionScreenIdInvalid"), "id màn không hợp lệ: ../x");
});

test("option errors in English (a viewer whose language is en)", () => {
  const { root } = fixture();
  const en = (fn) => { try { fn(); } catch (e) { return errorText(e, "en", DATA); } return null; };
  assert.equal(en(() => createOption(root, "ban-1", { entries: ["screens/orders/khong-co"], name: "X", by: "a" })), "No such screen: screens/orders/khong-co");
  assert.equal(en(() => createOption(root, "ban-1", { entries: [], name: "Y", by: "a" })), "Pick at least one screen");
  assert.equal(en(() => createOption(root, "ban-1", { entries: ["screens/orders/list"], name: " ", by: "a" })), "The option needs a name");
  assert.equal(en(() => adoptOption(root, "ban-1", "screens/orders/list", { by: "c" })), "Not an option: screens/orders/list");
  assert.equal(en(() => adoptOption(root, "ban-1", "screens/orders/list~zz", { by: "c" })), "No such option: screens/orders/list~zz");
});

test("adoptOption: overwrites the main screen with the option (the main screen has no option field), the option becomes 'adopted'", () => {
  const { root, b } = fixture();
  const [id] = createOption(root, "ban-1", { entries: ["screens/orders/list"], name: "Ba nút", by: "a@x" });
  fs.writeFileSync(path.join(b, "list~ba-nut.tsx"), "export default function B() { return <p>ba nút</p>; }\n");
  fs.writeFileSync(path.join(b, "list~ba-nut.behavior.md"), "# Đơn hàng — ba nút\n");
  const om = readJson(path.join(b, "list~ba-nut.meta.json"));
  fs.writeFileSync(path.join(b, "list~ba-nut.meta.json"), JSON.stringify({ ...om, desc: "Ba nút bấm thẳng." }, null, 2) + "\n");
  const written = adoptOption(root, "ban-1", id, { by: "c@x" });
  assert.deepEqual(written.sort(), ["screens/orders/list.behavior.md", "screens/orders/list.meta.json", "screens/orders/list.tsx", "screens/orders/list~ba-nut.meta.json"].sort());
  assert.match(fs.readFileSync(path.join(b, "list.tsx"), "utf8"), /ba nút/);
  assert.equal(fs.readFileSync(path.join(b, "list.behavior.md"), "utf8"), "# Đơn hàng — ba nút\n");
  const main = readJson(path.join(b, "list.meta.json"));
  assert.equal(main.option, undefined);
  assert.equal(main.desc, "Ba nút bấm thẳng.");
  assert.equal(main.title, "Đơn hàng");
  const opt = readJson(path.join(b, "list~ba-nut.meta.json"));
  assert.equal(opt.option.status, "adopted");
  assert.equal(opt.option.adoptedBy, "c@x");
  assert.equal(rejects(() => adoptOption(root, "ban-1", "screens/orders/list", { by: "c" }), "optionNotOption"), "không phải phương án: screens/orders/list");
  assert.equal(rejects(() => adoptOption(root, "ban-1", "screens/orders/list~zz", { by: "c" }), "optionMissing"), "không có phương án: screens/orders/list~zz");
});

test("renameOption: renames the whole group of options created together (ids and files unchanged); other options unchanged; empty name → error", async () => {
  const { renameOption } = await import("./options.mjs");
  const { root, b } = fixture();
  const ids = createOption(root, "ban-1", { entries: ["screens/orders/list", "screens/orders/today"], name: "Ba nút", by: "a" });
  createOption(root, "ban-1", { entries: ["screens/orders/list"], name: "Hai nút", by: "a" });
  const renamed = renameOption(root, "ban-1", ids[0], { name: "  Ba nút to  " });
  assert.deepEqual(renamed.sort(), [...ids].sort());
  for (const f of ["list~ba-nut.meta.json", "today~ba-nut.meta.json"]) {
    const m = readJson(path.join(b, f));
    assert.equal(m.option.name, "Ba nút to", f);
    assert.equal(m.option.status, "trying", f);
    assert.equal(m.title, f.startsWith("list") ? "Đơn hàng" : "Hôm nay", f);
  }
  assert.ok(fs.existsSync(path.join(b, "list~ba-nut.tsx")), "ids and files unchanged");
  assert.equal(readJson(path.join(b, "list~hai-nut.meta.json")).option.name, "Hai nút");
  assert.equal(rejects(() => renameOption(root, "ban-1", ids[0], { name: "  " }), "optionNameMissing"), "thiếu tên phương án");
  assert.equal(rejects(() => renameOption(root, "ban-1", "screens/orders/list", { name: "X" }), "optionNotOption"), "không phải phương án: screens/orders/list");
  assert.equal(rejects(() => renameOption(root, "ban-1", "screens/orders/list~zz", { name: "X" }), "optionMissing"), "không có phương án: screens/orders/list~zz");
});

test("adoptOption: an option Claude wrote in the wrong shape (option is plain text) → adopting still gives clean info (no junk numeric keys)", () => {
  const { root, b } = fixture();
  fs.writeFileSync(path.join(b, "list~a-gon.tsx"), "export default function B() { return <p>gọn</p>; }\n");
  fs.writeFileSync(path.join(b, "list~a-gon.meta.json"), JSON.stringify({ title: "Đơn hàng · A. Gọn", section: "Màn hình", group: "Bán hàng", option: "a-gon" }, null, 2) + "\n");
  adoptOption(root, "ban-1", "screens/orders/list~a-gon", { by: "c@x" });
  const opt = readJson(path.join(b, "list~a-gon.meta.json")).option;
  assert.deepEqual(Object.keys(opt).filter((k) => /^\d+$/.test(k)), []);
  assert.equal(opt.of, "screens/orders/list");
  assert.equal(opt.name, "A. Gọn");
  assert.equal(opt.status, "adopted");
  assert.equal(readJson(path.join(b, "list.meta.json")).option, undefined);
});

test("an option written with the old Vietnamese status: rename and adopt store the codes", async () => {
  const { renameOption } = await import("./options.mjs");
  const { root, b } = fixture();
  fs.writeFileSync(path.join(b, "list~cu.tsx"), "export default function B() { return <p>cũ</p>; }\n");
  const old = { title: "Đơn hàng", option: { of: "screens/orders/list", name: "Cũ", status: "đang thử", createdBy: "a", createdAt: "t" } };
  fs.writeFileSync(path.join(b, "list~cu.meta.json"), JSON.stringify(old, null, 2) + "\n");
  renameOption(root, "ban-1", "screens/orders/list~cu", { name: "Cũ hơn" });
  assert.equal(readJson(path.join(b, "list~cu.meta.json")).option.status, "trying");
  adoptOption(root, "ban-1", "screens/orders/list~cu", { by: "c" });
  assert.equal(readJson(path.join(b, "list~cu.meta.json")).option.status, "adopted");
});

test("removeOption: deletes exactly the option's files, the main screen stays intact; an id that is not an option → error", async () => {
  const { removeOption } = await import("./options.mjs");
  const { root, b } = fixture();
  const [id] = createOption(root, "ban-1", { entries: ["screens/orders/list"], name: "Thử", by: "a" });
  const gone = removeOption(root, "ban-1", id);
  assert.deepEqual(gone.sort(), ["screens/orders/list~thu.behavior.md", "screens/orders/list~thu.meta.json", "screens/orders/list~thu.tsx"]);
  assert.ok(fs.existsSync(path.join(b, "list.tsx")) && fs.existsSync(path.join(b, "list.behavior.md")));
  assert.equal(rejects(() => removeOption(root, "ban-1", "screens/orders/list"), "optionNotOption"), "không phải phương án: screens/orders/list");
});
