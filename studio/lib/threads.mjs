// Design conversations: the pure part is in thread-core.mjs (shared with the UI); this is the IO —
// one JSON file per thread in <project>/threads/, written through a temp file + rename.
import fs from "node:fs/promises";
import path from "node:path";
export * from "./thread-core.mjs";
import { normalizeThread } from "./thread-core.mjs";
import { liveVersion } from "./versions.mjs";

// ── IO: <project>/threads/<id>.json ──────────────────────────────────────────
const ID_RE = /^t_[a-z0-9]{1,24}$/;
const fileOf = (dir, id) => path.join(dir, `${id}.json`);

/**
 * A thread written before versions existed → the version live AT LOAD TIME, read from the versions/ next to the
 * threads folder (<project>/threads ↔ <project>/versions) — callers pass nothing. versions/ is read only when such a
 * thread is met.
 */
const normalizeIn = (dir, t) => (t && !t.version ? normalizeThread(t, liveVersion(path.dirname(path.resolve(dir)))) : t);

export async function loadThread(dir, id) {
  if (!ID_RE.test(String(id))) return null;
  try { return normalizeIn(dir, JSON.parse(await fs.readFile(fileOf(dir, id), "utf8"))); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

export async function saveThread(dir, t) {
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${t.id}.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(t, null, 2) + "\n");
  await fs.rename(tmp, fileOf(dir, t.id));
}

export async function deleteThread(dir, id) {
  if (!ID_RE.test(String(id))) return false;
  try { await fs.unlink(fileOf(dir, id)); return true; } catch { return false; }
}

/** Threads of a board (or all of them when entry is empty) in one version (or every version), most recently updated first. */
export async function listThreads(dir, entry, version) {
  let names = [];
  try { names = await fs.readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json") || n.startsWith(".")) continue;
    try {
      const t = normalizeIn(dir, JSON.parse(await fs.readFile(path.join(dir, n), "utf8")));
      if ((!entry || t.entry === entry) && (!version || t.version === version)) out.push(t);
    } catch { /* a file being written — skip it this time */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
