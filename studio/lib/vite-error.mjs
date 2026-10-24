// A Vite compile error (the "vite:error" event) → short and readable, ONLY when it belongs to the board file on view.
// Shared by the error strip in the frame (frame-entry.tsx) and the error line in the Code pane (CodeEditor.tsx). Pure.

/**
 * @param {{ message?: string, id?: string, loc?: { file?: string, line?: number, column?: number } } | undefined} err
 * @param {string} file "/versions/<v>/boards/<id>.tsx"
 * @returns {{ line: number | null, column: number | null, message: string } | null}
 */
export function boardError(err, file) {
  if (!err) return null;
  const raw = String(err.message ?? "");
  const lead = /^(\/\S+?\.tsx)(?::\d+:\d+)?:/.exec(raw)?.[1];
  const where = err.loc?.file ?? err.id ?? lead ?? "";
  if (!where.endsWith(file)) return null;
  // The first meaningful line: without "Transform failed…", the absolute path (with :line:column), "ERROR:", "(line:column)".
  const first = raw.split("\n").map((l) => l.trim()).find((l) => l && !/^Transform failed/i.test(l)) ?? "";
  const pos = /\((\d+):(\d+)\)\s*$/.exec(first);
  const message = first
    .replace(/^\/\S+?\.tsx(?::\d+:\d+)?:\s*/, "")
    .replace(/^ERROR:\s*/, "")
    .replace(/\s*\(\d+:\d+\)\s*$/, "")
    .trim();
  return {
    line: err.loc?.line ?? (pos ? Number(pos[1]) : null),
    column: err.loc?.column ?? (pos ? Number(pos[2]) : null),
    message: message || raw.split("\n")[0],
  };
}
