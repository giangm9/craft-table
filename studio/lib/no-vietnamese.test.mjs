// The studio speaks English and Vietnamese: every Vietnamese text lives in a dictionary (lib/i18n/*, src/i18n/*,
// agent-rules/vi/), never in code, comments or logs. Same check as `node studio/lib/i18n-gate.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countByFile, gateFiles, offenders } from "./i18n-gate.mjs";

test("no Vietnamese outside the dictionaries (studio/ and bin/)", () => {
  const hits = offenders(gateFiles());
  const summary = countByFile(hits).map(([f, n]) => `${String(n).padStart(4)}  ${f}`).join("\n");
  assert.equal(hits.length, 0, `${hits.length} line(s) in ${countByFile(hits).length} file(s) — run node studio/lib/i18n-gate.mjs for each line:\n${summary}`);
});
