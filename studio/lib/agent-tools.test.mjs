// The sandbox tools of Claude in the studio — locked to a version + thread. Temp folders, fake images (no Puppeteer).
// Their texts follow the PROJECT language (lang); most tests here run a Vietnamese project, the "en" tests an English one.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAgentTools, defaultRules, RULES_ROOT, ruleTopics } from "./agent-tools.mjs";
import { saveThread } from "./threads.mjs";
import { VIETNAMESE } from "./i18n-gate.mjs";

const IMG = "0123456789abcdef.png", OTHER_IMG = "fedcba9876543210.png";

function fixture({ messages = 2 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "at-"));
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "app-")); // the project's source repo (read-only)
  const b1 = path.join(root, "versions", "ban-1", "boards", "screens");
  fs.mkdirSync(b1, { recursive: true });
  fs.mkdirSync(path.join(root, "versions", "ban-1", "system", "components"), { recursive: true });
  fs.mkdirSync(path.join(root, "versions", "ban-2", "boards", "screens"), { recursive: true });
  fs.writeFileSync(path.join(root, "versions", "ban-1", "version.json"), "{}");
  fs.writeFileSync(path.join(root, "versions", "ban-1", "tsconfig.json"), "{}");
  fs.writeFileSync(path.join(b1, "a.tsx"), "export default function A() {\n  return <p>Xin chào</p>;\n}\n// Xin nữa\n");
  fs.writeFileSync(path.join(b1, "a.meta.json"), JSON.stringify({ title: "Màn A", scenarios: [{ id: "it-don", title: "Ít đơn", desc: "Mới có vài đơn" }, { id: "loi", title: "Lỗi" }] }));
  fs.writeFileSync(path.join(b1, "a.behavior.md"), "# Màn A\n");
  fs.writeFileSync(path.join(b1, "big.tsx"), Array.from({ length: 1000 }, (_, i) => `// dòng ${i + 1} Xin`).join("\n"));
  fs.writeFileSync(path.join(b1, "big.meta.json"), JSON.stringify({ title: "To" }));
  fs.symlinkSync("/etc/hostname", path.join(b1, "link.tsx"));
  fs.writeFileSync(path.join(root, "versions", "ban-1", "system", "components", "x.tsx"), "export const X = 1;\n");
  fs.writeFileSync(path.join(root, "versions", "ban-2", "boards", "screens", "a.tsx"), "BAN 2\n");
  fs.mkdirSync(path.join(app, "src"), { recursive: true });
  fs.mkdirSync(path.join(app, "secrets"), { recursive: true });
  fs.writeFileSync(path.join(app, "src", "x.ts"), "export const appCode = 1;\n");
  fs.writeFileSync(path.join(app, "secrets", "x.ts"), "SECRET\n");
  const threadsDir = path.join(root, "threads"), uploadsDir = path.join(root, "data", "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, IMG), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  fs.writeFileSync(path.join(uploadsDir, OTHER_IMG), Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]));
  const ref = (scenario, viewport) => ({ scenario, viewport, rect: { x: 10, y: 20, w: 30, h: 40 }, texts: [] });
  const msgs = Array.from({ length: messages }, (_, i) => ({
    id: `m${i + 1}`, role: i % 2 ? "claude" : "user", author: i % 2 ? "claude" : "u@x", at: "2026-10-12T00:00:00Z",
    text: `tin ${i + 1}${i === 0 ? " [#1] [#2]" : ""}`, refs: i === 0 ? [ref("it-don", "mobile"), ref(null, "desktop")] : [], images: i === 0 ? [IMG] : [],
  }));
  const source = { path: app, label: "web-app", roots: ["src"], extensions: ["ts"] };
  return { root, app, source, threadsDir, uploadsDir, b1, msgs };
}

async function setup(opts = {}) {
  const f = fixture(opts);
  await saveThread(f.threadsDir, { id: "t_abc", entry: "screens/a", version: "ban-1", title: "T", createdBy: "u@x", createdAt: "x", updatedAt: "x", status: "open", messages: f.msgs, agent: { state: "idle" } });
  const calls = [];
  const shots = {
    frame: async (a) => { calls.push(["frame", a]); return { png: Buffer.from("PNGF"), errors: [], height: 1234 }; },
    region: async (a) => { calls.push(["region", a]); return { png: Buffer.from("PNGR"), texts: ["Xin chào"] }; },
    locate: async (a) => { calls.push(["locate", a]); return [{ tag: "p", text: "Xin chào", x: 1, y: 2, w: 3, h: 4 }]; },
    specPage: async (a) => { calls.push(["spec", a]); return { png: Buffer.from("PNGS"), report: { diagrams: 1, badDiagrams: [], embeds: 0, badEmbeds: [], rules: 2, errs: [] } }; },
    shrink: async (buf) => { calls.push(["shrink", buf.length]); return Buffer.from("JPEGNHO"); },
  };
  const checks = opts.checks ?? { typecheck: async () => ({ ok: true, out: "" }), lint: (root, v, entries) => ({ ok: true, issues: [], entries }) };
  const lang = opts.lang ?? "vi";
  const tools = createAgentTools({ root: f.root, source: "source" in opts ? opts.source : f.source, ctx: { version: "ban-1", threadId: "t_abc", entry: "screens/a" }, shots, checks, threadsDir: f.threadsDir, uploadsDir: f.uploadsDir, lang, rulesDirs: [defaultRules(lang)] });
  const call = (name, args = {}) => tools.find((t) => t.name === name).handler(args);
  const text = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return { ...f, tools, call, text, calls };
}

test("12 tools, each with a description + schema", async () => {
  const s = await setup();
  assert.deepEqual(s.tools.map((t) => t.name).sort(), ["check", "edit", "list", "locate", "read", "read_thread", "rules", "search", "view_frame", "view_image", "view_region", "write"]);
  for (const t of s.tools) assert.ok(t.description.length > 10 && t.shape && typeof t.handler === "function", t.name);
});

test("list: screens (name + scenario count), scenarios, a screen's files", async () => {
  const s = await setup();
  assert.match(s.text(await s.call("list", { what: "screens" })), /screens\/a — Màn A \(2 kịch bản\)/);
  const sc = s.text(await s.call("list", { what: "scenarios", entry: "screens/a" }));
  assert.match(sc, /it-don — Ít đơn: Mới có vài đơn/);
  const files = s.text(await s.call("list", { what: "files", entry: "screens/a" }));
  for (const x of ["boards/screens/a.tsx", "boards/screens/a.meta.json", "boards/screens/a.behavior.md"]) assert.ok(files.includes(x), x);
  assert.match(s.text(await s.call("list", { what: "system" })), /system\/components\/x\.tsx/);
});

test("read: line numbers; a long file is cut at 400 lines with how to read on; the app source (src:) reads within its safe area", async () => {
  const s = await setup();
  assert.match(s.text(await s.call("read", { path: "boards/screens/a.tsx" })), /^\s*2│\s+return <p>Xin chào<\/p>;/m);
  const big = s.text(await s.call("read", { path: "boards/screens/big.tsx" }));
  assert.match(big, /400│/);
  assert.doesNotMatch(big, /401│/);
  assert.match(big, /còn 600 dòng.*from=401/);
  assert.match(s.text(await s.call("read", { path: "boards/screens/big.tsx", from: 990 })), /1000│/);
  assert.match(s.text(await s.call("read", { path: "src:src/x.ts" })), /export const appCode/);
});

test("scope: no reading/editing outside the thread's version, symlinks pointing out, source outside its area, config files", async () => {
  const s = await setup();
  for (const p of ["../ban-2/boards/screens/a.tsx", "boards/../../ban-2/boards/screens/a.tsx", "boards/screens/link.tsx", "/etc/passwd", "src:../secrets/x.ts", "src:secrets/x.ts"]) {
    const r = await s.call("read", { path: p });
    assert.equal(r.isError, true, p);
    assert.doesNotMatch(s.text(r), /BAN 2|SECRET|root:/, p);
  }
  for (const [tool, args] of [["edit", { path: "version.json", old: "{}", new: "{1}" }], ["write", { path: "tsconfig.json", content: "x" }], ["write", { path: "boards/x.sh", content: "x" }], ["write", { path: "../ban-2/boards/screens/a.tsx", content: "x" }], ["write", { path: "notes.md", content: "x" }]]) {
    assert.equal((await s.call(tool, args)).isError, true, `${tool} ${args.path}`);
  }
  assert.equal(fs.readFileSync(path.join(s.root, "versions", "ban-2", "boards", "screens", "a.tsx"), "utf8"), "BAN 2\n");
});

test("CSS: no writing/editing CSS with @plugin/@config/@source/a foreign @import (Tailwind would run code on the server)", async () => {
  const s = await setup();
  const css = path.join(s.root, "versions", "ban-1", "system", "tokens.css");
  fs.writeFileSync(css, `@import "tailwindcss";\n@theme { --x: 1; }\n`);
  assert.equal((await s.call("write", { path: "system/evil.css", content: `@plugin "./x.ts";` })).isError, true);
  assert.ok(!fs.existsSync(path.join(s.root, "versions", "ban-1", "system", "evil.css")));
  const r = await s.call("edit", { path: "system/tokens.css", old: `@theme { --x: 1; }`, new: `@config "./x.js";\n@theme { --x: 1; }` });
  assert.equal(r.isError, true);
  assert.match(s.text(r), /@config/);
  assert.match(s.text(r), /Không được dùng trong CSS/);
  assert.doesNotMatch(fs.readFileSync(css, "utf8"), /@config/);
  assert.equal((await s.call("write", { path: "system/ok.css", content: `.a { color: red; }` })).isError, undefined);
});

test("write/edit: option info (<screen>~<name>.meta.json) in the wrong shape → refused, with the right shape; right shape → written", async () => {
  const s = await setup();
  const bad = await s.call("write", { path: "boards/screens/a~ba-nut.meta.json", content: JSON.stringify({ title: "A · Ba nút", option: "ba-nut" }) });
  assert.equal(bad.isError, true);
  assert.match(s.text(bad), /"of": "screens\/a"/);
  assert.ok(!fs.existsSync(path.join(s.b1, "a~ba-nut.meta.json")), "the wrong file is not written");
  const good = JSON.stringify({ title: "A · Ba nút", option: { of: "screens/a", name: "Ba nút", status: "đang thử" } }, null, 2);
  assert.equal((await s.call("write", { path: "boards/screens/a~ba-nut.meta.json", content: good })).isError, undefined);
  const e = await s.call("edit", { path: "boards/screens/a~ba-nut.meta.json", old: '"name": "Ba nút"', new: '"name": ""' });
  assert.equal(e.isError, true, "an edit that empties the name → refused");
});

test("write creates files in a NEW folder (screens for a new role); a new folder still cannot reach outside", async () => {
  const s = await setup();
  assert.equal((await s.call("write", { path: "boards/screens/vai-moi/x.tsx", content: "export default function X() { return null; }\n" })).isError, undefined);
  assert.ok(fs.existsSync(path.join(s.b1, "vai-moi", "x.tsx")));
  assert.equal((await s.call("write", { path: "boards/screens/moi/../../../../ban-2/boards/x.tsx", content: "x" })).isError, true);
  fs.symlinkSync("/tmp", path.join(s.b1, "tro-ra-ngoai"));
  assert.equal((await s.call("write", { path: "boards/screens/tro-ra-ngoai/moi/x.tsx", content: "x" })).isError, true);
});

test("read_thread: [#k] in the text becomes the thread-wide mark number (matches view_region)", async () => {
  const s = await setup({ messages: 3 });
  // Message 3 has 1 mark (the 3rd of the whole thread); its text says [#1] = the message's own first mark.
  const t = JSON.parse(fs.readFileSync(path.join(s.threadsDir, "t_abc.json"), "utf8"));
  t.messages[2].text = "sửa chỗ này [#1]";
  t.messages[2].refs = [{ scenario: "loi", viewport: "desktop", rect: { x: 1, y: 1, w: 9, h: 9 }, texts: [] }];
  fs.writeFileSync(path.join(s.threadsDir, "t_abc.json"), JSON.stringify(t));
  const out = s.text(await s.call("read_thread"));
  assert.match(out, /sửa chỗ này \[#3\]/);
  assert.match(out, /#3 \(kịch bản loi · desktop\)/);
});

test("search: plain text (not a regex) — a backtracking-style pattern does not hang", async () => {
  const s = await setup();
  const t0 = Date.now();
  assert.match(s.text(await s.call("search", { pattern: "(a+)+$" })), /Không thấy/);
  assert.ok(Date.now() - t0 < 2000);
  assert.match(s.text(await s.call("search", { pattern: "xin CHÀO" })), /boards\/screens\/a\.tsx:2:/);
});

test("check: lint defaults to the thread's screen only; typecheck skips the studio UI (the agent cannot edit it)", async () => {
  const s = await setup();
  const seen = {};
  const tools = createAgentTools({
    root: s.root, source: s.source, ctx: { version: "ban-1", threadId: "t_abc", entry: "screens/a" }, threadsDir: s.threadsDir, uploadsDir: s.uploadsDir, shots: {},
    checks: { typecheck: async (root, v, opts) => { seen.tc = opts; return { ok: true, out: "✓" }; }, lint: (root, v, entries) => { seen.lint = entries; return { ok: true, issues: [] }; } },
  });
  const call = (n, a) => tools.find((t) => t.name === n).handler(a);
  await call("check", { what: "lint" });
  assert.deepEqual(seen.lint, ["screens/a"]);
  await call("check", { what: "typecheck" });
  assert.equal(seen.tc?.studio, false);
});

test("search: file:line; over 60 hits → cut + reported; finds text in the app source", async () => {
  const s = await setup();
  assert.match(s.text(await s.call("search", { pattern: "Xin chào" })), /boards\/screens\/a\.tsx:2:/);
  const many = s.text(await s.call("search", { pattern: "Xin" }));
  assert.equal(many.split("\n").filter((l) => /^boards\//.test(l)).length, 60);
  assert.match(many, /còn \d+ kết quả/);
  assert.match(s.text(await s.call("search", { pattern: "appCode", in: "source" })), /^src:src\/x\.ts:1:/m);
});

test("source repo: tools name it by its label; no source configured → no source reading at all (both languages)", async () => {
  for (const lang of ["vi", "en"]) {
    const s = await setup({ lang });
    const desc = (t) => s.tools.find((x) => x.name === t).description;
    assert.match(desc("read"), /src:/);
    assert.match(desc("read"), /web-app/);
    const none = await setup({ source: null, lang });
    const d = (t) => none.tools.find((x) => x.name === t).description;
    assert.doesNotMatch(d("read") + d("search"), /src:|source/, lang);
    assert.equal((await none.call("read", { path: "src:src/x.ts" })).isError, true);
    assert.equal((await none.call("search", { pattern: "appCode", in: "source" })).isError, true);
  }
});

test("edit: the old text must appear exactly once; write creates a new file in boards", async () => {
  const s = await setup();
  const f = path.join(s.b1, "a.tsx");
  const before = fs.readFileSync(f, "utf8");
  assert.equal((await s.call("edit", { path: "boards/screens/a.tsx", old: "không có", new: "x" })).isError, true);
  assert.equal((await s.call("edit", { path: "boards/screens/a.tsx", old: "Xin", new: "Chào" })).isError, true); // twice
  assert.equal(fs.readFileSync(f, "utf8"), before);
  const ok = await s.call("edit", { path: "boards/screens/a.tsx", old: "Xin chào", new: "Chào bạn" });
  assert.equal(ok.isError, undefined);
  assert.match(fs.readFileSync(f, "utf8"), /<p>Chào bạn<\/p>/);
  await s.call("write", { path: "boards/screens/b.meta.json", content: "{\"title\":\"B\"}" });
  assert.equal(fs.readFileSync(path.join(s.b1, "b.meta.json"), "utf8"), "{\"title\":\"B\"}");
});

test("read_thread: the thread's messages with mark ids + images; 25 messages → a page of 20 + how to read on", async () => {
  const s = await setup({ messages: 25 });
  const t = s.text(await s.call("read_thread"));
  assert.match(t, /#1 \(kịch bản it-don · mobile\)/);
  assert.match(t, /#2 \(không kịch bản · desktop\)/);
  assert.match(t, new RegExp(`ảnh 1: ${IMG}`));
  assert.match(t, /tin 20/);
  assert.doesNotMatch(t, /tin 21/);
  assert.match(t, /from=21/);
  assert.match(s.text(await s.call("read_thread", { from: 21 })), /tin 25/);
});

test("view_frame / view_region / locate shoot the right version + thread; a missing mark → error", async () => {
  const s = await setup();
  const fr = await s.call("view_frame", { entry: "screens/a", scenario: "it-don", viewport: "mobile" });
  assert.equal(fr.content[0].type, "image");
  assert.equal(fr.content[0].data, Buffer.from("PNGF").toString("base64"));
  assert.deepEqual(s.calls[0], ["frame", { version: "ban-1", entry: "screens/a", scenario: "it-don", viewport: "mobile", part: "top" }]);
  assert.match(s.text(fr), /^Khung screens\/a · it-don · mobile · trang cao 1234px$/);
  const rg = await s.call("view_region", { n: 1 });
  assert.equal(rg.content[0].type, "image");
  assert.match(s.text(rg), /Xin chào/);
  assert.match(s.text(rg), /Vùng #1: kịch bản it-don · mobile · x=10 y=20 rộng 30 cao 40/);
  assert.equal(s.calls[1][1].ref.scenario, "it-don");
  assert.equal(s.calls[1][1].version, "ban-1");
  assert.equal((await s.call("view_region", { n: 9 })).isError, true);
  assert.equal((await s.call("view_frame", { entry: "../x" })).isError, true);
  assert.match(s.text(await s.call("locate", { entry: "screens/a", scenario: "-", viewport: "desktop", text: "Xin" })), /@khoanh\(-, desktop, 1, 2, 3, 4\)/);
});

test("view_region: a mark drawn on an option (ref.entry) → shoots that option; read_thread says so", async () => {
  const s = await setup();
  const messages = [...s.msgs, { id: "m9", role: "user", author: "u@x", at: "x", text: "đây [#1]", refs: [{ scenario: null, viewport: "desktop", rect: { x: 1, y: 2, w: 3, h: 4 }, texts: [], entry: "screens/a~ba-nut" }], images: [], viewing: "screens/a~ba-nut" }];
  await saveThread(s.threadsDir, { id: "t_abc", entry: "screens/a", version: "ban-1", title: "T", createdBy: "u@x", createdAt: "x", updatedAt: "x", status: "open", messages, agent: { state: "idle" } });
  await s.call("view_region", { n: 3 });
  assert.equal(s.calls.at(-1)[1].entry, "screens/a~ba-nut");
  await s.call("view_region", { n: 1 });
  assert.equal(s.calls.at(-1)[1].entry, "screens/a", "an old mark (no screen stored) → the thread's screen");
  assert.match(s.text(await s.call("read_thread", {})), /#3 \(không kịch bản · desktop · trên screens\/a~ba-nut\)/);
});

test("view_image: only images attached to this thread", async () => {
  const s = await setup();
  const ok = await s.call("view_image", { id: IMG });
  assert.equal(ok.content[0].type, "image");
  assert.equal(ok.content[0].mimeType, "image/png");
  assert.equal((await s.call("view_image", { id: OTHER_IMG })).isError, true);
  assert.equal((await s.call("view_image", { id: "../../etc/passwd" })).isError, true);
});

test("view_image: an image too big for Claude (> 3.5 MB; the API takes at most 5 MB) → shrunk to JPEG; a small one is sent as is", async () => {
  const s = await setup();
  const BIG = "aaaaaaaaaaaaaaaa.png";
  fs.writeFileSync(path.join(s.uploadsDir, BIG), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(4 * 1024 * 1024)]));
  const messages = s.msgs.map((m, i) => (i === 0 ? { ...m, images: [...m.images, BIG] } : m));
  await saveThread(s.threadsDir, { id: "t_abc", entry: "screens/a", version: "ban-1", title: "T", createdBy: "u@x", createdAt: "x", updatedAt: "x", status: "open", messages, agent: { state: "idle" } });
  const r = await s.call("view_image", { id: BIG });
  const img = r.content.find((c) => c.type === "image");
  assert.equal(img.mimeType, "image/jpeg");
  assert.equal(Buffer.from(img.data, "base64").toString(), "JPEGNHO");
  assert.match(s.text(r), /thu nhỏ/);
  assert.equal(s.calls.filter((c) => c[0] === "shrink").length, 1);
  await s.call("view_image", { id: IMG });
  assert.equal(s.calls.filter((c) => c[0] === "shrink").length, 1, "a small image is not shrunk");
});

test("check: lint per screen; spec returns an image + a report", async () => {
  const s = await setup();
  assert.match(s.text(await s.call("check", { what: "lint", entry: "screens/a" })), /lời thường/);
  const sp = await s.call("check", { what: "spec", entry: "screens/a" });
  assert.equal(sp.content.some((c) => c.type === "image"), true);
  assert.match(s.text(sp), /sơ đồ: 1/);
  assert.match(s.text(await s.call("check", { what: "typecheck" })), /sạch/);
});

test("rules: one folder per language with the same English file names; vi marks use @khoanh, en marks use @mark", () => {
  const md = (lang) => fs.readdirSync(path.join(RULES_ROOT, lang)).filter((n) => n.endsWith(".md")).sort();
  assert.deepEqual(md("en"), ["boards.md", "marks.md", "specs.md"]);
  assert.deepEqual(md("vi"), md("en"));
  assert.equal(defaultRules("vi"), path.join(RULES_ROOT, "vi"));
  assert.equal(defaultRules("en"), path.join(RULES_ROOT, "en"));
  assert.equal(defaultRules("fr"), path.join(RULES_ROOT, "en"), "unknown language → English");
  assert.equal(defaultRules(undefined), path.join(RULES_ROOT, "en"));
  for (const n of md("en")) assert.doesNotMatch(fs.readFileSync(path.join(RULES_ROOT, "en", n), "utf8"), VIETNAMESE, `en/${n}`);
  assert.match(fs.readFileSync(path.join(RULES_ROOT, "vi", "marks.md"), "utf8"), /@khoanh\(/);
  assert.match(fs.readFileSync(path.join(RULES_ROOT, "en", "marks.md"), "utf8"), /@mark\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(RULES_ROOT, "en", "marks.md"), "utf8"), /@khoanh/);
  assert.deepEqual(fs.readdirSync(RULES_ROOT).filter((n) => n.endsWith(".md")), [], "no rule outside a language folder");
});

test("rules: craft-table's own topics + the project's rules/ (same name → the project's wins); unknown → error with the list", async () => {
  const s = await setup();
  assert.match(s.text(await s.call("rules", { topic: "marks" })), /@khoanh\(/);
  const bad = await s.call("rules", { topic: "khong-co" });
  assert.equal(bad.isError, true);
  assert.match(s.text(bad), /^Chủ đề có: boards, marks, specs\.$/);
  // Project rules: a new topic + an override of a built-in one.
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
  fs.writeFileSync(path.join(proj, "design-system.md"), "# Our design system\nNo shadows.\n");
  fs.writeFileSync(path.join(proj, "marks.md"), "# Our annotation rule\n");
  fs.writeFileSync(path.join(proj, "notes.txt"), "not a rule");
  const dirs = [defaultRules("vi"), proj, path.join(proj, "missing")];
  assert.deepEqual(ruleTopics(dirs), ["boards", "marks", "specs", "design-system"]);
  const tools = createAgentTools({ root: s.root, ctx: { version: "ban-1", threadId: "t_abc", entry: "screens/a" }, shots: {}, checks: {}, threadsDir: s.threadsDir, uploadsDir: s.uploadsDir, rulesDirs: dirs, lang: "vi" });
  const rules = tools.find((t) => t.name === "rules");
  assert.match(rules.description, /boards, marks, specs, design-system/);
  assert.match((await rules.handler({ topic: "design-system" })).content[0].text, /No shadows/);
  assert.match((await rules.handler({ topic: "marks" })).content[0].text, /Our annotation rule/);
  assert.equal((await rules.handler({ topic: "../secrets" })).isError, true);
});

test("rules: the old Vietnamese topic names still work — as a topic asked for, and as a project's file overriding a built-in rule", async () => {
  const s = await setup();
  assert.equal(s.text(await s.call("rules", { topic: "khoanh" })), s.text(await s.call("rules", { topic: "marks" })));
  assert.equal(s.text(await s.call("rules", { topic: "ban-ve" })), s.text(await s.call("rules", { topic: "boards" })));
  assert.equal(s.text(await s.call("rules", { topic: "dac-ta" })), s.text(await s.call("rules", { topic: "specs" })));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
  fs.writeFileSync(path.join(proj, "khoanh.md"), "# Old-name override\n");
  const dirs = [defaultRules("vi"), proj];
  assert.deepEqual(ruleTopics(dirs), ["boards", "marks", "specs"], "khoanh.md overrides marks, no extra topic");
  const tools = createAgentTools({ root: s.root, ctx: { version: "ban-1", threadId: "t_abc", entry: "screens/a" }, shots: {}, checks: {}, threadsDir: s.threadsDir, uploadsDir: s.uploadsDir, rulesDirs: dirs, lang: "vi" });
  assert.match((await tools.find((t) => t.name === "rules").handler({ topic: "marks" })).content[0].text, /Old-name override/);
});

test("view_region: a removed mark → says it was removed, no shot; read_thread says removed / redrawn", async () => {
  const s = await setup();
  const R = { scenario: null, viewport: "desktop", rect: { x: 1, y: 2, w: 3, h: 4 }, texts: [] };
  const messages = [...s.msgs, { id: "m9", role: "user", author: "u@x", at: "x", text: "đây [#1] [#2]", refs: [{ ...R, removed: { by: "u", at: "y" } }, { ...R, redrawn: { by: "u", at: "y" } }], images: [] }];
  await saveThread(s.threadsDir, { id: "t_abc", entry: "screens/a", version: "ban-1", title: "T", createdBy: "u@x", createdAt: "x", updatedAt: "x", status: "open", messages, agent: { state: "idle" } });
  const before = s.calls.length;
  const r = await s.call("view_region", { n: 3 });
  assert.equal(r.isError, true);
  assert.match(s.text(r), /#3 đã bị bỏ/);
  assert.equal(s.calls.length, before, "no shot");
  const out = s.text(await s.call("read_thread", {}));
  assert.match(out, /#3 \(đã bỏ\)/);
  assert.match(out, /#4 \(không kịch bản · desktop · đã vẽ lại\)/);
});

// ── English project: the same tools speak English (the fixture's own data stays as written) ──

test("en: every tool description and parameter description is English", async () => {
  const s = await setup({ lang: "en" });
  for (const t of s.tools) {
    assert.doesNotMatch(t.description, VIETNAMESE, t.name);
    for (const [k, z] of Object.entries(t.shape)) assert.doesNotMatch(String(z.description ?? ""), VIETNAMESE, `${t.name}.${k}`);
  }
  assert.match(s.tools.find((t) => t.name === "locate").description, /@mark\(/);
  assert.match(s.tools.find((t) => t.name === "rules").description, /boards, marks, specs/);
});

test("en: tool results and errors are English", async () => {
  const s = await setup({ lang: "en", messages: 25 });
  assert.match(s.text(await s.call("list", { what: "screens" })), /screens\/a — Màn A \(2 scenarios\)/);
  assert.match(s.text(await s.call("list", { what: "screens" })), /screens\/big — To \(0 scenarios\)/);
  assert.match(s.text(await s.call("list", { what: "threads" })), /^t_abc — T \(open, 25 messages\)$/);
  assert.match(s.text(await s.call("read", { path: "boards/screens/big.tsx" })), /… 600 more lines — read on with from=401$/);
  const out = await s.call("read", { path: "../ban-2/boards/screens/a.tsx" });
  assert.equal(s.text(out), 'Out of scope: you can only read "boards/…", "system/…" of version ban-1 or "src:<src>/…".');
  assert.equal(s.text(await s.call("search", { pattern: "nowhere-to-be-found" })), 'No match for "nowhere-to-be-found".');
  assert.match(s.text(await s.call("search", { pattern: "Xin" })), /… \d+ more results — narrow the pattern\/glob$/);
  const th = s.text(await s.call("read_thread"));
  assert.match(th, /^\[1\] u@x:\ntin 1 \[#1\] \[#2\]\nMarks: #1 \(scenario it-don · mobile\), #2 \(no scenario · desktop\)\nImages: image 1: 0123456789abcdef\.png/);
  assert.match(th, /… 5 more messages — read on with from=21$/);
  assert.equal(s.text(await s.call("view_frame", { entry: "screens/a", scenario: "it-don", viewport: "mobile" })), "Frame screens/a · it-don · mobile · page 1234px tall");
  assert.match(s.text(await s.call("view_region", { n: 1 })), /^Area #1: scenario it-don · mobile · x=10 y=20 width 30 height 40\nText in the area: Xin chào$/);
  assert.equal(s.text(await s.call("view_region", { n: 99 })), "The thread has no mark #99 — see read_thread.");
  assert.equal(s.text(await s.call("locate", { entry: "screens/a", scenario: "-", viewport: "desktop", text: "Xin" })), 'p "Xin chào" → @mark(-, desktop, 1, 2, 3, 4)');
  assert.equal(s.text(await s.call("view_frame", { entry: "screens/none" })), 'No screen "screens/none" in ban-1.');
  assert.equal(s.text(await s.call("edit", { path: "boards/screens/a.tsx", old: "Xin", new: "Hi" })), "The passage to replace appears 2 times — add context to make it unique.");
  assert.equal(s.text(await s.call("edit", { path: "boards/screens/a.tsx", old: "Xin chào", new: "Hello" })), "Edited boards/screens/a.tsx.");
  assert.equal(s.text(await s.call("write", { path: "boards/screens/c.tsx", content: "a\nb" })), "Wrote boards/screens/c.tsx (2 lines).");
  assert.equal(s.text(await s.call("write", { path: "notes.md", content: "x" })), 'Cannot write "notes.md": only boards/… or system/… (.tsx .ts .css .md .json) of ban-1.');
  const css = await s.call("write", { path: "system/evil.css", content: `@plugin "./x.ts";` });
  assert.match(s.text(css), /^Not allowed in CSS: @plugin "\.\/x\.ts"/);
  // The option-info check (option-meta.mjs) gets the project's language too.
  const opt = await s.call("write", { path: "boards/screens/a~x.meta.json", content: JSON.stringify({ title: "A · X", option: "x" }) });
  assert.equal(opt.isError, true);
  assert.match(s.text(opt), /"of": "screens\/a"/);
  assert.doesNotMatch(s.text(opt), VIETNAMESE);
  assert.equal(s.text(await s.call("check", { what: "typecheck" })), "✓ typecheck clean");
  assert.equal(s.text(await s.call("check", { what: "lint" })), "✓ descriptions and the Behavior tab are all plain words");
  assert.equal(s.text(await s.call("check", { what: "spec", entry: "screens/a" })), "diagrams: 1 drawn · embedded code: 0 · rules: 2");
  assert.equal(s.text(await s.call("check", { what: "spec", entry: "screens/big" })), "No boards/screens/big.behavior.md yet.");
  assert.equal(s.text(await s.call("rules", { topic: "nope" })), "Topics: boards, marks, specs.");
  assert.match(s.text(await s.call("rules", { topic: "boards" })), /^# Boards and screen info/);
});

test("en: lint results — failing, and switched off by the project", async () => {
  const failing = await setup({ lang: "en", checks: { typecheck: async () => ({ ok: true, out: "" }), lint: () => ({ ok: false, issues: ["screens/a title: API"] }) } });
  const r = await failing.call("check", { what: "lint" });
  assert.equal(r.isError, true);
  assert.equal(failing.text(r), "✗ 1 place is not plain words — move the technical part to the Technical tab:\nscreens/a title: API");
  const off = await setup({ lang: "en", checks: { typecheck: async () => ({ ok: true, out: "" }), lint: () => ({ ok: true, issues: [], skipped: true }) } });
  assert.equal(off.text(await off.call("check", { what: "lint" })), "✓ the project has not turned on the plain-language rule — nothing to check");
});
