// craft-table UI kit: confirm dialog, load error, segmented control, inline notice.
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, RotateCw, XCircle } from "lucide-react";
import { cn } from "./cn";
import { Button, Field, Modal } from "./proposed";
import { T } from "../src/i18n/ui";

// ── Ask again before something hard to undo ─────────────────────────────────
// Replaces window.confirm: the title says WHAT will happen, the body says the CONSEQUENCE, and the main button names
// the action ("Delete image", not "OK"). `reason` = a reason box (optional or required, e.g. why a version is
// archived). While busy → the buttons dim, no double clicks.
// cancelLabel / busyLabel: the Cancel button and the busy text (defaults in the viewer's language, i18n/ui.ts).
export function ConfirmDialog({
  title, children, confirmLabel, tone = "primary", reason, busy, error, onConfirm, onCancel, inline, cancelLabel, busyLabel,
}: {
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  reason?: { label: string; required?: boolean; placeholder?: string };
  busy?: boolean;
  error?: ReactNode;
  onConfirm?: (reason: string) => void;
  onCancel?: () => void;
  inline?: boolean;
  cancelLabel?: string;
  busyLabel?: string;
}) {
  const [text, setText] = useState("");
  const blocked = busy || (reason?.required && !text.trim());
  return (
    <Modal
      inline={inline}
      size="sm"
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>{cancelLabel ?? T.cancel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} disabled={!!blocked} onClick={() => onConfirm?.(text.trim())}>
            {busy ? busyLabel ?? T.working : confirmLabel}
          </Button>
        </>
      }
    >
      {children && <div className="text-sm text-ink-700 space-y-2">{children}</div>}
      {reason && (
        <Field label={reason.label} required={reason.required}>
          <textarea className="input resize-y" rows={3} value={text} placeholder={reason.placeholder} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </Modal>
  );
}

// ── Load error: NOT the same as "no data yet" ───────────────────────────────
// A common bug: a screen treats a network error as an empty list ("Nothing here yet", "0 items") or spins
// "Loading…" forever. This pattern says plainly that loading
// FAILED, keeps the reference code (e.g. a request id the server returned) and offers Try again.
// title: the whole heading; without it, `what` names the data in the default heading ("Couldn't load <what>").
export function LoadError({ what, title, detail, code, onRetry, retrying }: {
  what?: string; title?: ReactNode; detail?: ReactNode; code?: string; onRetry?: () => void; retrying?: boolean;
}) {
  return (
    <div role="alert" className="border border-rose-200 bg-rose-50/60 rounded-xl px-4 py-6 text-center">
      <XCircle size={22} className="mx-auto text-rose-600" />
      <p className="mt-2 font-medium text-ink-900">{title ?? T.loadFailed(what)}</p>
      <p className="mt-1 text-sm text-ink-600">{detail ?? T.loadFailedDetail}</p>
      {code && <p className="mt-1 text-xs text-ink-500">{T.referenceCode} <span className="font-mono">{code}</span></p>}
      {onRetry && (
        <Button className="mt-3" onClick={onRetry} disabled={retrying}>
          <RotateCw size={14} className={cn(retrying && "animate-spin")} /> {retrying ? T.retrying : T.retry}
        </Button>
      )}
    </div>
  );
}

// ── Segmented switch of 2–4 choices (Write / Phone / Print, Month / Week) ────
export function SegmentedControl<K extends string>({ value, onChange, options, ariaLabel }: {
  value: K; onChange?: (k: K) => void; options: Array<{ key: K; label: ReactNode }>; ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex p-0.5 bg-ink-100 border border-ink-200 rounded-lg">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={o.key === value}
          onClick={() => onChange?.(o.key)}
          className={cn(
            "px-3 py-1.5 text-sm rounded-md transition-colors",
            o.key === value ? "bg-surface border border-ink-200 text-ink-900 font-medium" : "border border-transparent text-ink-600 hover:text-ink-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Small notice strip inside a card ────────────────────────────────────────
const NOTICE = {
  info: { cls: "bg-sky-50 border-sky-200 text-sky-900", Icon: Info },
  warning: { cls: "bg-amber-50 border-amber-200 text-amber-900", Icon: AlertTriangle },
  error: { cls: "bg-rose-50 border-rose-200 text-rose-900", Icon: XCircle },
  success: { cls: "bg-emerald-50 border-emerald-200 text-emerald-900", Icon: CheckCircle2 },
} as const;
export function InlineNotice({ tone = "info", children, action }: { tone?: keyof typeof NOTICE; children: ReactNode; action?: ReactNode }) {
  const { cls, Icon } = NOTICE[tone];
  return (
    <div className={cn("flex items-start gap-2 px-3 py-2 rounded-lg border text-sm", cls)}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">{children}</div>
      {action}
    </div>
  );
}
