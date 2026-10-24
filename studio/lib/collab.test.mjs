import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import WebSocket from "ws";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { createCollab } from "./collab.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000, what = "condition") {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return; await wait(40); }
  throw new Error(`timed out waiting for ${what}`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "collab-"));
  const b = path.join(root, "versions", "ban-t", "boards", "screens");
  fs.mkdirSync(path.join(b, "_kit"), { recursive: true });
  fs.writeFileSync(path.join(root, "versions", "ban-t", "version.json"), "{}");
  fs.writeFileSync(path.join(b, "a.behavior.md"), "Một.");
  fs.writeFileSync(path.join(b, "_kit", "x.tsx"), "kit");
  fs.writeFileSync(path.join(b, "a.meta.json"), JSON.stringify({ title: "Màn A", group: "G", order: 5, desc: "Mô tả", scenarios: [{ id: "x", title: "X" }] }, null, 2) + "\n");
  return { root, file: path.join(b, "a.behavior.md") };
}

async function start(root, edits = []) {
  const collab = createCollab({ root, dbFile: path.join(root, "data", "collab.sqlite"), whoIs: () => "u@x", onHumanEdit: (...a) => edits.push(a), debounce: 100 });
  const server = http.createServer();
  server.on("upgrade", (req, socket, head) => collab.handleUpgrade(req, socket, head));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `ws://127.0.0.1:${server.address().port}/__collab`;
  const providers = [];
  const connect = (name) => {
    const doc = new Y.Doc();
    const p = new HocuspocusProvider({ url, name, document: doc, WebSocketPolyfill: WebSocket });
    providers.push(p);
    return { doc, p, text: () => doc.getText("content").toString() };
  };
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const p of providers) { p.destroy(); p.configuration.websocketProvider?.destroy(); }
    await collab.close();
    await new Promise((r) => server.close(r));
  };
  return { collab, connect, stop };
}

const NAME = "ban-t/screens/a.behavior.md";

test("2 people edit together: A types → B sees it → the file on disk changes; the editor is reported", async (t) => {
  const { root, file } = fixture();
  const edits = [];
  const s = await start(root, edits);
  t.after(s.stop);
  const A = s.connect(NAME), B = s.connect(NAME);
  await waitFor(() => A.text() === "Một." && B.text() === "Một.", 4000, "the file content to load");
  A.doc.getText("content").insert(4, " Hai.");
  await waitFor(() => B.text() === "Một. Hai.", 3000, "B to see what A typed");
  await waitFor(() => fs.readFileSync(file, "utf8") === "Một. Hai.", 3000, "the file on disk to change");
  assert.deepEqual(edits.at(-1), ["ban-t", "screens/a.behavior.md", "u@x"]);
  await s.stop();
});

test("a file changed from outside (Claude) → everyone who has it open sees it; a restart does not double the text", async (t) => {
  const { root, file } = fixture();
  let s = await start(root);
  t.after(() => s.stop());
  const A = s.connect(NAME), B = s.connect(NAME);
  await waitFor(() => A.text() === "Một." && B.text() === "Một.");
  A.doc.getText("content").insert(4, " Hai.");
  await waitFor(() => fs.readFileSync(file, "utf8") === "Một. Hai.");
  fs.writeFileSync(file, "Một. Hai. Ba.");
  s.collab.fileChanged(file);
  await waitFor(() => A.text() === "Một. Hai. Ba." && B.text() === "Một. Hai. Ba.", 3000, "A and B to see the change from disk");
  await s.stop();
  s = await start(root);
  const C = s.connect(NAME);
  await waitFor(() => C.text().length > 0, 4000, "C to load");
  await wait(300);
  assert.equal(C.text(), "Một. Hai. Ba.");
  assert.equal(fs.readFileSync(file, "utf8"), "Một. Hai. Ba.");
  await s.stop();
});

test("a file changed while the server is down → merged in on the next open, no text lost", async (t) => {
  const { root, file } = fixture();
  let s = await start(root);
  t.after(() => s.stop());
  const A = s.connect(NAME);
  await waitFor(() => A.text() === "Một.");
  await s.stop();
  fs.writeFileSync(file, "Một. (sửa lúc tắt)");
  s = await start(root);
  const B = s.connect(NAME);
  await waitFor(() => B.text() === "Một. (sửa lúc tắt)", 4000, "the version edited while down to load");
  await s.stop();
});

test("odd document names (parent directory, _kit, missing version, odd extension) → not loaded", async (t) => {
  const { root } = fixture();
  const s = await start(root);
  t.after(s.stop);
  for (const bad of ["../x.md", "ban-t/_kit/x.tsx", "khong-co/screens/a.behavior.md", "ban-t/screens/a.txt", "ban-t/../../etc/passwd.md"]) {
    const X = s.connect(bad);
    await wait(400);
    assert.equal(X.text(), "", bad);
  }
  assert.ok(!fs.existsSync(path.join(root, "x.md")));
  await s.stop();
});

test("screen info (.meta.json = Y.Map): A renames + adds a scenario → B sees it, the JSON file changes, other fields kept; file changed outside → A sees it", async (t) => {
  const { root } = fixture();
  const metaFile = path.join(root, "versions", "ban-t", "boards", "screens", "a.meta.json");
  const s = await start(root);
  t.after(s.stop);
  const A = s.connect("ban-t/screens/a.meta.json"), B = s.connect("ban-t/screens/a.meta.json");
  const mA = A.doc.getMap("meta"), mB = B.doc.getMap("meta");
  await waitFor(() => mA.get("title") === "Màn A" && mB.get("title") === "Màn A", 4000, "meta to load");
  A.doc.transact(() => {
    mA.set("title", "Màn A mới");
    const sm = new Y.Map(); sm.set("id", "y"); sm.set("title", "Y");
    mA.get("scenarios").push([sm]);
  });
  await waitFor(() => mB.get("title") === "Màn A mới" && mB.get("scenarios").length === 2, 3000, "B to see it");
  await waitFor(() => JSON.parse(fs.readFileSync(metaFile, "utf8")).title === "Màn A mới", 3000, "the JSON file to change");
  const j = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  assert.deepEqual(j, { title: "Màn A mới", group: "G", order: 5, desc: "Mô tả", scenarios: [{ id: "x", title: "X" }, { id: "y", title: "Y" }] });
  fs.writeFileSync(metaFile, JSON.stringify({ ...j, desc: "Claude sửa mô tả" }, null, 2) + "\n");
  s.collab.fileChanged(metaFile);
  await waitFor(() => mA.get("desc") === "Claude sửa mô tả" && mB.get("desc") === "Claude sửa mô tả", 3000, "A and B to see the new description");
  await s.stop();
});

test("__presence: who is on which screen (awareness) reaches everyone; no file written, no state stored", async (t) => {
  const { root } = fixture();
  const s = await start(root);
  t.after(s.stop);
  const A = s.connect("__presence"), B = s.connect("__presence");
  A.p.setAwarenessField("where", { v: "ban-t", entry: "screens/a" });
  await waitFor(() => [...B.p.awareness.getStates().values()].some((st) => st.where?.entry === "screens/a"), 4000, "B to see A on screens/a");
  A.p.setAwarenessField("where", { v: "ban-t", entry: "screens/b" });
  await waitFor(() => [...B.p.awareness.getStates().values()].some((st) => st.where?.entry === "screens/b"), 3000, "B to see A switch screens");
  A.doc.getText("content").insert(0, "rác");
  await wait(400);
  assert.ok(!fs.existsSync(path.join(root, "versions", "__presence")) && !fs.existsSync(path.join(root, "__presence")));
  await s.stop();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(root, "data", "collab.sqlite"));
  assert.equal(db.prepare("SELECT count(*) n FROM ydoc WHERE name = '__presence'").get().n, 0);
  db.close();
});
