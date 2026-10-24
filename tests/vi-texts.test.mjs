// Every Vietnamese text of the studio, locked: what Vietnamese-language projects show and send to Claude must not drift by
// accident. The dictionaries hold these texts word for word; projects' own e2e
// tests match them, and Claude's instructions were tuned in these words. The test renders the "vi" side of every
// dictionary (server, data, Claude's texts, the UI) and the Vietnamese system prompt, and compares them with
// tests/golden/vi-texts.json. A deliberate change: run `UPDATE_GOLDEN=1 node --test tests/vi-texts.test.mjs` and
// review the diff of the golden file like any other change.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import SERVER from "../studio/lib/i18n/server.mjs";
import DATA from "../studio/lib/i18n/data.mjs";
import AGENT from "../studio/lib/i18n/agent.mjs";
import { systemPrompt } from "../studio/lib/agent.mjs";

// The UI dictionaries import "./index" without an extension (Vite style); Node needs the .ts file.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./index" && context.parentURL?.includes("/studio/src/i18n/")) return next("./index.ts", context);
    return next(specifier, context);
  },
});
const ui = {
  shell: (await import("../studio/src/i18n/shell.ts")).SHELL_TEXTS,
  ui: (await import("../studio/src/i18n/ui.ts")).UI_TEXTS,
  threads: (await import("../studio/src/i18n/threads.ts")).TEXTS,
  history: (await import("../studio/src/i18n/history.ts")).HISTORY_TEXTS,
  spec: (await import("../studio/src/i18n/spec.ts")).SPEC_TEXTS,
  values: (await import("../studio/src/i18n/values.ts")).VALUE_TEXTS,
  stored: (await import("../studio/src/i18n/agent-texts.ts")).STORED_TEXTS,
};

const GOLDEN = path.join(import.meta.dirname, "golden", "vi-texts.json");

/** A stand-in for any parameter: reads as ‹name›; its fields are stand-ins too (‹name.field›); it can be called
 *  (a render callback, a Date method) and used as a one-item list (join, map, length 1, for…of). */
function param(name) {
  const fn = () => {};
  return new Proxy(fn, {
    apply: (_, __, args) => `‹${name}(${args.map(String).join(", ")})›`,
    get: (_, k) => {
      if (k === Symbol.toPrimitive || k === "toString" || k === "toJSON") return () => `‹${name}›`;
      if (k === "length") return 1;
      if (k === "join") return () => `‹${name}›`;
      if (k === "map") return (f) => [f(param(`${name}[0]`), 0)];
      if (k === Symbol.iterator) return () => [param(`${name}[0]`)][Symbol.iterator]();
      return typeof k === "string" ? param(`${name}.${k}`) : undefined;
    },
  });
}

/** A dictionary entry → plain JSON: strings as they are; a function called with stand-ins (and with 1 and 2, for
 *  counts); a function that cannot take a stand-in is recorded as such. */
function render(v) {
  if (typeof v === "string") return v;
  if (typeof v === "function") {
    const call = (args) => { try { return JSON.parse(JSON.stringify(v(...args))); } catch (e) { return `(throws ${e.constructor.name})`; } };
    const n = Math.max(1, v.length);
    return { params: call(Array.from({ length: n }, (_, i) => param(`a${i}`))), one: call([1]), two: call([2]) };
  }
  if (Array.isArray(v)) return v.map(render);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, render(x)]));
  return v;
}

function current() {
  const out = {};
  for (const [name, d] of Object.entries({ server: SERVER, data: DATA, agent: AGENT, ...ui })) out[name] = render(d.vi);
  out.systemPrompt = systemPrompt({
    project: { name: "Acme", description: "Cửa hàng mẫu.", language: "vi", source: { label: "acme-app", roots: ["src"], extensions: [".ts"] } },
    topics: ["boards", "marks", "specs"],
  });
  return out;
}

test("the Vietnamese texts are exactly the locked ones (tests/golden/vi-texts.json)", () => {
  const now = current();
  if (process.env.UPDATE_GOLDEN) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(now, null, 2) + "\n");
  }
  assert.ok(fs.existsSync(GOLDEN), "no golden file yet: run UPDATE_GOLDEN=1 node --test tests/vi-texts.test.mjs");
  assert.deepEqual(now, JSON.parse(fs.readFileSync(GOLDEN, "utf8")));
});
