// The Versions page (/versions): each version is a FULL COPY of the whole app in the studio.
// List them, create a new one from an existing one, change name / note / status, set the live version.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, Languages, Pencil, Rocket } from "lucide-react";
import { Badge, Button, ConfirmDialog, Field, InlineNotice, List, LoadError, Modal, Row, Select } from "../ui";
import { api, VERSION_STATUSES, type Version, type VersionStatus } from "./api";
import { T } from "./i18n/history";
import { locale } from "./i18n/index";
import { LangSwitch } from "./i18n/LangSwitch";
import { versionStatusLabel } from "./i18n/values";

// Keyed by the stored code (the server reads old Vietnamese values as codes).
const STATUS_TONE: Record<VersionStatus, string> = {
  draft: "bg-sky-50 text-sky-800 border border-sky-200",
  approved: "bg-amber-50 text-amber-800 border border-amber-200",
  live: "bg-emerald-50 text-emerald-800 border border-emerald-200",
  archived: "bg-ink-100 text-ink-600 border border-ink-200",
};
const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });

type Dialog = { kind: "create"; from: Version } | { kind: "edit"; v: Version } | { kind: "live"; v: Version } | null;

export function VersionsPage() {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<Record<string, number>>({});
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", note: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.versions().then((r) => {
      setVersions(r.versions);
      // Number of screens that differ from the source version, counted from each version's catalogue.
      for (const v of r.versions) if (v.from) api.entries(v.id).then((es) => setChanged((c) => ({ ...c, [v.id]: es.filter((e) => e.changed).length }))).catch(() => {});
    }).catch((e) => setError(String(e.message || e)));
  }, []);
  useEffect(() => {
    load();
    import.meta.hot?.on("studio:versions", load);
    return () => { import.meta.hot?.off?.("studio:versions", load); };
  }, [load]);

  const open = (d: Dialog) => {
    setFormError(null);
    if (d?.kind === "create") setForm({ title: "", note: "" });
    if (d?.kind === "edit") setForm({ title: d.v.title, note: d.v.note });
    setDialog(d);
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setFormError(null);
    try { await fn(); setDialog(null); load(); } catch (e) { setFormError(String((e as Error).message || e)); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="bg-surface border-b border-ink-200">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <a href="/" className="inline-flex items-center gap-1 text-sm text-accent-700 hover:underline"><ArrowLeft size={14} /> {T.backToStudio}</a>
            <div className="flex items-center gap-2">
              <Languages size={15} aria-hidden className="shrink-0 text-ink-400" />
              <LangSwitch className="w-36" />
            </div>
          </div>
          <h1 className="mt-2 text-xl font-semibold text-ink-900">{T.versionsTitle}</h1>
          <p className="mt-1 text-sm text-ink-600 max-w-2xl">{T.versionsIntro}</p>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-4">
        {error ? (
          <LoadError what={T.loadVersions} detail={error} onRetry={load} />
        ) : versions === null ? (
          <p className="text-sm text-ink-500">{T.loading}</p>
        ) : (
          <List>
            {versions.map((v) => (
              <Row key={v.id} data-version-row={v.id} className="flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex-1 min-w-[min(20rem,100%)]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink-900">{v.title}</span>
                    {v.live && <Badge className="bg-accent-700 text-white">{T.live}</Badge>}
                    <Badge className={STATUS_TONE[v.status] ?? STATUS_TONE.archived}>{versionStatusLabel(v.status)}</Badge>
                  </div>
                  {/* Separate facts joined with " · " (each one a whole phrase of the dictionary). */}
                  <p className="mt-0.5 text-xs text-ink-500">
                    {T.created(fmt(v.createdAt))}{v.createdBy ? ` · ${v.createdBy}` : ""}
                    {` · ${v.from ? T.copiedFrom(versions.find((x) => x.id === v.from)?.title ?? v.from) : T.original}`}
                    {v.from && changed[v.id] != null ? ` · ${T.changedScreens(changed[v.id])}` : ""}
                  </p>
                  {v.note && <p className="mt-1 text-sm text-ink-700">{v.note}</p>}
                </div>
                <div className="flex items-center gap-2 flex-wrap ml-auto">
                  <Select
                    ariaLabel={T.statusOf(v.title)}
                    value={v.status}
                    onChange={(s) => run(() => api.patchVersion(v.id, { status: s }))}
                    options={VERSION_STATUSES.map((s) => ({ value: s, label: versionStatusLabel(s) }))}
                  />
                  <a href={`/${v.live ? "" : `?v=${encodeURIComponent(v.id)}`}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border bg-surface border-ink-200 text-ink-700 hover:bg-ink-50">
                    <ExternalLink size={14} /> {T.open}
                  </a>
                  <Button onClick={() => open({ kind: "edit", v })} aria-label={T.editVersion(v.title)}><Pencil size={14} /></Button>
                  <Button onClick={() => open({ kind: "create", from: v })}><Copy size={14} /> {T.newFromHere}</Button>
                  {!v.live && <Button onClick={() => open({ kind: "live", v })}><Rocket size={14} /> {T.setLive}</Button>}
                </div>
              </Row>
            ))}
          </List>
        )}
      </main>

      {(dialog?.kind === "create" || dialog?.kind === "edit") && (
        <Modal
          title={dialog.kind === "create" ? T.newVersionFrom(dialog.from.title) : T.editVersion(dialog.v.title)}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>{T.cancel}</Button>
              <Button
                variant="primary"
                disabled={busy || !form.title.trim()}
                onClick={() => run(async () => {
                  if (dialog.kind === "create") {
                    const nv = await api.createVersion({ from: dialog.from.id, title: form.title, note: form.note });
                    location.href = `/?v=${encodeURIComponent(nv.id)}`;
                  } else await api.patchVersion(dialog.v.id, { title: form.title, note: form.note });
                })}
              >
                {busy ? T.saving : dialog.kind === "create" ? T.createCopy : T.save}
              </Button>
            </>
          }
        >
          <Field label={T.versionName} required>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
          </Field>
          <Field label={T.note}>
            <textarea className="input resize-y" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          {formError && <InlineNotice tone="error">{formError}</InlineNotice>}
        </Modal>
      )}
      {dialog?.kind === "live" && (
        <ConfirmDialog
          title={T.setLiveTitle(dialog.v.title)}
          confirmLabel={T.setLive}
          busy={busy}
          error={formError}
          onCancel={() => setDialog(null)}
          onConfirm={() => run(() => api.setLive(dialog.v.id))}
        >
          <p>{T.setLiveBody}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
