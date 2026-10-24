// A version is a FULL COPY of the whole app inside the studio (a version is a big
// clone; small changes get history instead). Each version is a complete folder versions/<id>/{system,boards} — design
// system included, so a new version can change buttons/colours without touching the live one.
//   versions/index.json        { live, order[] }   — exactly one "live" version
//   versions/<id>/version.json { id, title, status, from, createdAt, createdBy, note }
// Errors a viewer can meet are StudioErrors (texts in lib/i18n/data.mjs), translated at the server boundary.
import fs from "node:fs";
import path from "node:path";
import { slugVi } from "./spec-core.mjs";
import { StudioError } from "./i18n.mjs";
import { versionStatusCode } from "./legacy-values.mjs";

// Stored as neutral codes (labels: studio/src/i18n/values.ts). version.json files written by earlier versions hold
// Vietnamese words: read through versionStatusCode, written back as codes.
export const VERSION_STATUSES = ["draft", "approved", "live", "archived"];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export const isValidVersionId = (s) => typeof s === "string" && ID_RE.test(s);
export const slugVersion = (title) => slugVi(title).slice(0, 40).replace(/-+$/, "") || "version";

const must = (v) => { if (!isValidVersionId(v)) throw new StudioError("versionIdInvalid", { id: String(v) }); return v; };
export const versionDir = (root, v) => path.join(root, "versions", must(v));
export const boardsDir = (root, v) => path.join(versionDir(root, v), "boards");
export const systemDir = (root, v) => path.join(versionDir(root, v), "system");

const indexFile = (root) => path.join(root, "versions", "index.json");
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
function writeJson(f, data) {
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, f);
}

export function readIndex(root) {
  const x = readJson(indexFile(root));
  return { live: x.live, order: Array.isArray(x.order) ? x.order : [] };
}

/**
 * The live version, never throwing: index.json → live; index missing/broken/without a valid live → the first
 * version folder (by name) that has a version.json; a project with no version yet → null (the caller reports it,
 * no version name is guessed).
 */
export function liveVersion(root) {
  try { const { live } = readIndex(root); if (isValidVersionId(live)) return live; } catch { /* guess from the folders */ }
  let names = [];
  try { names = fs.readdirSync(path.join(root, "versions")).sort(); } catch { return null; }
  return names.find((v) => isValidVersionId(v) && fs.existsSync(path.join(root, "versions", v, "version.json"))) ?? null;
}

export function readVersion(root, v) {
  const info = readJson(path.join(versionDir(root, v), "version.json"));
  return info && typeof info === "object" && "status" in info ? { ...info, status: versionStatusCode(info.status) } : info;
}

export function listVersions(root) {
  const { live, order } = readIndex(root);
  return order.filter((v) => isValidVersionId(v) && fs.existsSync(path.join(versionDir(root, v), "version.json")))
    .map((v) => ({ ...readVersion(root, v), live: v === live }));
}

export function createVersion(root, { from, title, by, note = "" }) {
  must(from);
  const src = versionDir(root, from);
  if (!fs.existsSync(path.join(src, "version.json"))) throw new StudioError("versionSourceMissing", { id: from });
  const name = String(title ?? "").trim().slice(0, 80);
  if (!name) throw new StudioError("versionTitleMissing");
  const base = slugVersion(name);
  let id = base, n = 1;
  while (fs.existsSync(path.join(root, "versions", id))) id = `${base}-${++n}`;
  const dst = path.join(root, "versions", id);
  // Copy the files as written on disk; skip the temp files of unfinished writes (*.tmp).
  for (const part of ["system", "boards", "tsconfig.json"]) {
    const s = path.join(src, part);
    if (fs.existsSync(s)) fs.cpSync(s, path.join(dst, part), { recursive: true, filter: (p) => !p.endsWith(".tmp") });
  }
  const info = { id, title: name, status: "draft", from, createdAt: new Date().toISOString(), createdBy: String(by ?? ""), note: String(note).slice(0, 2000) };
  writeJson(path.join(dst, "version.json"), info);
  const idx = readIndex(root);
  writeJson(indexFile(root), { live: idx.live, order: [id, ...idx.order.filter((x) => x !== id)] });
  return info;
}

export function updateVersion(root, v, patch = {}) {
  const cur = readVersion(root, v);
  const next = { ...cur };
  if (patch.title !== undefined) { const t = String(patch.title).trim().slice(0, 80); if (!t) throw new StudioError("versionTitleMissing"); next.title = t; }
  if (patch.status !== undefined) {
    const status = versionStatusCode(patch.status); // a page still sending an old word stores its code
    if (!VERSION_STATUSES.includes(status)) throw new StudioError("badVersionStatus", { status: String(patch.status) });
    next.status = status;
  }
  if (patch.note !== undefined) next.note = String(patch.note).slice(0, 2000);
  writeJson(path.join(versionDir(root, v), "version.json"), next);
  return next;
}

export function setLive(root, v) {
  updateVersion(root, v, { status: "live" });
  const idx = readIndex(root);
  writeJson(indexFile(root), { live: v, order: idx.order });
  // The studio UI typechecks against the live version's design system (tsconfig.json has comments → edit the text).
  const ts = path.join(root, "tsconfig.json");
  if (fs.existsSync(ts)) {
    const src = fs.readFileSync(ts, "utf8");
    const next = src.replace(/\.\/versions\/[a-z0-9-]+\/system\//g, `./versions/${v}/system/`);
    if (next !== src) { fs.writeFileSync(`${ts}.tmp`, next); fs.renameSync(`${ts}.tmp`, ts); }
  }
}

/** Suffixes of the files of ONE screen (board, info, the 2 specs). */
export const BOARD_FILE_SUFFIXES = [".tsx", ".meta.json", ".behavior.md", ".tech.md"];

/** Does screen `entry` of version `v` differ from source version `from` (any of its files added, removed or edited)? */
export function boardChanged(root, v, from, entry) {
  if (!from) return false;
  const read = (ver, suf) => { try { return fs.readFileSync(path.join(boardsDir(root, ver), `${entry}${suf}`)); } catch { return null; } };
  return BOARD_FILE_SUFFIXES.some((suf) => {
    const a = read(v, suf), b = read(from, suf);
    return (a === null) !== (b === null) || (a !== null && !a.equals(b));
  });
}
