// The studio's Settings: the size of the desktop frames of this project (craft-table.json "desktop"). One size for everyone —
// it is what the board draws and what Claude looks at.
import { useState } from "react";
import { Check, X } from "lucide-react";
import { cn, useBackdropClose } from "../ui";
import { DESKTOP_LIMITS, DESKTOP_PRESETS, cleanDesktop } from "../lib/devices.mjs";
import { api } from "./api";
import { T } from "./i18n/shell";

type Size = { w: number; h: number };
const key = (s: Size) => `${s.w}x${s.h}`;

export function SettingsDialog({ desktop, onClose, onSaved }: { desktop: Size; onClose: () => void; onSaved: (s: Size) => void }) {
  const preset = DESKTOP_PRESETS.find((p) => p.w === desktop.w && p.h === desktop.h);
  const [choice, setChoice] = useState(preset ? key(preset) : "custom");
  const [w, setW] = useState(String(desktop.w));
  const [h, setH] = useState(String(desktop.h));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const picked: Size | null = choice === "custom" ? (cleanDesktop({ width: w, height: h }) as Size | null) : DESKTOP_PRESETS.find((p) => key(p) === choice) ?? null;
  const L = DESKTOP_LIMITS;
  const save = async () => {
    if (!picked) { setErr(T.desktopInvalid(L)); return; }
    setBusy(true); setErr("");
    try {
      const d = await api.setDesktop({ width: picked.w, height: picked.h });
      onSaved({ w: d.width, h: d.height });
      onClose();
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); }
  };
  const row = (id: string, label: string, sub?: string) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={choice === id}
      data-desktop-option={id}
      onClick={() => { setChoice(id); setErr(""); }}
      className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]", choice === id ? "bg-accent-50 text-accent-900 font-medium" : "text-ink-700 hover:bg-ink-50")}
    >
      <Check size={14} className={cn("shrink-0", choice !== id && "opacity-0")} />
      <span className="tabular-nums">{label}</span>
      {sub && <span className="text-[11px] text-ink-400">{sub}</span>}
    </button>
  );
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/40 p-4" {...useBackdropClose(onClose)}>
      <div role="dialog" aria-label={T.settings} data-settings className="w-full max-w-sm rounded-xl border border-ink-200 bg-surface shadow-xl">
        <div className="flex h-11 items-center gap-2 border-b border-ink-200 px-4">
          <p className="flex-1 text-[14px] font-semibold text-ink-900">{T.settings}</p>
          <button type="button" aria-label={T.closeSettings} onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-ink-500 hover:bg-ink-100"><X size={15} /></button>
        </div>
        <div className="space-y-2 p-4">
          <div>
            <p className="text-[13px] font-medium text-ink-900">{T.desktopSize}</p>
            <p className="text-[12px] text-ink-500">{T.desktopHint}</p>
          </div>
          <div role="radiogroup" aria-label={T.desktopSize} className="space-y-0.5">
            {DESKTOP_PRESETS.map((p) => row(key(p), `${p.w} × ${p.h}`, p.name))}
            {row("custom", T.desktopCustom)}
          </div>
          {choice === "custom" && (
            <div className="flex items-center gap-2 pl-8 text-[12px] text-ink-500">
              <label className="flex items-center gap-1">{T.desktopWidth}<input data-desktop-width inputMode="numeric" value={w} onChange={(e) => { setW(e.target.value); setErr(""); }} className="h-7 w-20 rounded-md border border-ink-200 bg-surface px-2 text-[13px] tabular-nums text-ink-900 outline-none focus:border-accent-500" /></label>
              <span>×</span>
              <label className="flex items-center gap-1">{T.desktopHeight}<input data-desktop-height inputMode="numeric" value={h} onChange={(e) => { setH(e.target.value); setErr(""); }} className="h-7 w-20 rounded-md border border-ink-200 bg-surface px-2 text-[13px] tabular-nums text-ink-900 outline-none focus:border-accent-500" /></label>
            </div>
          )}
          {err && <p data-settings-error className="text-[12px] text-rose-700">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-200 px-4 py-3">
          <button type="button" onClick={onClose} className="inline-flex h-8 items-center rounded-md border border-ink-200 px-3 text-[13px] font-medium text-ink-700 hover:bg-ink-50">{T.cancel}</button>
          <button type="button" data-settings-save disabled={busy} onClick={save} className="inline-flex h-8 items-center rounded-md bg-accent-700 px-3 text-[13px] font-medium text-white hover:bg-accent-800 disabled:opacity-50">{T.save}</button>
        </div>
      </div>
    </div>
  );
}
