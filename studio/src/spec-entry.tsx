// The /spec?e=<board>&k=behavior|tech&p=<page> page — the spec read full screen (the spec panel's "Open in new tab"
// link). Table of contents on the left + one page; changing page or tab writes the URL (pushState) → Back/Next work.
// p=all: every page unfolded on one page — for the check tools (chat.mjs spec, e2e) and for printing.
// The page speaks the viewer's language (<html lang>, set by the server); the spec itself is shown as written.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BookOpen, Code2, Languages } from "lucide-react";
import "../ui/tokens.css";
import "./studio.css";
import { cn } from "../ui";
import { SpecDoc } from "./SpecDoc";
import { loadProject } from "./project";
import { ruleTarget, specPages } from "../lib/spec-core.mjs";
import { T } from "./i18n/spec";
import { LangSwitch } from "./i18n/LangSwitch";

type Kind = "behavior" | "tech";
(window as Window & { __specErrors?: string[] }).__specErrors = [];

const readUrl = () => {
  const p = new URLSearchParams(location.search);
  return { kind: (p.get("k") === "tech" ? "tech" : "behavior") as Kind, page: p.get("p") };
};

function SpecPage() {
  const entry = new URLSearchParams(location.search).get("e") ?? "";
  const version = new URLSearchParams(location.search).get("v") ?? "";
  const vq = version ? `&v=${encodeURIComponent(version)}` : "";
  const [{ kind, page }, setNav] = useState(readUrl);
  const go = (k: Kind, pg: string | null) => {
    const u = new URL(location.href);
    u.searchParams.set("k", k);
    if (pg) u.searchParams.set("p", pg); else u.searchParams.delete("p");
    if (u.href !== location.href) history.pushState(null, "", u);
    setNav({ kind: k, page: pg });
  };
  const [title, setTitle] = useState(entry);
  const [projectName, setProjectName] = useState("");
  const [docs, setDocs] = useState<Record<Kind, string | null> | null>(null);
  const [jump, setJump] = useState<string | null>(null);

  useEffect(() => {
    const load = (k: Kind) => fetch(`/__api/spec?entry=${encodeURIComponent(entry)}&kind=${k}${vq}`).then(async (r) => (r.ok ? ((await r.json()) as { markdown: string }).markdown : null));
    const reload = () => Promise.all([load("behavior"), load("tech")]).then(([behavior, tech]) => setDocs({ behavior, tech }));
    reload();
    fetch(`/__api/entries${version ? `?v=${encodeURIComponent(version)}` : ""}`).then((r) => r.json()).then((d) => setTitle(d.entries.find((x: { id: string }) => x.id === entry)?.meta.title ?? entry));
    loadProject().then((p) => setProjectName(p.name)).catch(() => {});
    import.meta.hot?.on("studio:spec", reload);
  }, [entry]);

  useEffect(() => {
    const on = () => setNav(readUrl());
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);

  useEffect(() => {
    document.title = T.docTitle(title, kind === "tech" ? T.tech : T.behavior);
  }, [kind, title]);

  // Clicking Rn → that rule on the target page; any other page change → back to the top.
  useEffect(() => {
    if (jump) {
      document.querySelector(`[data-spec-page] [data-rule="${jump}"]`)?.scrollIntoView({ block: "center" });
      setJump(null);
    } else if (page !== "all") scrollTo({ top: 0 });
  }, [docs, kind, page]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-10 bg-surface border-b border-ink-200">
        <div className="max-w-[1200px] mx-auto px-5 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[11px] uppercase tracking-wider font-semibold text-ink-400">{T.specHeader(projectName)}</p>
            <div className="flex items-center gap-2">
              <Languages size={15} aria-hidden className="shrink-0 text-ink-400" />
              <LangSwitch className="w-36" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-ink-900 mt-0.5">{title}</h1>
          <div className="mt-2 flex gap-1">
            {([["behavior", T.behavior, BookOpen], ["tech", T.tech, Code2]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" onClick={() => go(k, null)} className={cn("inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium border-b-2 -mb-px", kind === k ? "border-accent-700 text-accent-800" : "border-transparent text-ink-500 hover:text-ink-800")}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="max-w-[1200px] mx-auto px-3 md:px-5 py-6">
        <div
          className="bg-surface border border-ink-200 rounded-xl"
          onClick={(e) => {
            const r = (e.target as HTMLElement).closest("[data-rule]");
            if (!r || !docs) return;
            const rule = r.getAttribute("data-rule")!;
            const other: Kind = kind === "behavior" ? "tech" : "behavior";
            setJump(rule);
            go(other, page === "all" ? "all" : docs[other] ? ruleTarget(specPages(docs[other]!), rule) : null);
          }}
        >
          {docs === null ? <p className="p-6 text-sm text-ink-500">{T.loading}</p>
            : docs[kind] ? <SpecDoc key={kind} markdown={docs[kind]!} page={page} all={page === "all"} onPage={(id) => go(kind, id)} tocClassName="@4xl:sticky @4xl:top-[118px] @4xl:self-start @4xl:max-h-[calc(100vh-130px)] @4xl:overflow-y-auto" />
            : <p className="p-6 text-sm text-ink-500">{T.tabEmpty}</p>}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><SpecPage /></StrictMode>);
