import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidVersionId, slugVersion, readIndex, readVersion, listVersions, createVersion, updateVersion, setLive, boardsDir, VERSION_STATUSES } from "./versions.mjs";
import { StudioError, errorText } from "./i18n.mjs";
import DATA from "./i18n/data.mjs";

/** The StudioError `fn` throws → { code, params, vi, en } (texts as a viewer reads them); anything else → the error. */
function viewerError(fn) {
  try { fn(); } catch (e) {
    return e instanceof StudioError ? { code: e.code, params: e.params, vi: errorText(e, "vi", DATA), en: errorText(e, "en", DATA) } : e;
  }
  return null;
}

const fileStatus = (root, v) => JSON.parse(fs.readFileSync(path.join(root, "versions", v, "version.json"), "utf8")).status;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ver-"));
  const v1 = path.join(root, "versions", "ban-1");
  fs.mkdirSync(path.join(v1, "boards", "screens"), { recursive: true });
  fs.mkdirSync(path.join(v1, "system", "components"), { recursive: true });
  fs.writeFileSync(path.join(v1, "boards", "screens", "a.tsx"), "export default 1");
  fs.writeFileSync(path.join(v1, "boards", "screens", "a.tsx.tmp"), "dang ghi");
  fs.writeFileSync(path.join(v1, "system", "tokens.css"), "/* t */");
  fs.writeFileSync(path.join(v1, "tsconfig.json"), "{}");
  fs.writeFileSync(path.join(v1, "version.json"), JSON.stringify({ id: "ban-1", title: "Bản 1", status: "đã lên app", from: null, createdAt: "2026-10-07T00:00:00Z", createdBy: "x", note: "" }));
  fs.writeFileSync(path.join(root, "versions", "index.json"), JSON.stringify({ live: "ban-1", order: ["ban-1"] }));
  return root;
}

test("isValidVersionId / slugVersion", () => {
  assert.ok(isValidVersionId("ban-2"));
  for (const bad of ["", "../x", "Ban 2", "ban_2", "-a"]) assert.ok(!isValidVersionId(bad), bad);
  assert.equal(slugVersion("Bản 2 — Đơn hàng mới"), "ban-2-don-hang-moi");
  assert.equal(slugVersion("!!!"), "version", "a title with no letters → the neutral default slug");
});

test("VERSION_STATUSES are neutral codes", () => {
  assert.deepEqual(VERSION_STATUSES, ["draft", "approved", "live", "archived"]);
});

test("version.json written with the old Vietnamese statuses is read with the codes; a write stores the code", () => {
  const root = fixture(); // ban-1: "đã lên app"
  assert.equal(readVersion(root, "ban-1").status, "live");
  assert.equal(listVersions(root)[0].status, "live");
  updateVersion(root, "ban-1", { note: "chỉ sửa ghi chú" });
  assert.equal(fileStatus(root, "ban-1"), "live", "any write migrates the stored status to its code");
  fs.writeFileSync(path.join(root, "versions", "ban-1", "version.json"), JSON.stringify({ id: "ban-1", title: "B", status: "kiểu riêng", from: null }));
  assert.equal(readVersion(root, "ban-1").status, "kiểu riêng", "an unknown status is kept as it is");
});

test("createVersion: full copy, skips .tmp files, unique id, first in the list", () => {
  const root = fixture();
  const v = createVersion(root, { from: "ban-1", title: "Bản 2", by: "u@x" });
  assert.equal(v.id, "ban-2");
  assert.equal(fs.readFileSync(path.join(boardsDir(root, "ban-2"), "screens", "a.tsx"), "utf8"), "export default 1");
  assert.ok(!fs.existsSync(path.join(boardsDir(root, "ban-2"), "screens", "a.tsx.tmp")));
  assert.ok(fs.existsSync(path.join(root, "versions", "ban-2", "system", "tokens.css")));
  assert.equal(createVersion(root, { from: "ban-1", title: "Bản 2", by: "u@x" }).id, "ban-2-2");
  assert.deepEqual(readIndex(root).order, ["ban-2-2", "ban-2", "ban-1"]);
  assert.equal(listVersions(root).find((x) => x.id === "ban-2").status, "draft");
  assert.equal(fileStatus(root, "ban-2"), "draft");
});

test("createVersion from a version that does not exist / a bad id → error", () => {
  const root = fixture();
  assert.throws(() => createVersion(root, { from: "khong-co", title: "X", by: "u" }));
  assert.throws(() => boardsDir(root, "../etc"));
});

test("errors a viewer can meet are StudioErrors with a code; vi words them as before, en in English", () => {
  const root = fixture();
  assert.deepEqual(viewerError(() => createVersion(root, { from: "khong-co", title: "X", by: "u" })),
    { code: "versionSourceMissing", params: { id: "khong-co" }, vi: "không có phiên bản khong-co", en: "Version khong-co does not exist" });
  assert.deepEqual(viewerError(() => createVersion(root, { from: "ban-1", title: "  ", by: "u" })),
    { code: "versionTitleMissing", params: {}, vi: "thiếu tên phiên bản", en: "The version needs a name" });
  assert.equal(viewerError(() => updateVersion(root, "ban-1", { title: " " })).code, "versionTitleMissing");
  assert.deepEqual(viewerError(() => boardsDir(root, "../etc")),
    { code: "versionIdInvalid", params: { id: "../etc" }, vi: "id phiên bản không hợp lệ: ../etc", en: "Invalid version id: ../etc" });
  const bad = viewerError(() => updateVersion(root, "ban-1", { status: "bogus" }));
  assert.equal(bad.vi, "trạng thái không hợp lệ: bogus");
  assert.equal(bad.en, "Invalid status: bogus");
});

test("updateVersion + setLive", () => {
  const root = fixture();
  createVersion(root, { from: "ban-1", title: "Bản 2", by: "u" });
  assert.equal(updateVersion(root, "ban-2", { status: "approved", note: "xong" }).status, "approved");
  assert.equal(updateVersion(root, "ban-2", { status: "lưu trữ" }).status, "archived", "an old word from an old page is accepted, the code is stored");
  assert.equal(fileStatus(root, "ban-2"), "archived");
  assert.throws(() => updateVersion(root, "ban-2", { status: "linh tinh" }), (e) => e instanceof StudioError && e.code === "badVersionStatus" && e.params.status === "linh tinh" && e.status === 400);
  setLive(root, "ban-2");
  assert.equal(readIndex(root).live, "ban-2");
  assert.equal(listVersions(root).find((x) => x.live).id, "ban-2");
  assert.equal(fileStatus(root, "ban-2"), "live");
});

test("setLive: the root tsconfig.json (the studio UI) points @ds at the new live version", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "tsconfig.json"), '{\n  // chú thích\n  "compilerOptions": { "paths": { "@ds": ["./versions/ban-1/system/components/index.ts"], "@ds/*": ["./versions/ban-1/system/components/*"] } }\n}\n');
  createVersion(root, { from: "ban-1", title: "Bản 2", by: "u" });
  setLive(root, "ban-2");
  const ts = fs.readFileSync(path.join(root, "tsconfig.json"), "utf8");
  assert.ok(ts.includes("./versions/ban-2/system/components/index.ts") && ts.includes("./versions/ban-2/system/components/*") && !ts.includes("ban-1/system"), ts);
  assert.ok(ts.includes("// chú thích"));
});

import { boardChanged } from "./versions.mjs";
test("boardChanged: compares every file of a screen (drawing, info, 2 specs) with the source version", () => {
  const root = fixture();
  createVersion(root, { from: "ban-1", title: "Bản 2", by: "u" });
  assert.equal(boardChanged(root, "ban-2", "ban-1", "screens/a"), false);
  fs.writeFileSync(path.join(boardsDir(root, "ban-2"), "screens", "a.behavior.md"), "mới");
  assert.equal(boardChanged(root, "ban-2", "ban-1", "screens/a"), true, "an added spec = changed");
  fs.writeFileSync(path.join(boardsDir(root, "ban-2"), "screens", "b.tsx"), "x");
  assert.equal(boardChanged(root, "ban-2", "ban-1", "screens/b"), true, "a new screen = changed");
  assert.equal(boardChanged(root, "ban-1", null, "screens/a"), false, "the original version has no source");
});
