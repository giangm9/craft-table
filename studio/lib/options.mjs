// OPTIONS per feature: a SMALL copy of one or a few screens inside the same version, to try another direction
// without touching the main screen. id = "<screen>~<name>" (e.g. "screens/orders/list~compact"); the files sit
// next to the main screen (same folder → relative imports in the board still resolve). An option's meta also has
//   option: { of, name, status: "trying" | "adopted", createdBy, createdAt, adoptedBy?, adoptedAt? }.
// Adopt = copy back over the main screen (without the option field) — history records snapshots with source "option".
// Errors a viewer can meet are StudioErrors (texts in lib/i18n/data.mjs), translated at the server boundary.
import fs from "node:fs";
import path from "node:path";
import { isValidEntryId } from "./entries.mjs";
import { StudioError } from "./i18n.mjs";
import { readMeta } from "./meta-io.mjs";
import { metaJson } from "./meta-y.mjs";
import { normalizeOption } from "./option-meta.mjs";
import { slugVi } from "./spec-core.mjs";
import { BOARD_FILE_SUFFIXES, boardsDir, isValidVersionId, versionDir } from "./versions.mjs";

const SLUG_MAX = 40;
export const optionSlug = (name) => slugVi(name).slice(0, SLUG_MAX).replace(/-+$/, "") || "option";
export const optionId = (entry, name) => `${entry}~${optionSlug(name)}`;
export const isOptionId = (id) => typeof id === "string" && id.includes("~");
export const optionBase = (id) => String(id).split("~")[0];

function writeAtomic(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, abs);
}

function boards(root, v) {
  if (!isValidVersionId(v) || !fs.existsSync(path.join(versionDir(root, v), "version.json"))) throw new StudioError("optionVersionMissing", { id: String(v) });
  return boardsDir(root, v);
}

/** An option id the caller names (adopt, rename, remove) → the id, or a StudioError when it is not an option. */
function mustOption(id) {
  if (!isValidEntryId(id) || !isOptionId(id)) throw new StudioError("optionNotOption", { id: String(id) });
  return id;
}

/** Create option `name` for screens `entries` → the new ids (one name for every screen; taken → "-2", "-3"…). */
export function createOption(root, v, { entries, name, by }) {
  const dir = boards(root, v);
  const nm = String(name ?? "").trim().slice(0, 80);
  if (!nm) throw new StudioError("optionNameMissing");
  if (!Array.isArray(entries) || !entries.length) throw new StudioError("optionNoScreens");
  for (const e of entries) {
    if (!isValidEntryId(e)) throw new StudioError("optionScreenIdInvalid", { id: String(e) });
    if (isOptionId(e)) throw new StudioError("optionScreenIsOption", { id: e });
    if (!fs.existsSync(path.join(dir, `${e}.tsx`))) throw new StudioError("optionScreenMissing", { id: e });
  }
  const base = optionSlug(nm);
  const taken = (s) => entries.some((e) => BOARD_FILE_SUFFIXES.some((x) => fs.existsSync(path.join(dir, `${e}~${s}${x}`))));
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  const now = new Date().toISOString();
  return entries.map((e) => {
    const id = `${e}~${slug}`;
    for (const x of BOARD_FILE_SUFFIXES) {
      if (x === ".meta.json") continue;
      const src = path.join(dir, `${e}${x}`);
      if (fs.existsSync(src)) writeAtomic(path.join(dir, `${id}${x}`), fs.readFileSync(src, "utf8"));
    }
    const meta = readMeta(path.join(dir, `${e}.tsx`)) ?? { title: e };
    writeAtomic(path.join(dir, `${id}.meta.json`), metaJson({ ...meta, option: { of: e, name: nm, status: "trying", createdBy: String(by ?? ""), createdAt: now } }));
    return id;
  });
}

/** Adopt an option: copy it over the main screen (meta without the option field); the option becomes "adopted". Returns the paths (inside boards/) written. */
export function adoptOption(root, v, id, { by }) {
  const dir = boards(root, v);
  mustOption(id);
  if (!fs.existsSync(path.join(dir, `${id}.tsx`))) throw new StudioError("optionMissing", { id });
  const main = optionBase(id);
  const mf = path.join(dir, `${id}.meta.json`);
  const om = normalizeOption(id, JSON.parse(fs.readFileSync(mf, "utf8"))); // an option written in a wrong shape → repaired before merging
  const written = [];
  for (const x of BOARD_FILE_SUFFIXES) {
    const src = path.join(dir, `${id}${x}`);
    if (!fs.existsSync(src)) continue;
    let text = fs.readFileSync(src, "utf8");
    if (x === ".meta.json") { const { option: _o, ...rest } = om; text = metaJson(rest); }
    writeAtomic(path.join(dir, `${main}${x}`), text);
    written.push(`${main}${x}`);
  }
  writeAtomic(mf, metaJson({ ...om, option: { ...om.option, status: "adopted", adoptedBy: String(by ?? ""), adoptedAt: new Date().toISOString() } }));
  written.push(`${id}.meta.json`);
  return written;
}

/**
 * Rename an option's display name — for the whole group created together (same "~<name>" suffix and same creation
 * time: one feature across several screens). ids/files stay (links, chat threads, history do not break). Returns the
 * ids of the options renamed.
 */
export function renameOption(root, v, id, { name }) {
  const dir = boards(root, v);
  mustOption(id);
  const nm = String(name ?? "").trim().slice(0, 80);
  if (!nm) throw new StudioError("optionNameMissing");
  const mf = path.join(dir, `${id}.meta.json`);
  if (!fs.existsSync(mf)) throw new StudioError("optionMissing", { id });
  const created = JSON.parse(fs.readFileSync(mf, "utf8")).option?.createdAt;
  const suffix = `~${id.split("~")[1]}.meta.json`;
  const renamed = [];
  const walk = (d) => {
    for (const x of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, x.name);
      if (x.isDirectory()) { walk(abs); continue; }
      if (!x.name.endsWith(suffix)) continue;
      const fid = path.relative(dir, abs).split(path.sep).join("/").slice(0, -".meta.json".length);
      const m = normalizeOption(fid, JSON.parse(fs.readFileSync(abs, "utf8")));
      if (abs !== mf && (!created || m.option.createdAt !== created)) continue;
      writeAtomic(abs, metaJson({ ...m, option: { ...m.option, name: nm } }));
      renamed.push(fid);
    }
  };
  walk(dir);
  return renamed;
}

/** Remove an option: delete its files (the main screen is unchanged). Returns the paths deleted. */
export function removeOption(root, v, id) {
  const dir = boards(root, v);
  mustOption(id);
  const gone = [];
  for (const x of BOARD_FILE_SUFFIXES) {
    const f = path.join(dir, `${id}${x}`);
    if (fs.existsSync(f)) { fs.unlinkSync(f); gone.push(`${id}${x}`); }
  }
  return gone;
}
