// Reads a board's meta from disk (server, tools, tests) — split from entries.mjs because that file is shared with the browser.
import fs from "node:fs";
import { extractMeta } from "./entries.mjs";

/** A board's meta: <screen>.meta.json next to the .tsx file first; otherwise the meta block in the .tsx. Broken JSON → null. */
export function readMeta(absTsx) {
  const json = absTsx.replace(/\.tsx$/, ".meta.json");
  if (fs.existsSync(json)) {
    try {
      const v = JSON.parse(fs.readFileSync(json, "utf8"));
      return v && typeof v === "object" && typeof v.title === "string" ? v : null;
    } catch {
      return null;
    }
  }
  try { return extractMeta(fs.readFileSync(absTsx, "utf8")); } catch { return null; }
}
