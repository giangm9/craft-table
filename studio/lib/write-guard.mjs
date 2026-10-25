// What Claude may write into a version — ONE rule for every way in: the edit / write tools, the bulk replace tool and
// the files a sandboxed script leaves behind (sandbox.mjs). Only boards/ and system/ of the version, only editable
// text types, never version.json / tsconfig.json; CSS that makes Tailwind load or run another file is refused (it would
// run code inside the studio server), and a screen option's info file must keep its shape.
import { cssDangers } from "./css-guard.mjs";
import { optionMetaIssue } from "./option-meta.mjs";
import { normalizeLang, translate } from "./i18n.mjs";
import AGENT from "./i18n/agent.mjs";

export const WRITABLE_EXT = /\.(tsx|ts|css|md|json)$/;

/** A path relative to versions/<v>/ that Claude may create, change or delete. */
export function writableRel(rel) {
  if (typeof rel !== "string" || !rel || rel.startsWith("/") || rel.includes("\0") || rel.split(/[\\/]/).includes("..")) return false;
  if (!/^(boards|system)\//.test(rel) || !WRITABLE_EXT.test(rel)) return false;
  return !/(^|\/)(version|tsconfig)\.json$/.test(rel);
}

/** Something wrong with `content` as the new text of `rel` (a sentence in the project's language), or null when it is fine. */
export function contentIssue(rel, content, { lang = "en" } = {}) {
  const l = normalizeLang(lang) ?? "en";
  if (rel.endsWith(".css")) {
    const bad = cssDangers(content);
    if (bad.length) return translate(AGENT, l, "cssBlocked", { found: bad.join(", ") });
  }
  return optionMetaIssue(rel, content, { lang: l }) ?? null;
}
