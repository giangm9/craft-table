// The "check before you answer" guard of Claude in the studio: records the tools called; whatever was edited needs
// the matching check AFTER the last edit. The SDK's Stop hook (agent.mjs) stops Claude from finishing while one is
// missing.
//   .tsx / .ts / .css (boards, design system)        → check typecheck + view_frame
//   .meta.json (name, description, scenarios), .behavior.md → check lint
//   .behavior.md / .tech.md                          → check spec
// A failed call (an edit that did not apply, a check that still has errors) does not count.
// It returns tool names only; the message Claude reads is worded by agent.mjs.
export function createVerifyGuard() {
  let step = 0;
  const lastEdit = {};   // kind of work → step of the last edit
  const lastCheck = {};  // check → step of its last successful run
  const needs = { code: ["check typecheck", "view_frame"], text: ["check lint"], spec: ["check spec"] };
  const edited = new Set(); // "boards/…" | "system/…" edited this turn

  /** A check still has errors but none in a file edited this turn (another screen, someone else's unfinished edit) → this turn's part is clean. */
  const onlyOthers = (out) => {
    if (!out) return false;
    for (const rel of edited) {
      if (out.includes(rel)) return false; // tsc: versions/<v>/boards/…(line,col)
      const entry = rel.replace(/^boards\//, "").replace(/\.(meta\.json|behavior\.md|tech\.md|tsx|ts|css)$/, "");
      if (out.includes(`${entry} `) || out.includes(`${entry}.behavior.md`)) return false; // lint: "<screen> desc: …"
    }
    return true;
  };

  return {
    /** out: the tool's result text (to tell which file a check's errors are in). */
    record(name, args = {}, ok = true, out = "") {
      step++;
      if (!ok && name === "check" && (args.what === "typecheck" || args.what === "lint") && onlyOthers(out)) ok = true;
      if (!ok) return;
      const touched = (p) => {
        edited.add(p);
        if (/\.(tsx|ts|css)$/.test(p)) lastEdit.code = step;
        if (/\.meta\.json$/.test(p) || /\.behavior\.md$/.test(p)) lastEdit.text = step;
        if (/\.(behavior|tech)\.md$/.test(p)) lastEdit.spec = step;
      };
      // The files a bulk replace wrote / a script landed are named in the result ("wrote: …" / "landed: …", "deleted: …").
      const named = (marker) => { const m = new RegExp(`^${marker}:(.*)$`, "m").exec(out); return m ? (m[1].match(/(?:boards|system)\/[^\s,]+/g) ?? []) : []; };
      if (name === "edit" || name === "write") touched(String(args.path ?? ""));
      else if (name === "replace") { if (args.dry_run === false) named("wrote").forEach(touched); }
      else if (name === "run") { [...named("landed"), ...named("deleted")].forEach(touched); }
      else if (name === "check") lastCheck[`check ${args.what}`] = step;
      else if (name === "view_frame" || name === "browse") lastCheck.view_frame = step; // looking at the screens, one or many
    },
    /** The checks still missing (after the last edit of each kind). */
    missing() {
      const out = new Set();
      for (const [kind, at] of Object.entries(lastEdit)) for (const k of needs[kind]) if (!((lastCheck[k] ?? 0) > at)) out.add(k);
      return [...out];
    },
  };
}
