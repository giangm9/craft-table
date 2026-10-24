// Records history snapshots by itself: when a screen's file (versions/<v>/boards/**/<screen>.{tsx,meta.json,
// behavior.md,tech.md}, except _kit) stops changing for `quietMs` (a person stops typing / Claude finishes a round
// of writes) → one snapshot if the content differs.
// Who changed it: `attribute(version, path)` (e.g. Claude's turn running on that screen) → the person who just edited
// through co-editing (markHuman) → otherwise "external" (git, hand edits on the machine).
import fs from "node:fs";
import path from "node:path";
import { BOARD_FILE_SUFFIXES } from "./versions.mjs";

const HUMAN_TTL = 60_000;

export function createRecorder({ root, history, attribute = () => null, quietMs = 3000, onRecord = () => {} }) {
  const vroot = path.join(root, "versions");
  const timers = new Map();
  const humans = new Map(); // "v:path" → { email, at }

  /** Absolute path → { version, rel } when it is a screen's file, otherwise null. */
  function parse(abs) {
    const r = path.relative(vroot, abs).split(path.sep);
    if (r.length < 3 || r[0] === ".." || r[1] !== "boards") return null;
    const rel = r.slice(2).join("/");
    if (rel.split("/").some((s) => s.startsWith("_") || s.startsWith("."))) return null;
    if (!BOARD_FILE_SUFFIXES.some((s) => rel.endsWith(s)) || rel.endsWith(".tmp")) return null;
    return { version: r[0], rel, abs };
  }

  function write(f) {
    let content;
    try { content = fs.readFileSync(f.abs, "utf8"); } catch { return null; } // file deleted — history keeps the old snapshots
    const key = `${f.version}:${f.rel}`;
    const h = humans.get(key);
    const who = attribute(f.version, f.rel)
      ?? (h && Date.now() - h.at < HUMAN_TTL ? { author: h.email, source: "human", threadId: null } : { author: "external", source: "external", threadId: null });
    humans.delete(key);
    const id = history.record({ version: f.version, path: f.rel, content, ...who });
    if (id) onRecord({ id, version: f.version, path: f.rel });
    return id;
  }

  return {
    touch(abs) {
      const f = parse(abs);
      if (!f) return;
      clearTimeout(timers.get(abs));
      timers.set(abs, setTimeout(() => { timers.delete(abs); write(f); }, quietMs));
    },
    /** Record every pending file now (when the server shuts down). */
    flush() {
      for (const [abs, t] of timers) { clearTimeout(t); const f = parse(abs); if (f) write(f); }
      timers.clear();
    },
    markHuman(version, rel, email) { humans.set(`${version}:${rel}`, { email, at: Date.now() }); },
    /** Sync at startup / after copying a version: a file with no snapshot yet → "init"; a file that differs from its
     *  latest snapshot (changed while the studio was off) → "external". Returns how many snapshots were recorded. */
    baseline() {
      let n = 0;
      if (!fs.existsSync(vroot)) return 0;
      const walk = (dir) => {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, d.name);
          if (d.isDirectory()) { if (!d.name.startsWith("_") && !d.name.startsWith(".")) walk(abs); continue; }
          const f = parse(abs);
          if (!f) continue;
          const content = fs.readFileSync(abs, "utf8");
          const seen = history.latestHash(f.version, f.rel);
          if (seen === history.hashOf(content)) continue;
          // Neutral codes (author) and a { key } note: the UI words them in the viewer's language.
          const who = seen ? { author: "external", source: "external", note: { key: "changedWhileOff" } } : { author: "init", source: "init" };
          if (history.record({ version: f.version, path: f.rel, content, ...who })) n++;
        }
      };
      for (const v of fs.readdirSync(vroot, { withFileTypes: true })) if (v.isDirectory()) { const b = path.join(vroot, v.name, "boards"); if (fs.existsSync(b)) walk(b); }
      return n;
    },
  };
}
