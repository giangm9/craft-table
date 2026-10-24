// Checks after an edit (shared by chat.mjs and the sandbox tools of Claude in the studio):
//   typecheck — tsc of the studio UI + exactly one version (one tsconfig per version: @ds → that version's design system)
//   lint      — the "descriptions are plain words" rule for screen names/descriptions, scenarios and the Behavior tab
// Their texts are read by Claude, in the project's language (lang; lib/i18n/agent.mjs).
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { translate } from "./i18n.mjs";
import AGENT from "./i18n/agent.mjs";
import { readMeta } from "./meta-io.mjs";
import { behaviorIssues, humanIssues } from "./spec-lint.mjs";

/** lang: language of the result text ("en" when not given — chat.mjs prints it on the command line). */
export function typecheck(root, version, { studio = true, lang = "en" } = {}) {
  const t = (key, params) => translate(AGENT, lang, key, params);
  const projects = [...(studio ? ["tsconfig.json"] : []), `versions/${version}/tsconfig.json`];
  return projects.reduce((p, proj) => p.then((acc) => new Promise((resolve) => {
    execFile("npx", ["tsc", "--noEmit", "-p", proj], { cwd: root, timeout: 240_000 }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`.trim();
      resolve(err ? { ok: false, out: `${acc.out}${t("tscFailed", { project: proj, output: out.slice(0, 6000) })}\n` } : acc);
    });
  })), Promise.resolve({ ok: true, out: "" })).then((r) => (r.ok && !r.out ? { ok: true, out: t("tscClean", { studio, version }) } : { ok: false, out: r.out.trim() }));
}

/**
 * entries: screen ids (e.g. "screens/orders/list"). Returns { ok, issues: ["<screen> <field>: <problem>"] }. The
 * plain-language rule runs only when the project turns it on (craft-table.json → lint.plainLanguage); off →
 * { ok, issues: [], skipped: true }. lang: the project's language — picks the vocabulary and the words of the issues
 * (spec-lint.mjs; Vietnamese when not given, as before the studio spoke two languages). uiLang: the words of the
 * issues only, for a reader in another language (the command line is English); default = lang.
 */
export function lint(root, version, entries, { plainLanguage = true, lang, uiLang } = {}) {
  if (!plainLanguage) return { ok: true, issues: [], skipped: true };
  const opts = lang ? { lang } : {};
  const behOpts = { ...opts, ...(uiLang ? { uiLang } : {}) };
  const boards = path.join(root, "versions", version, "boards");
  const issues = [];
  for (const id of entries) {
    const tsx = path.join(boards, `${id}.tsx`), beh = path.join(boards, `${id}.behavior.md`);
    const meta = fs.existsSync(tsx) ? readMeta(tsx) ?? {} : {};
    const parts = [["title", meta.title], ["desc", meta.desc], ...(meta.scenarios ?? []).flatMap((s) => [[`${s.id}.title`, s.title], [`${s.id}.desc`, s.desc]])];
    for (const [k, v] of parts) for (const i of humanIssues(v ?? "", opts)) issues.push(`${id} ${k}: ${i}`);
    if (fs.existsSync(beh)) for (const i of behaviorIssues(fs.readFileSync(beh, "utf8"), behOpts)) issues.push(`${id}.behavior.md:${i}`);
  }
  return { ok: issues.length === 0, issues };
}
