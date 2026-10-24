// Guard for whoever publishes the package: nothing from a private project may slip into the repository. The words to
// look for are private themselves, so they are not in this file: one regular expression per line in the file named
// by CRAFT_LEAK_DENYLIST, else in .leak-denylist at the repository root (git-ignored); lines starting with # are
// comments. Without such a file the scan is skipped. Every file of the repository is scanned except node_modules,
// .git, the lockfile, images and this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SKIP = new Set(["node_modules", ".git", "package-lock.json", ".leak-denylist"]);
const LIST = process.env.CRAFT_LEAK_DENYLIST || path.join(ROOT, ".leak-denylist");
// The one allowed mention of the owner: the public repository's own address (package.json, README).
const PUBLIC_HOME = /(?:github\.com\/|github:)giangm9\/craft-table(?![\w-])/gi;

/** Denylist lines → a test for one line of text (the repository's address is taken out first). */
function leakTest(lines) {
  const patterns = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => new RegExp(l, "iu"));
  return (line) => {
    const rest = line.replace(PUBLIC_HOME, "");
    return patterns.some((p) => p.test(rest));
  };
}

function* files(dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(d.name)) continue;
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) yield* files(abs);
    else if (!/\.(png|jpe?g|webp|gif|woff2?|ico)$/i.test(d.name)) yield abs;
  }
}

test("the repository's address is allowed, nothing else about its owner", () => {
  const leaks = leakTest(["# a comment", "giangm9", "secret-project"]);
  for (const ok of ["npm install github:giangm9/craft-table", '"url": "git+https://github.com/giangm9/craft-table.git"', "https://github.com/giangm9/craft-table/issues"]) assert.equal(leaks(ok), false, ok);
  for (const bad of ["giangm9@mail.example", "https://github.com/giangm9/other-repo", "github.com/giangm9/craft-table-private", "by giangm9", "github:giangm9/craft-table and giangm9@mail.example", "the Secret-Project app"]) assert.equal(leaks(bad), true, bad);
});

test("no trace of a private project in the repository (names, domains, people, machine paths)", { skip: !fs.existsSync(LIST) && `no denylist at ${LIST}` }, () => {
  const leaks = leakTest(fs.readFileSync(LIST, "utf8").split("\n"));
  const hits = [];
  for (const f of files(ROOT)) {
    if (f === import.meta.filename) continue;
    fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (leaks(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${l.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(hits, [], `${hits.length} lines:\n${hits.slice(0, 150).join("\n")}`);
});
