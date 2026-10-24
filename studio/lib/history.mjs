// HISTORY of changes per screen: small changes get history. Each snapshot is the full
// content of ONE file (board, info, the 2 specs) at a point in time + who changed it. Content is stored by hash
// (identical content is shared). Node's built-in SQLite — no native package needed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BOARD_FILE_SUFFIXES } from "./versions.mjs";
import { authorCode } from "./legacy-values.mjs";

export const HISTORY_SOURCES = ["human", "claude", "external", "restore", "option", "init"];
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// A note the studio writes is { key, params? } — words in no language, rendered in the viewer's language by the UI
// (studio/src/i18n/agent-status.ts storedText) — stored as JSON text. Rows written by earlier versions hold the
// Vietnamese text they were written with: read back as that text. Authors the studio writes itself are codes
// ("init", "external"); old rows' Vietnamese words are read as those codes.
const noteIn = (n) => (n && typeof n === "object" ? JSON.stringify(n) : n ?? null);
function noteOut(s) {
  if (typeof s !== "string" || !s.startsWith("{")) return s ?? null;
  try { const o = JSON.parse(s); return o && typeof o === "object" && typeof o.key === "string" ? o : s; } catch { return s; }
}

export function openHistory(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS blob (hash TEXT PRIMARY KEY, content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revision (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL, path TEXT NOT NULL, ts TEXT NOT NULL,
      author TEXT NOT NULL, source TEXT NOT NULL, thread_id TEXT, hash TEXT NOT NULL, note TEXT
    );
    CREATE INDEX IF NOT EXISTS revision_vp ON revision (version, path, id);
  `);
  const qLatest = db.prepare("SELECT hash FROM revision WHERE version = ? AND path = ? ORDER BY id DESC LIMIT 1");
  const qBlob = db.prepare("INSERT OR IGNORE INTO blob (hash, content) VALUES (?, ?)");
  const qIns = db.prepare("INSERT INTO revision (version, path, ts, author, source, thread_id, hash, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const qGet = db.prepare("SELECT r.*, b.content FROM revision r JOIN blob b ON b.hash = r.hash WHERE r.id = ?");
  const row = (r) => r && { id: Number(r.id), version: r.version, path: r.path, ts: r.ts, author: authorCode(r.author), source: r.source, threadId: r.thread_id ?? null, hash: r.hash, note: noteOut(r.note), ...(r.content !== undefined ? { content: r.content } : {}) };

  return {
    /** Record a snapshot; same content as the latest snapshot of (version, path) → null. */
    record({ version, path: p, content, author, source, threadId = null, note = null, ts = new Date().toISOString() }) {
      // Sources are fixed by the studio's own code, never typed by a viewer: a bad one is a bug (English, for logs).
      if (!HISTORY_SOURCES.includes(source)) throw new Error(`invalid history source: ${source}`);
      const hash = sha(content);
      if (qLatest.get(version, p)?.hash === hash) return null;
      qBlob.run(hash, content);
      return Number(qIns.run(version, p, ts, String(author ?? ""), source, threadId, hash, noteIn(note)).lastInsertRowid);
    },
    /** Every snapshot of a screen (all of its files), newest first. */
    list({ version, entry, limit = 500 }) {
      const paths = BOARD_FILE_SUFFIXES.map((s) => `${entry}${s}`);
      const q = db.prepare(`SELECT * FROM revision WHERE version = ? AND path IN (${paths.map(() => "?").join(",")}) ORDER BY id DESC LIMIT ?`);
      return q.all(version, ...paths, limit).map(row);
    },
    get(id) { return row(qGet.get(Number(id))); },
    latestHash(version, p) { return qLatest.get(version, p)?.hash; },
    /** Delete every snapshot of a version (the version was deleted, or its id is being created again). Returns how many were deleted. */
    purgeVersion(version) { return Number(db.prepare("DELETE FROM revision WHERE version = ?").run(version).changes); },
    hashOf: sha,
    close() { db.close(); },
  };
}
