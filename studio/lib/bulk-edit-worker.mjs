// Runs one bulk find-and-replace over file contents inside a worker thread, so a pattern that backtracks for ever can be
// cut off by bulk-edit.mjs (terminating the thread) instead of freezing the studio server.
import { parentPort, workerData } from "node:worker_threads";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function run({ files, pattern, replacement, regex, flags, maxMatches }) {
  const re = new RegExp(regex ? pattern : escapeRe(pattern), flags);
  const out = [];
  let total = 0;
  for (const f of files) {
    re.lastIndex = 0;
    const count = [...f.content.matchAll(re)].length;
    if (!count) continue;
    total += count;
    if (total > maxMatches) return { ok: false, error: `more than ${maxMatches} matches — the pattern is far too broad` };
    // A literal pattern has no groups: its replacement is taken as it is (a "$" in it is just a "$").
    const content = regex ? f.content.replace(re, replacement) : f.content.replace(re, () => replacement);
    const before = f.content.split("\n"), after = content.split("\n");
    const samples = [];
    if (before.length === after.length) {
      for (let i = 0; i < before.length && samples.length < 3; i++) {
        if (before[i] !== after[i]) samples.push({ line: i + 1, before: before[i].trim().slice(0, 160), after: after[i].trim().slice(0, 160) });
      }
    }
    out.push({ rel: f.rel, count, content, samples });
  }
  return { ok: true, files: out, total };
}

let result;
try { result = run(workerData); } catch (e) { result = { ok: false, error: String(e?.message ?? e) }; }
parentPort.postMessage(result);
