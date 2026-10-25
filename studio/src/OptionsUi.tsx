// OPTIONS per feature (studio/lib/options.mjs), the UI:
//   • The "New option" dialog: name it, pick more screens of the same group (a feature often spans several screens).
//   • The strip above the board while an option is shown: its name (renamable), status, Adopt (copies over the main
//     screen) / Remove / back to the main screen.
import { Fragment, createElement, useState, type ReactNode } from "react";
import { GitBranch, Pencil } from "lucide-react";
import { Button, ConfirmDialog, Field, InlineNotice, Modal, cn } from "../ui";
import { api, type Entry } from "./api";
import { T } from "./i18n/history";
import { optionStatusLabel } from "./i18n/values";

export const isOption = (e?: Entry) => !!e?.meta.option;

/** Parts of a rich text (dictionary function) → one node, no keys needed. */
const rich = (parts: ReactNode[]) => createElement(Fragment, null, ...parts);

export function CreateOptionDialog({ version, entry, entries, onClose, onCreated }: {
  version: string;
  entry: Entry;
  entries: Entry[];
  onClose: () => void;
  onCreated: (ids: string[]) => void;
}) {
  const [name, setName] = useState("");
  // Screens of the same group (options excluded): pick more of them to make an option for the whole feature.
  const siblings = entries.filter((e) => !e.meta.option && e.id !== entry.id && e.meta.section === entry.meta.section && e.meta.group === entry.meta.group);
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setErr(null);
    try { onCreated(await api.createOption({ v: version, entries: [entry.id, ...extra], name })); }
    catch (e) { setErr(String((e as Error).message ?? e)); setBusy(false); }
  };
  return (
    <Modal
      title={T.createOption}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{T.cancel}</Button>
        <Button variant="primary" onClick={create} disabled={busy || !name.trim()}><GitBranch size={15} /> {T.create}</Button>
      </>}
    >
      <Field label={T.optionName} required>
        <input data-option-name autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !busy) create(); }} />
      </Field>
      {siblings.length > 0 && (
        <Field label={T.optionScreens}>
          <div className="border border-ink-200 rounded-lg divide-y divide-ink-100 max-h-56 overflow-y-auto">
            <label className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-ink-500"><input type="checkbox" checked disabled /> {T.thisScreen(entry.meta.title)}</label>
            {siblings.map((s) => (
              <label key={s.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-ink-800 hover:bg-ink-50 cursor-pointer">
                <input type="checkbox" checked={extra.includes(s.id)} onChange={(e) => setExtra((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} />
                {s.meta.title}
              </label>
            ))}
          </div>
        </Field>
      )}
      {err && <InlineNotice tone="error">{err}</InlineNotice>}
    </Modal>
  );
}

/** Rename dialog of an option (renames the whole group of screens created together; paths stay the same). */
function RenameOptionDialog({ version, entry, onClose }: { version: string; entry: Entry; onClose: () => void }) {
  const [name, setName] = useState(entry.meta.option!.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setErr(null);
    try { await api.renameOption({ v: version, entry: entry.id, name }); onClose(); }
    catch (e) { setErr(String((e as Error).message ?? e)); setBusy(false); }
  };
  return (
    <Modal
      title={T.renameOption}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{T.cancel}</Button>
        <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>{T.save}</Button>
      </>}
    >
      <Field label={T.optionName} required>
        <input data-option-rename autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      </Field>
      {err && <InlineNotice tone="error">{err}</InlineNotice>}
    </Modal>
  );
}

/** Strip shown while an option is open + the Rename / Adopt / Remove dialogs (dialog state on the URL: opt=rename|adopt|remove). */
export function OptionBar({ version, entry, main, confirm, onConfirm, onGoMain, onDone }: {
  version: string;
  entry: Entry;
  main?: Entry;
  confirm: "rename" | "adopt" | "remove" | null;
  onConfirm: (c: "rename" | "adopt" | "remove" | null) => void;
  onGoMain: () => void;
  /** Done: after adopting or removing, go back to the main screen. */
  onDone: () => void;
}) {
  const o = entry.meta.option!;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); onConfirm(null); onDone(); } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  // A code: the server reads old Vietnamese statuses as codes (lib/legacy-values.mjs).
  const adopted = o.status === "adopted";
  const mainTitle = main?.meta.title ?? o.of;
  return (
    <>
      <div data-option-bar={o.status} className={cn("px-3 md:px-4 py-2 border-b flex items-center gap-2 flex-wrap text-sm", adopted ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-amber-50 border-amber-200 text-amber-900")}>
        <GitBranch size={15} className="shrink-0" />
        <p className="flex-1 min-w-[200px]">
          {rich(T.optionBar({
            name: <b>{T.quoted(o.name)}</b>,
            rename: <button type="button" onClick={() => onConfirm("rename")} className="inline-flex align-text-bottom mx-1 p-0.5 rounded hover:bg-black/5" title={T.renameOption} aria-label={T.renameOption}><Pencil size={13} /></button>,
            main: <button type="button" onClick={onGoMain} className="underline font-medium">{mainTitle}</button>,
            status: optionStatusLabel(o.status),
          }))}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => onConfirm("remove")}>{T.removeOption}</Button>
          <Button variant="primary" onClick={() => onConfirm("adopt")}>{adopted ? T.adoptAgain : T.adoptThis}</Button>
        </div>
      </div>
      {confirm === "rename" && <RenameOptionDialog version={version} entry={entry} onClose={() => onConfirm(null)} />}
      {confirm === "adopt" && (
        <ConfirmDialog
          title={T.adoptTitle}
          confirmLabel={T.adopt}
          busy={busy}
          error={err}
          onCancel={() => onConfirm(null)}
          onConfirm={() => run(() => api.adoptOption({ v: version, entry: entry.id }))}
        >
          {rich(T.adoptBody(<b>{mainTitle}</b>))}
        </ConfirmDialog>
      )}
      {confirm === "remove" && (
        <ConfirmDialog
          title={T.removeTitle}
          confirmLabel={T.removeOption}
          tone="danger"
          busy={busy}
          error={err}
          onCancel={() => onConfirm(null)}
          onConfirm={() => run(() => api.removeOption({ v: version, entry: entry.id }))}
        >
          {rich(T.removeBody(<b>{mainTitle}</b>))}
        </ConfirmDialog>
      )}
    </>
  );
}
