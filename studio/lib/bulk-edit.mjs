// Bulk find-and-replace over the text of many files — what Claude uses for a change that touches a whole design
// ("every padding class × 0.75" is a pattern, not 2,000 separate edits). Pure: it takes the files' contents and returns the new
// contents; reading, writing and the write rules (write-guard.mjs) are the caller's. The pattern runs in a worker thread
// with a time limit, because a regular expression from a model can backtrack for ever.
import { Worker } from "node:worker_threads";

/**
 * files: [{ rel, content }]. pattern: literal text, or a JS regular expression when `regex` (flags: g is always on;
 * `i` / `ignoreCase`, `m`, `s`, `u` allowed). replacement: for a regex, `$1`, `$&` … as in String.replace.
 * → { ok: true, total, files: [{ rel, count, content, samples: [{ line, before, after }] }] }  (only files with a match)
 *   | { ok: false, error }
 */
export function bulkReplace({ files, pattern, replacement, regex = false, flags = "g", ignoreCase = false, timeoutMs = 4000, maxMatches = 20_000 }) {
  if (typeof pattern !== "string" || !pattern) return Promise.resolve({ ok: false, error: "the pattern is empty" });
  const fl = [...new Set(`g${flags}${ignoreCase ? "i" : ""}`.replace(/[^gimsu]/g, ""))].join("");
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./bulk-edit-worker.mjs", import.meta.url), { workerData: { files, pattern, replacement: String(replacement ?? ""), regex, flags: fl, maxMatches } });
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); worker.terminate().catch(() => {}); resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: `took longer than ${timeoutMs} ms (time limit) — the pattern may backtrack for ever; make it simpler` }), timeoutMs);
    worker.once("message", finish);
    worker.once("error", (e) => finish({ ok: false, error: String(e?.message ?? e) }));
    worker.once("exit", (code) => finish({ ok: false, error: `the replace stopped (exit ${code})` }));
  });
}
