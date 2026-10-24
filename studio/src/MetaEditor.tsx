// SCREEN INFO edited together (name, description, status, group, order, frames, scenarios): a form bound to the
// Y.js document of <screen>.meta.json over /__collab (per field, the last edit wins; adding / deleting / moving
// scenarios never overwrites someone else's). The server writes the file ~1 second later, so the screen list, the
// studio header and the board's scenario row update. The "plain language" rule is checked live on the name, the
// description and each scenario.
import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { Button, Field, IconButton, Select, cn } from "../ui";
import { humanIssues } from "../lib/spec-lint.mjs";
import { slugVi } from "../lib/spec-core.mjs";
import { yToMeta } from "../lib/meta-y.mjs";
import { boardStatusCode, isTempScenarioId, TEMP_SCENARIO_PREFIX } from "../lib/legacy-values.mjs";
import { boardStatusLabel } from "./i18n/values";
import { T } from "./i18n/spec";
import { editorsOf, openDoc, type Who } from "./collab";
import { useProject } from "./project";

type Sc = { id?: string; title?: string; desc?: string };
type Meta = { title?: string; section?: string; group?: string; order?: number; status?: string; desc?: string; viewports?: string[]; scenarios?: Sc[] };

/** lang: the project's — the words count as jargon or not in the language they are written in. */
function Lint({ text, lang }: { text?: string; lang?: string }) {
  const issues = text && lang ? humanIssues(text, { lang }) : [];
  if (!issues.length) return null;
  return <p className="mt-1 text-xs text-amber-800">{T.notPlain(issues.slice(0, 3).join(" · "))}</p>;
}

export function MetaEditor({ version, entry, me, onClose }: { version: string; entry: string; me: Who; onClose: () => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [online, setOnline] = useState(false);
  const [editors, setEditors] = useState<Who[]>([]);
  const [map, setMap] = useState<Y.Map<unknown> | null>(null);
  const contentLang = useProject()?.language;

  useEffect(() => {
    const c = openDoc(`${version}/${entry}.meta.json`, me);
    const m = c.doc.getMap("meta");
    setMap(m);
    const sync = () => setMeta(yToMeta(m) as Meta);
    m.observeDeep(sync);
    const onStatus = () => setOnline(c.provider.configuration.websocketProvider?.status === "connected" && c.provider.synced);
    c.provider.on("status", onStatus);
    c.provider.on("synced", () => { onStatus(); sync(); });
    const onAware = () => setEditors(editorsOf(c.provider));
    c.provider.awareness?.on("change", onAware);
    return () => { m.unobserveDeep(sync); c.provider.awareness?.off("change", onAware); c.destroy(); setMap(null); };
  }, [version, entry, me.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof Meta, v: unknown) => map?.set(k, v);
  const scenarios = () => map?.get("scenarios") as Y.Array<Y.Map<unknown>> | undefined;
  const setSc = (i: number, k: keyof Sc, v: string) => scenarios()?.get(i)?.set(k, v);
  const addSc = () => {
    const arr = scenarios() ?? (() => { const a = new Y.Array<Y.Map<unknown>>(); map!.set("scenarios", a); return a; })();
    const ids = new Set(arr.toArray().map((x) => x.get("id")));
    let n = arr.length + 1, id = `${TEMP_SCENARIO_PREFIX}${n}`;
    while (ids.has(id)) id = `${TEMP_SCENARIO_PREFIX}${++n}`;
    const sm = new Y.Map<unknown>(); sm.set("id", id); sm.set("title", "");
    arr.push([sm]);
  };
  const moveSc = (i: number, d: -1 | 1) => {
    const arr = scenarios(); if (!arr) return;
    const j = i + d; if (j < 0 || j >= arr.length) return;
    map!.doc!.transact(() => {
      const data = arr.get(i).toJSON();
      arr.delete(i, 1);
      const sm = new Y.Map<unknown>(); for (const [k, v] of Object.entries(data)) sm.set(k, v);
      arr.insert(j, [sm]);
    });
  };
  const vpValue = useMemo(() => { const v = meta?.viewports ?? ["desktop", "mobile"]; return v.length === 2 ? "both" : v[0]; }, [meta?.viewports]);

  return (
    <aside data-meta-editor className="fixed inset-y-0 right-0 z-40 w-full md:w-[440px] bg-surface border-l border-ink-200 flex flex-col">
      <header className="px-4 py-3 border-b border-ink-200 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink-900">{T.screenInfo}</p>
          <p className="text-xs text-ink-500 flex items-center gap-1.5">
            <span className={cn("w-1.5 h-1.5 rounded-full", online ? "bg-emerald-500" : "bg-ink-300")} /> {online ? T.connectedAutosave : T.saveStatus.connecting}
            <span data-editors={editors.length} className="ml-2 inline-flex items-center gap-1">
              {editors.slice(0, 5).map((e, i) => <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: e.color }} title={e.name} />)}
              {T.editors(editors.length)}
            </span>
          </p>
        </div>
        <IconButton label={T.close} onClick={onClose}><X size={18} /></IconButton>
      </header>
      {!meta ? (
        <p className="p-4 text-sm text-ink-500">{T.loading}</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <Field label={T.screenName} required>
            <input data-meta-field="title" className="input" value={meta.title ?? ""} onChange={(e) => set("title", e.target.value)} />
            <Lint text={meta.title} lang={contentLang} />
          </Field>
          <Field label={T.description}>
            <textarea data-meta-field="desc" className="input resize-y" rows={3} value={meta.desc ?? ""} onChange={(e) => set("desc", e.target.value)} />
            <Lint text={meta.desc} lang={contentLang} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={T.status}>
              {/* Codes are stored (current / proposed / approved); an old word is shown as its code's label, a
                  project's own word as it is. */}
              <Select
                ariaLabel={T.status}
                value={boardStatusCode(meta.status ?? "current")}
                onChange={(v) => set("status", v)}
                options={[...new Set(["current", "proposed", "approved", boardStatusCode(meta.status ?? "current")])].map((v) => ({ value: v, label: boardStatusLabel(v) }))}
              />
            </Field>
            <Field label={T.frames}>
              <Select
                ariaLabel={T.frames}
                value={vpValue}
                onChange={(v) => set("viewports", v === "both" ? ["desktop", "mobile"] : [v])}
                options={[{ value: "both", label: T.viewports.both }, { value: "desktop", label: T.viewports.desktop }, { value: "mobile", label: T.viewports.mobile }]}
              />
            </Field>
            <Field label={T.group}>
              <input className="input" value={meta.group ?? ""} onChange={(e) => set("group", e.target.value)} />
            </Field>
            <Field label={T.order}>
              <input className="input" type="number" value={meta.order ?? ""} onChange={(e) => set("order", e.target.value === "" ? undefined : Number(e.target.value))} />
            </Field>
          </div>
          <section>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink-900">{T.scenarios(meta.scenarios?.length ?? 0)}</p>
              <Button onClick={addSc}><Plus size={14} /> {T.addScenario}</Button>
            </div>
            <ol className="mt-2 space-y-2">
              {(meta.scenarios ?? []).map((sc, i) => (
                <li key={`${sc.id}-${i}`} data-meta-scenario={sc.id} className="border border-ink-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-1">
                    <span className="text-xs tabular-nums text-ink-400 w-5">{i + 1}.</span>
                    <input className="input flex-1" placeholder={T.scenarioName} value={sc.title ?? ""} onChange={(e) => setSc(i, "title", e.target.value)} />
                    <IconButton label={T.moveUp} disabled={i === 0} onClick={() => moveSc(i, -1)}><ArrowUp size={15} /></IconButton>
                    <IconButton label={T.moveDown} disabled={i === (meta.scenarios?.length ?? 0) - 1} onClick={() => moveSc(i, 1)}><ArrowDown size={15} /></IconButton>
                    <IconButton label={T.deleteScenario} onClick={() => scenarios()?.delete(i, 1)}><Trash2 size={15} /></IconButton>
                  </div>
                  <textarea className="input resize-y text-sm" rows={2} placeholder={T.description} value={sc.desc ?? ""} onChange={(e) => setSc(i, "desc", e.target.value)} />
                  <Lint text={`${sc.title ?? ""} ${sc.desc ?? ""}`} lang={contentLang} />
                  <p className="text-[11px] text-ink-400">{!sc.title && isTempScenarioId(sc.id) ? T.scenarioIdUnnamed(sc.id ?? "") : T.scenarioId(sc.id ?? "")}{" "}
                    {/* Only a NEW scenario (temporary id scenario-N, or the old kich-ban-N): renaming an existing
                        scenario's id would break the marks that point at it in conversations. */}
                    {!sc.title || !isTempScenarioId(sc.id) || slugVi(sc.title) === sc.id ? null : (
                      <button type="button" className="underline hover:text-ink-700" onClick={() => setSc(i, "id", slugVi(sc.title!).slice(0, 60))}>{T.idFromName}</button>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </aside>
  );
}
