// Screen info (<screen>.meta.json) ⇄ a Y.js document for CO-EDITING in the studio. Each field is one value (the
// last edit wins); scenarios = Y.Array<Y.Map{id,title,desc}> so adding/removing/editing scenarios do not clash.
// Pure file (shared by the server and the browser).
import * as Y from "yjs";

export const META_KEYS = ["title", "section", "group", "order", "status", "desc", "viewports", "scenarios"];
const SC_KEYS = ["id", "title", "desc"];

const scenarioMap = (s) => {
  const m = new Y.Map();
  for (const k of SC_KEYS) if (s?.[k] != null) m.set(k, s[k]);
  return m;
};

/** Write a meta object into a Y.Map (an empty map). */
export function metaToY(map, meta) {
  for (const k of META_KEYS) {
    if (meta?.[k] === undefined) continue;
    if (k === "scenarios") { const a = new Y.Array(); a.push((meta.scenarios ?? []).map(scenarioMap)); map.set(k, a); }
    else map.set(k, meta[k]);
  }
}

/** Y.Map → meta object (empty scenario fields dropped). */
export function yToMeta(map) {
  const out = {};
  for (const k of META_KEYS) {
    const v = map.get(k);
    if (v === undefined) continue;
    if (k === "scenarios") {
      out.scenarios = (v instanceof Y.Array ? v.toArray() : []).map((sm) => {
        const s = {};
        for (const sk of SC_KEYS) { const x = sm.get(sk); if (x !== undefined && x !== "") s[sk] = x; }
        return s;
      });
    } else out[k] = v;
  }
  return out;
}

/** JSON of a .meta.json file: fixed field order, 2-space indent, final newline. */
export function metaJson(meta) {
  const o = {};
  for (const k of META_KEYS) if (meta?.[k] !== undefined) o[k] = meta[k];
  for (const k of Object.keys(meta ?? {})) if (!(k in o)) o[k] = meta[k];
  return JSON.stringify(o, null, 2) + "\n";
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Apply new meta (e.g. the file changed from outside) to a Y.Map: only what differs changes; scenarios match by id. */
export function applyMeta(map, next, origin) {
  const cur = yToMeta(map);
  if (same(cur, Object.fromEntries(META_KEYS.filter((k) => next?.[k] !== undefined).map((k) => [k, next[k]])))) return;
  const run = () => {
    for (const k of META_KEYS) {
      if (k === "scenarios") continue;
      if (next?.[k] === undefined) { if (map.has(k)) map.delete(k); }
      else if (!same(map.get(k), next[k])) map.set(k, next[k]);
    }
    const want = next?.scenarios;
    if (want === undefined) { if (map.has("scenarios")) map.delete("scenarios"); return; }
    let arr = map.get("scenarios");
    if (!(arr instanceof Y.Array)) { arr = new Y.Array(); map.set("scenarios", arr); }
    const byId = new Map(arr.toArray().map((sm) => [sm.get("id"), sm]));
    const rebuilt = want.map((s) => {
      const sm = byId.get(s.id);
      if (!sm) return scenarioMap(s);
      for (const sk of SC_KEYS) {
        if (s[sk] == null) { if (sm.has(sk)) sm.delete(sk); } else if (sm.get(sk) !== s[sk]) sm.set(sk, s[sk]);
      }
      return sm;
    });
    // Order/members changed → rearrange: maps with the same id are kept (moved as a copy of their content when needed).
    const curIds = arr.toArray().map((sm) => sm.get("id"));
    const nextIds = want.map((s) => s.id);
    if (!same(curIds, nextIds)) {
      const keep = new Set(nextIds);
      for (let i = arr.length - 1; i >= 0; i--) if (!keep.has(arr.get(i).get("id"))) arr.delete(i, 1);
      rebuilt.forEach((sm, i) => {
        const at = arr.toArray().indexOf(sm);
        if (at === i) return;
        if (at >= 0) { // same id, wrong place: Y has no "move" — copy the content (READ BEFORE deleting) into a new one at the right place
          const data = Object.fromEntries(SC_KEYS.map((k) => [k, sm.get(k)]));
          arr.delete(at, 1);
          arr.insert(i, [scenarioMap(data)]);
        } else arr.insert(i, [sm]);
      });
    }
  };
  if (map.doc) map.doc.transact(run, origin); else run();
}
