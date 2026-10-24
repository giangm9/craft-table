import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  newThread, addMessage, setAgent, parseAgentReply, refLabel, allRefs, waitingForUser,
  pendingUserMessages, transcript, loadThread, saveThread, listThreads, normalizeThread, featureOf, threadsOfFeature,
  editRef, refChangesSince, dropMark,
} from "./threads.mjs";
import { createAgentTools } from "./agent-tools.mjs";
import { buildPrompt } from "./agent.mjs";

const now = "2026-10-07T10:00:00.000Z";
const ref = { scenario: "it-don", viewport: "mobile", rect: { x: 10, y: 20, w: 100, h: 40 }, texts: ["Duyệt"] };

test("newThread: a new thread has a title, no messages yet, agent idle", () => {
  const r = newThread({ entry: "screens/orders/list", version: "ban-2", title: "  Vòng chọn trạng thái  ", author: "a@b.c" }, { id: "t_1", now });
  assert.equal(r.ok, true);
  assert.deepEqual(r.thread, {
    id: "t_1", entry: "screens/orders/list", version: "ban-2", title: "Vòng chọn trạng thái", createdBy: "a@b.c",
    createdAt: now, updatedAt: now, status: "open", messages: [], agent: { state: "idle" },
  });
});

test("newThread: odd entry, odd/missing version or empty title → error", () => {
  assert.equal(newThread({ entry: "../x", version: "ban-1", title: "a", author: "a" }, { id: "t", now }).ok, false);
  assert.equal(newThread({ entry: "a/b", version: "ban-1", title: "  ", author: "a" }, { id: "t", now }).ok, false);
  assert.equal(newThread({ entry: "a/b", version: "../x", title: "a", author: "a" }, { id: "t", now }).ok, false);
  assert.equal(newThread({ entry: "a/b", title: "a", author: "a" }, { id: "t", now }).ok, false);
});

test("normalizeThread: an old thread with no version → the live version the IO layer passes in; version unknown → left as is", () => {
  assert.equal(normalizeThread({ id: "t_1", entry: "a/b" }, "v2").version, "v2");
  assert.equal(normalizeThread({ id: "t_1", entry: "a/b", version: "ban-3" }, "v2").version, "ban-3");
  assert.equal(normalizeThread({ id: "t_1", entry: "a/b" }, null).version, undefined);
  assert.equal(normalizeThread({ id: "t_1", entry: "a/b" }).version, undefined);
  assert.equal(normalizeThread(null, "v2"), null);
});

test("addMessage: adds a user message with marks; does not change the original thread", () => {
  const t = newThread({ entry: "a/b", version: "ban-1", title: "x", author: "u" }, { id: "t", now }).thread;
  const r = addMessage(t, { role: "user", author: "u", text: "Đổi thành 3 nút [#1]", refs: [ref] }, { id: "m_1", now: "2026-10-07T10:01:00.000Z" });
  assert.equal(r.ok, true);
  assert.equal(r.thread.messages.length, 1);
  assert.deepEqual(r.thread.messages[0], { id: "m_1", role: "user", author: "u", at: "2026-10-07T10:01:00.000Z", text: "Đổi thành 3 nút [#1]", refs: [ref], images: [] });
  assert.equal(r.thread.updatedAt, "2026-10-07T10:01:00.000Z");
  assert.equal(t.messages.length, 0);
});

test("addMessage: refuses an odd role, an empty message with no marks, a bad mark", () => {
  const t = newThread({ entry: "a/b", version: "ban-1", title: "x", author: "u" }, { id: "t", now }).thread;
  assert.equal(addMessage(t, { role: "bot", author: "u", text: "hi" }, { id: "m", now }).ok, false);
  assert.equal(addMessage(t, { role: "user", author: "u", text: "  ", refs: [] }, { id: "m", now }).ok, false);
  assert.equal(addMessage(t, { role: "user", author: "u", text: "x", refs: [{ ...ref, viewport: "tablet" }] }, { id: "m", now }).ok, false);
  assert.equal(addMessage(t, { role: "user", author: "u", text: "x", refs: [{ ...ref, rect: { x: 0, y: 0, w: 0, h: 5 } }] }, { id: "m", now }).ok, false);
  assert.equal(addMessage(t, { role: "user", author: "u", text: "x", refs: [{ ...ref, scenario: "Có dấu" }] }, { id: "m", now }).ok, false);
  // marks only, no text → valid
  assert.equal(addMessage(t, { role: "user", author: "u", text: "", refs: [ref] }, { id: "m", now }).ok, true);
});

test("parseAgentReply: @khoanh(...) → [#n] placeholders, gathered into refs; scenario '-' = none", () => {
  const out = parseAgentReply("Chỗ này @khoanh(it-don, mobile, 10, 20, 100, 40) và đây @khoanh(-, desktop, 0,0,5,5) nhé.");
  assert.equal(out.text, "Chỗ này [#1] và đây [#2] nhé.");
  assert.deepEqual(out.refs, [
    { scenario: "it-don", viewport: "mobile", rect: { x: 10, y: 20, w: 100, h: 40 }, texts: [] },
    { scenario: null, viewport: "desktop", rect: { x: 0, y: 0, w: 5, h: 5 }, texts: [] },
  ]);
});

test("parseAgentReply: a malformed @khoanh keeps its text as is", () => {
  const out = parseAgentReply("Sai @khoanh(it-don, tablet, 1,2,3,4) ở đây");
  assert.equal(out.text, "Sai @khoanh(it-don, tablet, 1,2,3,4) ở đây");
  assert.deepEqual(out.refs, []);
});

test("parseAgentReply: @mark(...) is an equal alias of @khoanh(...), mixed in one reply, numbered in order", () => {
  const out = parseAgentReply("Here @mark(first-visit, desktop, 1, 2, 30, 40), there @khoanh(-, mobile, 5, 6, 7, 8) and @mark(-, mobile, 0,0,5,5).");
  assert.equal(out.text, "Here [#1], there [#2] and [#3].");
  assert.deepEqual(out.refs.map((r) => [r.scenario, r.viewport, r.rect.x]), [["first-visit", "desktop", 1], [null, "mobile", 5], [null, "mobile", 0]]);
  assert.equal(parseAgentReply("Bad @mark(a, tablet, 1,2,3,4)").text, "Bad @mark(a, tablet, 1,2,3,4)");
  assert.equal(parseAgentReply("@marks(a, desktop, 1,2,3,4)").refs.length, 0, "only the exact names");
});

test("refLabel + allRefs: marks are numbered continuously across the whole thread", () => {
  let t = newThread({ entry: "a/b", version: "ban-1", title: "x", author: "u" }, { id: "t", now }).thread;
  t = addMessage(t, { role: "user", author: "u", text: "a [#1] b [#2]", refs: [ref, ref] }, { id: "m1", now }).thread;
  t = addMessage(t, { role: "claude", author: "claude", text: "c [#1]", refs: [ref] }, { id: "m2", now }).thread;
  const refs = allRefs(t);
  assert.deepEqual(refs.map((r) => [r.messageId, r.index, r.n]), [["m1", 0, 1], ["m1", 1, 2], ["m2", 0, 3]]);
  assert.equal(refLabel(t, "m2", 0), 3);
});

test("waitingForUser: thread open, last message from Claude, agent idle", () => {
  let t = newThread({ entry: "a/b", version: "ban-1", title: "x", author: "u" }, { id: "t", now }).thread;
  assert.equal(waitingForUser(t), false);
  t = addMessage(t, { role: "claude", author: "claude", text: "Bạn muốn A hay B?" }, { id: "m1", now }).thread;
  assert.equal(waitingForUser(t), true);
  assert.equal(waitingForUser(setAgent(t, { state: "running" }, now)), false);
  t = addMessage(t, { role: "user", author: "u", text: "A" }, { id: "m2", now }).thread;
  assert.equal(waitingForUser(t), false);
});

test("pendingUserMessages: user messages after Claude's last reply", () => {
  let t = newThread({ entry: "a/b", version: "ban-1", title: "x", author: "u" }, { id: "t", now }).thread;
  t = addMessage(t, { role: "user", author: "u", text: "1" }, { id: "m1", now }).thread;
  t = addMessage(t, { role: "claude", author: "claude", text: "2" }, { id: "m2", now }).thread;
  t = addMessage(t, { role: "user", author: "u", text: "3" }, { id: "m3", now }).thread;
  t = addMessage(t, { role: "user", author: "u", text: "4" }, { id: "m4", now }).thread;
  assert.deepEqual(pendingUserMessages(t).map((m) => m.id), ["m3", "m4"]);
});

test("transcript: writes out the conversation for the agent, marks record scenario/viewport/coordinates/text", () => {
  let t = newThread({ entry: "screens/orders/list", version: "ban-1", title: "Vòng chọn", author: "u@x" }, { id: "t", now }).thread;
  t = addMessage(t, { role: "user", author: "u@x", text: "Đổi [#1]", refs: [ref] }, { id: "m1", now }).thread;
  const s = transcript(t, t.messages, { lang: "vi" });
  assert.match(s, /u@x:\n?Đổi \[#1\]/);
  assert.match(s, /\[#1\] kịch bản it-don · mobile · x=10 y=20 w=100 h=40 · chữ: "Duyệt"/);
});

test("transcript follows the language it is given (the project's): vi exactly as before, en by default", () => {
  let t = newThread({ entry: "a/b", version: "ban-1", title: "x", author: "u@x" }, { id: "t", now }).thread;
  t = addMessage(t, { role: "user", author: "u@x", text: "Fix [#1]", refs: [ref, { ...ref, scenario: null, texts: [] }] }, { id: "m1", now }).thread;
  t = addMessage(t, { role: "claude", author: "claude", text: "Done" }, { id: "m2", now }).thread;
  t = addMessage(t, { role: "user", author: "u@x", text: "", refs: [ref] }, { id: "m3", now }).thread;
  t = addMessage(t, { role: "user", author: "u@x", text: "", images: ["0123456789abcdef.png"] }, { id: "m4", now }).thread;
  t = editRef(t, { messageId: "m3", index: 0, action: "remove" }, { by: "u", now }).thread;
  assert.equal(transcript(t, t.messages, { lang: "vi", uploadsDir: "/up" }), [
    "u@x:\nFix [#1]\nVùng khoanh kèm tin này:\n  [#1] kịch bản it-don · mobile · x=10 y=20 w=100 h=40 · chữ: \"Duyệt\"\n  [#2] kịch bản (mặc định) · mobile · x=10 y=20 w=100 h=40",
    "Claude (bạn, lượt trước):\nDone",
    "u@x:\n(chỉ khoanh, không có chữ)\nVùng khoanh kèm tin này:\n  [#1] đã bỏ (người dùng bỏ vùng này)",
    "u@x:\n(chỉ gửi ảnh, không có chữ)\nẢnh người dùng đính kèm tin này (dùng Read để xem từng ảnh):\n  ảnh 1: /up/0123456789abcdef.png",
  ].join("\n\n"));
  const en = [
    "u@x:\nFix [#1]\nMarks attached to this message:\n  [#1] scenario it-don · mobile · x=10 y=20 w=100 h=40 · text: \"Duyệt\"\n  [#2] scenario (default) · mobile · x=10 y=20 w=100 h=40",
    "Claude (you, an earlier turn):\nDone",
    "u@x:\n(marks only, no text)\nMarks attached to this message:\n  [#1] removed (the person removed this mark)",
    "u@x:\n(images only, no text)\nImages the person attached to this message (use Read to view each one):\n  image 1: /up/0123456789abcdef.png",
  ].join("\n\n");
  assert.equal(transcript(t, t.messages, { uploadsDir: "/up" }), en);
  assert.equal(transcript(t, t.messages, { lang: "en", uploadsDir: "/up" }), en);
});

test("thread errors carry a code (+ params) and a text in the language given (the viewer's at the API); vi as before, en by default", () => {
  const t = newThread({ entry: "a/b", version: "ban-1", title: "x", author: "u" }, { id: "t", now }).thread;
  const err = (r) => ({ code: r.code, params: r.params, error: r.error });
  const vi = { id: "m", now, lang: "vi" };
  assert.deepEqual(err(newThread({ entry: "../x", version: "ban-1", title: "a" }, { id: "t", now, lang: "vi" })), { code: "threadEntryInvalid", params: {}, error: "entry không hợp lệ" });
  assert.deepEqual(err(newThread({ entry: "a/b", version: "../x", title: "a" }, { id: "t", now, lang: "vi" })), { code: "threadVersionInvalid", params: {}, error: "phiên bản không hợp lệ" });
  assert.deepEqual(err(newThread({ entry: "a/b", version: "v1", title: " " }, { id: "t", now, lang: "vi" })), { code: "threadTitleMissing", params: {}, error: "thiếu tiêu đề" });
  assert.equal(addMessage(t, { role: "bot", text: "hi" }, vi).error, "role phải là user|claude");
  assert.equal(addMessage(t, { role: "user", text: "x".repeat(8001) }, vi).error, "tin nhắn quá dài");
  assert.equal(addMessage(t, { role: "user", text: "x", refs: Array(13).fill(ref) }, vi).error, "quá nhiều vùng khoanh");
  assert.equal(addMessage(t, { role: "user", text: "x", refs: [{ ...ref, viewport: "tablet" }] }, vi).error, "vùng khoanh không hợp lệ");
  assert.equal(addMessage({ ...t, entry: MAIN }, { role: "user", text: "x", viewing: "screens/khac" }, vi).error, "màn đang xem không thuộc luồng này");
  assert.deepEqual(err(addMessage(t, { role: "user", text: "x", images: Array(7).fill("0123456789abcdef.png") }, vi)), { code: "messageTooManyImages", params: { max: 6 }, error: "tối đa 6 ảnh mỗi tin" });
  assert.equal(addMessage(t, { role: "user", text: "x", images: ["../a.png"] }, vi).error, "ảnh đính kèm không hợp lệ");
  assert.equal(addMessage(t, { role: "user", text: " " }, vi).error, "tin nhắn trống");
  const s = sentThread();
  const by = { by: "u", now: T2, lang: "vi" };
  assert.equal(editRef(s, { messageId: "m9", index: 0, action: "remove" }, by).error, "không có vùng khoanh này");
  const gone = editRef(s, { messageId: "m1", index: 0, action: "remove" }, by).thread;
  assert.equal(editRef(gone, { messageId: "m1", index: 0, action: "remove" }, by).error, "vùng khoanh đã bỏ");
  assert.equal(editRef(s, { messageId: "m1", index: 0, action: "restore" }, by).error, "vùng khoanh chưa bỏ");
  assert.equal(editRef(gone, { messageId: "m1", index: 0, action: "redraw", ref }, by).error, "vùng khoanh đã bỏ — khôi phục trước khi vẽ lại");
  assert.equal(editRef(s, { messageId: "m1", index: 0, action: "redraw", ref: { ...ref, viewport: "tablet" } }, by).error, "vùng khoanh không hợp lệ");
  assert.deepEqual(err(editRef(s, { messageId: "m1", index: 0, action: "xoa" }, by)), { code: "markActionInvalid", params: {}, error: "thao tác phải là remove|restore|redraw" });
  // English: the default, and any language other than vi
  assert.equal(addMessage(t, { role: "user", text: " " }, { id: "m", now }).error, "The message is empty");
  assert.equal(addMessage(t, { role: "user", text: " " }, { id: "m", now, lang: "fr" }).error, "The message is empty");
  assert.equal(addMessage(t, { role: "user", text: "x", images: Array(7).fill("0123456789abcdef.png") }, { id: "m", now }).error, "At most 6 images per message");
  assert.equal(newThread({ entry: "a/b", version: "v1", title: " " }, { id: "t", now }).error, "The thread needs a title");
  assert.equal(editRef(gone, { messageId: "m1", index: 0, action: "redraw", ref }, { by: "u", now: T2 }).error, "This mark was removed — restore it before redrawing");
});

test("dataText: the pure lookup of the data dictionary (libs shared with the studio UI): lang → en → the key", async () => {
  const { dataText } = await import("./i18n/data.mjs");
  assert.equal(dataText("vi", "messageEmpty"), "tin nhắn trống");
  assert.equal(dataText("en", "messageEmpty"), "The message is empty");
  assert.equal(dataText("xx", "messageEmpty"), "The message is empty");
  assert.equal(dataText(undefined, "messageTooManyImages", { max: 3 }), "At most 3 images per message");
  assert.equal(dataText("vi", "noSuchKey"), "noSuchKey");
});

test("setAgent: merges the agent state, keeps the old sessionId", () => {
  let t = newThread({ entry: "a/b", version: "ban-1", title: "x", author: "u" }, { id: "t", now }).thread;
  t = setAgent(t, { state: "running", sessionId: "s1" }, now);
  t = setAgent(t, { state: "idle", progress: null }, now);
  assert.equal(t.agent.state, "idle");
  assert.equal(t.agent.sessionId, "s1");
});

/** The threads folder of a temporary project (threads/ sits next to versions/): index.json (raw text, if any) + the versions that have a version.json. */
function projectThreads({ index, released = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "thr-"));
  for (const v of released) {
    fs.mkdirSync(path.join(root, "versions", v), { recursive: true });
    fs.writeFileSync(path.join(root, "versions", v, "version.json"), "{}");
  }
  if (index !== undefined) {
    fs.mkdirSync(path.join(root, "versions"), { recursive: true });
    fs.writeFileSync(path.join(root, "versions", "index.json"), index);
  }
  return { root, dir: path.join(root, "threads") };
}
const liveIs = (live, order = [live]) => JSON.stringify({ live, order });
/** A thread written before versions existed: the file has no "version" field. */
function legacyThread(id, entry = "a/b") {
  const t = { ...newThread({ entry, version: "x", title: "Cũ", author: "u" }, { id, now: "2026-10-06T10:00:00.000Z" }).thread };
  delete t.version;
  return t;
}

test("IO: save, read back, list by drawing (newest first); an old thread with no version belongs to the live version", async () => {
  const { dir } = projectThreads({ index: liveIs("ban-2", ["ban-2", "ban-1"]), released: ["ban-1", "ban-2"] });
  const a = newThread({ entry: "a/b", version: "ban-1", title: "A", author: "u" }, { id: "t_a", now: "2026-10-07T10:00:00.000Z" }).thread;
  const b = newThread({ entry: "a/b", version: "ban-1", title: "B", author: "u" }, { id: "t_b", now: "2026-10-07T11:00:00.000Z" }).thread;
  const c = newThread({ entry: "x/y", version: "ban-1", title: "C", author: "u" }, { id: "t_c", now }).thread;
  const d = newThread({ entry: "a/b", version: "ban-2", title: "D", author: "u" }, { id: "t_d", now }).thread;
  for (const t of [a, b, c, d, legacyThread("t_o")]) await saveThread(dir, t);
  assert.deepEqual(await loadThread(dir, "t_a"), a);
  assert.equal((await loadThread(dir, "t_o")).version, "ban-2");
  assert.deepEqual((await listThreads(dir, "a/b", "ban-1")).map((t) => t.id), ["t_b", "t_a"]);
  assert.deepEqual((await listThreads(dir, "a/b", "ban-2")).map((t) => t.id), ["t_d", "t_o"]);
  assert.equal((await listThreads(dir)).length, 5);
  assert.equal(await loadThread(dir, "../evil"), null);
});

test("IO: an old thread follows the version that is live AT LOAD TIME (versions/index.json next to threads/); loading does not rewrite the file", async () => {
  const { root, dir } = projectThreads({ index: liveIs("v2", ["v2", "v1"]), released: ["v1", "v2"] });
  await saveThread(dir, legacyThread("t_o"));
  assert.equal((await loadThread(dir, "t_o")).version, "v2");
  assert.deepEqual((await listThreads(dir, "a/b", "v2")).map((t) => t.id), ["t_o"]);
  assert.deepEqual(await listThreads(dir, "a/b", "ban-1"), []);
  fs.writeFileSync(path.join(root, "versions", "index.json"), liveIs("v1", ["v2", "v1"]));
  assert.equal((await loadThread(dir, "t_o")).version, "v1");
  assert.deepEqual((await listThreads(dir, "a/b", "v1")).map((t) => t.id), ["t_o"]);
  assert.equal("version" in JSON.parse(fs.readFileSync(path.join(dir, "t_o.json"), "utf8")), false);
});

test("IO: index.json missing/broken → an old thread belongs to the first version by name that has a version.json; a project with no versions yet → no version assigned, still listed", async () => {
  for (const index of [undefined, "{ hỏng", JSON.stringify({ order: [] })]) {
    const p = projectThreads({ index, released: ["moi", "goc"] });
    fs.mkdirSync(path.join(p.root, "versions", "a-nhap"), { recursive: true }); // no version.json → skipped
    await saveThread(p.dir, legacyThread("t_o"));
    assert.equal((await loadThread(p.dir, "t_o")).version, "goc", `index.json: ${index}`);
  }
  const none = projectThreads();
  await saveThread(none.dir, legacyThread("t_o"));
  assert.equal((await loadThread(none.dir, "t_o")).version, undefined);
  assert.deepEqual((await listThreads(none.dir)).map((t) => t.id), ["t_o"]);
  assert.deepEqual(await listThreads(none.dir, "a/b", "ban-1"), []);
});

test("Claude: an old thread belongs to the live version — list threads in the sandbox and the context line of the prompt name the right version", async () => {
  const { root, dir } = projectThreads({ index: liveIs("v2", ["v2", "v1"]), released: ["v1", "v2"] });
  for (const v of ["v1", "v2"]) {
    fs.mkdirSync(path.join(root, "versions", v, "boards", "a"), { recursive: true });
    fs.writeFileSync(path.join(root, "versions", v, "boards", "a", "b.tsx"), "export default function B() { return null; }\n");
  }
  await saveThread(dir, addMessage(legacyThread("t_o"), { role: "user", author: "u", text: "sửa giúp" }, { id: "m1", now }).thread);
  await saveThread(dir, newThread({ entry: "a/b", version: "v1", title: "Của v1", author: "u" }, { id: "t_v1", now }).thread);
  // A Vietnamese project (lang "vi": what Claude reads follows the project's language).
  const listIn = async (version) => {
    const tools = createAgentTools({ root, ctx: { version, threadId: "t_o", entry: "a/b" }, shots: {}, checks: {}, threadsDir: dir, uploadsDir: path.join(root, "data", "uploads"), lang: "vi" });
    return (await tools.find((t) => t.name === "list").handler({ what: "threads" })).content[0].text;
  };
  assert.match(await listIn("v2"), /^t_o — Cũ \(open, 1 tin\)$/);
  assert.match(await listIn("v1"), /^t_v1 — Của v1 \(open, 0 tin\)$/);
  const t = await loadThread(dir, "t_o");
  assert.match(buildPrompt({ thread: t, meta: { title: "Màn B" }, pending: pendingUserMessages(t), resume: false, lang: "vi" }), /^Luồng t_o · phiên bản v2 · màn a\/b/);
});

// ── Main screen + options = one GROUP that shares threads ──
const MAIN = "screens/orders/list", OPT = "screens/orders/list~ba-nut";

test("featureOf / threadsOfFeature: threads of the main screen and all of its options, in the right version", () => {
  assert.equal(featureOf(OPT), MAIN);
  assert.equal(featureOf(MAIN), MAIN);
  const ts = [
    { id: "a", entry: MAIN, version: "ban-1" }, { id: "b", entry: OPT, version: "ban-1" },
    { id: "c", entry: "screens/orders/today", version: "ban-1" }, { id: "d", entry: MAIN, version: "ban-2" },
    { id: "e", entry: "screens/orders/list-cu", version: "ban-1" },
  ];
  assert.deepEqual(threadsOfFeature(ts, OPT, "ban-1").map((t) => t.id), ["a", "b"]);
  assert.deepEqual(threadsOfFeature(ts, MAIN, "ban-1").map((t) => t.id), ["a", "b"]);
});

test("addMessage: the message records the screen being viewed (an option of the group) + a mark records the screen it was drawn on; a screen outside the group → error", () => {
  const t = newThread({ entry: MAIN, version: "ban-1", title: "T", author: "u" }, { id: "t_1", now }).thread;
  const r = addMessage(t, { role: "user", author: "u", text: "sửa [#1]", refs: [{ ...ref, entry: OPT }], viewing: OPT }, { id: "m1", now });
  assert.equal(r.ok, true);
  const m = r.thread.messages[0];
  assert.equal(m.viewing, OPT);
  assert.equal(m.refs[0].entry, OPT);
  const same = addMessage(t, { role: "user", author: "u", text: "x", refs: [ref], viewing: MAIN }, { id: "m2", now }).thread.messages[0];
  assert.equal(same.viewing, undefined, "viewing the thread's own screen → nothing extra recorded");
  assert.equal(same.refs[0].entry, undefined);
  assert.equal(addMessage(t, { role: "user", author: "u", text: "x", viewing: "screens/orders/today" }, { id: "m3", now }).ok, false);
  assert.equal(addMessage(t, { role: "user", author: "u", text: "x", refs: [{ ...ref, entry: "screens/khac" }] }, { id: "m4", now }).ok, false);
});

// ── Editing marks after sending (a list of the marks: remove a mark, or redraw an existing one) ──
const T1 = "2026-10-07T10:01:00.000Z", T2 = "2026-10-07T10:02:00.000Z", T3 = "2026-10-07T10:03:00.000Z";
function sentThread() {
  let t = newThread({ entry: MAIN, version: "ban-1", title: "x", author: "u" }, { id: "t_1", now }).thread;
  t = addMessage(t, { role: "user", author: "u", text: "a [#1] b [#2]", refs: [ref, ref] }, { id: "m1", now }).thread;
  t = addMessage(t, { role: "claude", author: "claude", text: "c [#1]", refs: [ref] }, { id: "m2", now: T1 }).thread;
  return t;
}

test("editRef remove: the mark keeps its place (flagged as removed), the #n of other marks unchanged; can be restored; does not change the original thread", () => {
  const t = sentThread();
  const r = editRef(t, { messageId: "m1", index: 0, action: "remove" }, { by: "u@x", now: T2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.thread.messages[0].refs[0], { ...ref, removed: { by: "u@x", at: T2 } });
  assert.deepEqual(allRefs(r.thread).map((x) => x.n), [1, 2, 3]);
  assert.equal(r.thread.updatedAt, T2);
  assert.equal(t.messages[0].refs[0].removed, undefined);
  assert.equal(editRef(r.thread, { messageId: "m1", index: 0, action: "remove" }, { by: "u@x", now: T3 }).ok, false, "removing twice → error");
  const back = editRef(r.thread, { messageId: "m1", index: 0, action: "restore" }, { by: "u@x", now: T3 });
  assert.equal(back.ok, true);
  assert.deepEqual(back.thread.messages[0].refs[0], ref);
});

test("editRef redraw: replaces the region (scenario/viewport/coordinates/text/screen), keeps the number, records the redraw; a bad region, a screen outside the group, a removed mark → error", () => {
  const t = sentThread();
  const nr = { scenario: "trong", viewport: "desktop", rect: { x: 1.4, y: 2, w: 30, h: 8 }, texts: ["Lưu"], entry: OPT };
  const r = editRef(t, { messageId: "m2", index: 0, action: "redraw", ref: nr }, { by: "u@x", now: T2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.thread.messages[1].refs[0], { scenario: "trong", viewport: "desktop", rect: { x: 1, y: 2, w: 30, h: 8 }, texts: ["Lưu"], entry: OPT, redrawn: { by: "u@x", at: T2 } });
  assert.equal(allRefs(r.thread)[2].n, 3);
  assert.equal(editRef(t, { messageId: "m2", index: 0, action: "redraw", ref: { ...nr, viewport: "tablet" } }, { by: "u", now: T2 }).ok, false);
  assert.equal(editRef(t, { messageId: "m2", index: 0, action: "redraw", ref: { ...nr, entry: "screens/khac" } }, { by: "u", now: T2 }).ok, false);
  const gone = editRef(t, { messageId: "m1", index: 1, action: "remove" }, { by: "u", now: T2 }).thread;
  assert.equal(editRef(gone, { messageId: "m1", index: 1, action: "redraw", ref: nr }, { by: "u", now: T3 }).ok, false);
  assert.equal(editRef(t, { messageId: "m9", index: 0, action: "remove" }, { by: "u", now: T2 }).ok, false, "no such message");
  assert.equal(editRef(t, { messageId: "m1", index: 5, action: "remove" }, { by: "u", now: T2 }).ok, false, "no such mark");
  assert.equal(editRef(t, { messageId: "m1", index: 0, action: "xoa" }, { by: "u", now: T2 }).ok, false, "unknown action");
});

test("refChangesSince: earlier marks removed / redrawn after a point in time → reported to Claude on the next turn", () => {
  let t = sentThread();
  t = editRef(t, { messageId: "m1", index: 0, action: "remove" }, { by: "u", now: T2 }).thread;
  t = editRef(t, { messageId: "m2", index: 0, action: "redraw", ref }, { by: "u", now: T3 }).thread;
  assert.deepEqual(refChangesSince(t, T1), [{ n: 1, change: "removed" }, { n: 3, change: "redrawn" }]);
  assert.deepEqual(refChangesSince(t, T2), [{ n: 3, change: "redrawn" }]);
  assert.deepEqual(refChangesSince(t, T3), []);
});

test("transcript: a removed mark is stated plainly, without coordinates", () => {
  const t = editRef(sentThread(), { messageId: "m1", index: 0, action: "remove" }, { by: "u", now: T2 }).thread;
  const s = transcript(t, t.messages, { lang: "vi" });
  assert.match(s, /\[#1\] đã bỏ/);
  assert.match(s, /\[#2\] kịch bản it-don/);
});

test("dropMark: removing mark k while composing → deletes [#k] from the text, later numbers shift down by one (the text still points at the right regions)", () => {
  assert.equal(dropMark("Nút [#1] to quá, [#2] bỏ, [#3] đổi màu", 2), "Nút [#1] to quá, bỏ, [#2] đổi màu");
  assert.equal(dropMark("[#1] ", 1), "");
  assert.equal(dropMark("[#1] a [#2] b", 1), "a [#1] b");
  assert.equal(dropMark("không có mốc", 1), "không có mốc");
});
