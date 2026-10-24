#!/usr/bin/env node
// The i18n gate: no Vietnamese outside the dictionaries. Every text a viewer or Claude reads comes from a dictionary
// with both languages (lib/i18n/*, src/i18n/*, agent-rules/vi/); code, comments and logs are English.
//   node studio/lib/i18n-gate.mjs [file …]   offending lines of these files (default: the whole package)
// With no file it checks every file of the package under studio/ and bin/ that git knows or would add (tracked,
// plus new files not ignored — so a new file is checked before its first commit). Exit 1 when a line is found.
// Exempt: tests (*.test.mjs), the dictionaries, the Vietnamese rules, and lib/legacy-values.mjs (the old stored words).
// lib/no-vietnamese.test.mjs runs the same check as a test.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * The Vietnamese letters with a diacritic (precomposed, both cases, d with stroke), written as code points so this
 * file passes its own gate: Latin-1 (U+00C0..U+00FD, the a/e/i/o/u/y forms Vietnamese uses), Latin Extended-A/B
 * (a breve, d stroke, i/u tilde, o/u horn) and the Vietnamese block of Latin Extended Additional (U+1EA0..U+1EF9).
 */
const CODE_POINTS = [
  [0xc0, 0xc3], [0xc8, 0xca], [0xcc, 0xcd], [0xd2, 0xd5], [0xd9, 0xda], [0xdd, 0xdd],
  [0xe0, 0xe3], [0xe8, 0xea], [0xec, 0xed], [0xf2, 0xf5], [0xf9, 0xfa], [0xfd, 0xfd],
  [0x102, 0x103], [0x110, 0x111], [0x128, 0x129], [0x168, 0x169], [0x1a0, 0x1a1], [0x1af, 0x1b0],
  [0x1ea0, 0x1ef9],
];
const hex = (n) => `\\u{${n.toString(16)}}`;
export const VIETNAMESE = new RegExp(`[${CODE_POINTS.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join("")}]`, "u");

const EXEMPT = [
  /\.test\.mjs$/,
  /^studio\/src\/i18n\//,
  /^studio\/lib\/i18n\//,
  /^studio\/agent-rules\/vi\//,
  /^studio\/lib\/legacy-values\.mjs$/,
];
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|pdf|zip|gz)$/i;

const rel = (f) => path.relative(ROOT, path.resolve(ROOT, f)).split(path.sep).join("/");

/** Path (relative to the package root, "/" separators) exempt from the gate? */
export const isExempt = (p) => EXEMPT.some((re) => re.test(rel(p)));

/** Files of the package the gate checks by default: studio/ and bin/, tracked or new (not ignored), still on disk. */
export function gateFiles(root = ROOT) {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "studio", "bin"], { cwd: root, encoding: "utf8" });
  return [...new Set(out.split("\n").filter(Boolean))].filter((f) => !BINARY.test(f) && fs.existsSync(path.join(root, f))).sort();
}

/** Lines with Vietnamese in `files` (absolute, or relative to the package root), exempt files skipped → [{ file, line, text }]. */
export function offenders(files) {
  const hits = [];
  for (const f of files) {
    if (isExempt(f)) continue;
    const abs = path.resolve(ROOT, f);
    let text;
    try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
    text.split("\n").forEach((l, i) => { if (VIETNAMESE.test(l)) hits.push({ file: rel(abs), line: i + 1, text: l.trim().slice(0, 160) }); });
  }
  return hits;
}

/** Offending lines counted per file, most first → [[file, count]]. */
export function countByFile(hits) {
  const m = new Map();
  for (const h of hits) m.set(h.file, (m.get(h.file) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2);
  const hits = offenders(args.length ? args : gateFiles());
  for (const h of hits) console.log(`${h.file}:${h.line}: ${h.text}`);
  if (hits.length) {
    console.log(`\n${hits.length} line(s) with Vietnamese in ${countByFile(hits).length} file(s):`);
    for (const [f, n] of countByFile(hits)) console.log(`  ${String(n).padStart(4)}  ${f}`);
    process.exitCode = 1;
  } else console.log("i18n gate: no Vietnamese outside the dictionaries");
}
