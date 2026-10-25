// craft-table UI kit: buttons, form field, dialog.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check, Search, X } from "lucide-react";
import { cn } from "./cn";
import { T } from "../src/i18n/ui";

// ── Buttons ─────────────────────────────────────────────────────────────────
// Every variant has a 1px border (primary/danger in the fill colour, ghost transparent) → same height, so switching
// variants never makes a row of buttons jump 2px.
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 border font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 rounded-md text-[12px]",
  md: "h-8 px-3 rounded-md text-[13px]",
};
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent-700 border-accent-700 text-white hover:bg-accent-800 hover:border-accent-800",
  secondary: "bg-surface border-ink-200 text-ink-700 hover:bg-ink-50",
  ghost: "border-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger: "bg-rose-600 border-rose-600 text-white hover:bg-rose-700 hover:border-rose-700",
};
export const buttonClass = (variant: ButtonVariant = "secondary", size: ButtonSize = "sm", className?: string) =>
  cn(BTN_BASE, BTN_SIZE[size], BTN_VARIANT[variant], className);

export function Button({
  variant = "secondary", size = "sm", icon, className, children, type = "button", ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }) {
  return (
    <button type={type} {...props} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </button>
  );
}

/** Icon-only button: a label (aria-label) is REQUIRED for screen readers. */
export function IconButton({
  label, children, className, type = "button", ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      {...props}
      className={cn("inline-grid h-7 w-7 place-items-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-900 outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40", className)}
    >
      {children}
    </button>
  );
}

// ── Form field ──────────────────────────────────────────────────────────────
export function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-700 mb-1">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-[11px] text-ink-500 mt-1">{hint}</span>}
      {error && <span className="block text-xs text-rose-600 mt-1">{error}</span>}
    </label>
  );
}

// ── Dialog ──────────────────────────────────────────────────────────────────
// Phone (< md): a bottom sheet; desktop: centred. Bordered (flat design system).
// In an app: opened through the URL (?modal=…), closed with Esc + a backdrop click via useBackdropClose.
// `inline` is only for documentation pages, to show a dialog in place without covering the screen.
// closeLabel: the close button's label (default "Close", in the viewer's language).
export function Modal({
  title, onClose, footer, size = "md", inline, closeLabel, children,
}: { title: ReactNode; onClose?: () => void; footer?: ReactNode; size?: "sm" | "md" | "lg"; inline?: boolean; closeLabel?: string; children: ReactNode }) {
  const w = { sm: "md:max-w-sm", md: "md:max-w-md", lg: "md:max-w-lg" }[size];
  return (
    <div className={cn(
      inline ? "relative flex items-end md:items-center justify-center md:p-6 bg-ink-900/40 rounded-xl min-h-[320px]"
        : "fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4 bg-ink-900/40",
    )}>
      <div className={cn("bg-surface border border-ink-200 w-full max-h-[90vh] flex flex-col rounded-t-xl md:rounded-xl", w)}>
        <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between gap-2">
          <p className="font-semibold text-ink-900 truncate">{title}</p>
          <IconButton label={closeLabel ?? T.close} onClick={onClose}><X size={18} /></IconButton>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-ink-100 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
