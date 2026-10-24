// craft-table.json of the project (name, logo, language, source scope) — fetched once, shared by every page.
import { useEffect, useState } from "react";
import { api, type Project } from "./api";

let cache: Promise<Project> | null = null;
export const loadProject = () => (cache ??= api.project());

export function useProject() {
  const [p, setP] = useState<Project | null>(null);
  useEffect(() => { loadProject().then(setP).catch(() => {}); }, []);
  return p;
}
