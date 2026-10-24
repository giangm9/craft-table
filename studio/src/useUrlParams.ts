// The studio's state lives in the URL (open board, frames, theme, selected thread…) → Back/Next and shared links
// both land in the right place. The studio does not use React Router.
import { useCallback, useEffect, useState } from "react";
import { urlValue } from "../lib/legacy-values.mjs";

/** URL parameters with old values read as their current ones (bookmarks made with earlier versions: rp=lich-su…). */
function currentParams(search: string) {
  const p = new URLSearchParams(search);
  for (const [k, v] of [...p]) { const now = urlValue(k, v); if (now !== v) p.set(k, now); }
  return p;
}

export function useUrlParams() {
  const [search, setSearch] = useState(() => location.search);
  useEffect(() => {
    const on = () => setSearch(location.search);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const params = currentParams(search);
  const set = useCallback((patch: Record<string, string | null>, mode: "push" | "replace" = "push") => {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    const next = `${location.pathname}${p.toString() ? `?${p}` : ""}`;
    if (next === `${location.pathname}${location.search}`) return;
    history[mode === "push" ? "pushState" : "replaceState"](null, "", next);
    setSearch(location.search);
  }, []);
  return [params, set] as const;
}
