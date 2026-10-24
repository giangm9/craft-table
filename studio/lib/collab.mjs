// CO-EDITING like Google Docs (Y.js over Hocuspocus), attached to the studio server at /__collab.
// THE FILE ON DISK IS THE SOURCE OF TRUTH: each Y document = one file of a screen in versions/<v>/boards/.
//   • Opening a document: a saved Y state → loaded; the file changed from outside → merged in (mergeExternal).
//     None yet → built from the file. The Y state is saved (SQLite) so a restart does not duplicate text.
//   • Someone types → Hocuspocus calls onStoreDocument after `debounce` → writes the file (temp + rename) + saves the state.
//   • A file changed from outside (Claude, git) while its document is open → fileChanged() merges it in, never
//     overwriting what people type.
// Document name: "<v>/<path inside boards>" — e.g. "main/screens/orders/list.behavior.md".
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { Hocuspocus } from "@hocuspocus/server";
import { mergeExternal } from "./text-merge.mjs";
import { applyMeta, metaJson, metaToY, yToMeta } from "./meta-y.mjs";

const VERSION_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
// The studio-wide "who is where" document: awareness only ({user, where:{v, entry}}), no file, nothing saved.
export const PRESENCE_DOC = "__presence";
// Text (Y.Text "content"): the 2 specs + the board's code. Screen info (.meta.json): Y.Map "meta" (meta-y.mjs).
const TEXT_SUFFIXES = [".behavior.md", ".tech.md", ".tsx"];
const META_SUFFIX = ".meta.json";
const isMeta = (rel) => rel.endsWith(META_SUFFIX);
const parseMeta = (text) => { try { const v = JSON.parse(text); return v && typeof v === "object" ? v : null; } catch { return null; } };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** "<v>/<rel>" → { v, rel, abs } when it is a screen's file in a version that exists; otherwise null. */
export function resolveDocName(root, name) {
  const s = String(name ?? "");
  const i = s.indexOf("/");
  if (i < 0) return null;
  const v = s.slice(0, i), rel = s.slice(i + 1);
  if (!VERSION_RE.test(v) || !fs.existsSync(path.join(root, "versions", v, "version.json"))) return null;
  const segs = rel.split("/");
  if (segs.some((x) => !x || x === "." || x === ".." || x.startsWith("_") || x.startsWith(".")) || !/^[a-z0-9/_~.-]+$/.test(rel)) return null;
  if (!TEXT_SUFFIXES.some((x) => rel.endsWith(x)) && !isMeta(rel)) return null;
  const boards = path.join(root, "versions", v, "boards");
  const abs = path.join(boards, rel);
  if (!abs.startsWith(boards + path.sep)) return null;
  return { v, rel, abs };
}

export function createCollab({ root, dbFile, whoIs, onHumanEdit = () => {}, debounce = 800 }) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS ydoc (name TEXT PRIMARY KEY, state BLOB NOT NULL, base BLOB NOT NULL, file_hash TEXT NOT NULL)");
  const qGet = db.prepare("SELECT state, base, file_hash FROM ydoc WHERE name = ?");
  const qPut = db.prepare("INSERT INTO ydoc (name, state, base, file_hash) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET state = excluded.state, base = excluded.base, file_hash = excluded.file_hash");
  const mem = new Map(); // document name → { base: Uint8Array, written: hash of the file content last known }

  const readFile = (abs) => { try { return fs.readFileSync(abs, "utf8"); } catch { return ""; } };
  function writeFile(abs, text) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, abs);
  }

  const hocuspocus = new Hocuspocus({
    quiet: true,
    debounce,
    maxDebounce: debounce * 5,
    // Refuse an unknown name RIGHT AT connect — left to onLoadDocument, Hocuspocus has already created a Document
    // (with an Awareness timer) that it never destroys → one leaked timer per refusal.
    async onConnect({ documentName }) {
      if (documentName === PRESENCE_DOC) return;
      if (!resolveDocName(root, documentName)) throw new Error(`invalid document: ${documentName}`);
    },
    async onLoadDocument({ document, documentName }) {
      if (documentName === PRESENCE_DOC) return document;
      const f = resolveDocName(root, documentName);
      if (!f) throw new Error(`invalid document: ${documentName}`);
      const fileText = readFile(f.abs);
      const row = qGet.get(documentName);
      if (isMeta(f.rel)) {
        const map = document.getMap("meta");
        const parsed = parseMeta(fileText) ?? {};
        if (row) { Y.applyUpdate(document, row.state, "load"); if (sha(fileText) !== row.file_hash) applyMeta(map, parsed, "external"); }
        else document.transact(() => metaToY(map, parsed), "load");
        const state = Y.encodeStateAsUpdate(document);
        if (!row) qPut.run(documentName, state, state, sha(fileText));
        mem.set(documentName, { base: state, written: sha(fileText) });
        return document;
      }
      const text = document.getText("content");
      if (row) {
        Y.applyUpdate(document, row.state, "load");
        let base = row.base;
        if (sha(fileText) !== row.file_hash) base = mergeExternal(document, "content", row.base, fileText, "external");
        mem.set(documentName, { base, written: sha(fileText) });
      } else {
        document.transact(() => text.insert(0, fileText), "load");
        const state = Y.encodeStateAsUpdate(document);
        qPut.run(documentName, state, state, sha(fileText));
        mem.set(documentName, { base: state, written: sha(fileText) });
      }
      return document;
    },
    async onChange({ documentName, context, transactionOrigin }) {
      const f = resolveDocName(root, documentName);
      if (f && context?.user && transactionOrigin?.source === "connection") onHumanEdit(f.v, f.rel, context.user);
    },
    async onStoreDocument({ document, documentName }) {
      const f = resolveDocName(root, documentName);
      if (!f) return;
      const text = isMeta(f.rel) ? metaJson(yToMeta(document.getMap("meta"))) : document.getText("content").toString();
      if (readFile(f.abs) !== text) writeFile(f.abs, text);
      const state = Y.encodeStateAsUpdate(document);
      qPut.run(documentName, state, state, sha(text));
      mem.set(documentName, { base: state, written: sha(text) });
    },
  });

  const wss = new WebSocketServer({ noServer: true });

  return {
    hocuspocus,
    /** Hooked into httpServer.on("upgrade"). A path other than /__collab → not ours (left to Vite). */
    handleUpgrade(req, socket, head) {
      if (!String(req.url ?? "").startsWith("/__collab")) return false;
      const user = whoIs(req);
      if (!user) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return true; }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        const conn = hocuspocus.handleConnection(ws, new Request(`http://localhost${req.url}`, { headers }), { user });
        ws.on("message", (data) => conn.handleMessage(new Uint8Array(data)));
        ws.on("close", (code, reason) => conn.handleClose({ code, reason: String(reason) }));
      });
      return true;
    },
    /** A file on disk just changed (the server's watcher calls this). Its document is open → merged in. */
    fileChanged(abs) {
      const rel = path.relative(path.join(root, "versions"), abs).split(path.sep);
      if (rel.length < 3 || rel[1] !== "boards") return;
      const name = `${rel[0]}/${rel.slice(2).join("/")}`;
      const doc = hocuspocus.documents.get(name);
      const m = mem.get(name);
      if (!doc || !m) return; // not open → the next open compares hashes itself
      const text = readFile(abs);
      if (sha(text) === m.written) return; // we just wrote it ourselves
      if (isMeta(name)) {
        const parsed = parseMeta(text);
        if (parsed) applyMeta(doc.getMap("meta"), parsed, "external"); // JSON half-written / broken → skip this round
      } else m.base = mergeExternal(doc, "content", m.base, text, "external");
      m.written = sha(text);
    },
    /** How many people have this document open (to show "someone is editing"). */
    openCount(name) { return hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0; },
    async close() {
      hocuspocus.flushPendingStores();
      await wait(50);
      hocuspocus.closeConnections();
      for (const c of wss.clients) c.terminate(); // including connections tied to no document (refused names)
      wss.close();
      for (const d of hocuspocus.documents.values()) d.destroy(); // a document's Awareness has a periodic check timer
      hocuspocus.documents.clear();
      db.close();
    },
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
