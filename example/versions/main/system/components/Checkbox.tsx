import type { InputHTMLAttributes, ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "onChange"> & {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  /** Text next to the box; clicking it toggles the box too. */
  label?: ReactNode;
};

/** A real checkbox (keyboard, screen readers) drawn as a rounded box. */
export function Checkbox({ checked, onChange, label, disabled, className, ...props }: CheckboxProps) {
  return (
    // Box and first line of the label are both 20px tall (leading-5): they line up, and a two-line label keeps the
    // box on its first line. align-top: the same height whether or not the box shows its tick.
    <label className={cn("inline-flex items-start gap-2.5 align-top select-none", disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer", className)}>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          {...props}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.checked)}
          className="peer absolute inset-0 m-0 opacity-0 cursor-[inherit]"
        />
        <span
          aria-hidden
          className={cn(
            "w-5 h-5 rounded-md border inline-flex items-center justify-center transition-colors",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500/40",
            checked ? "bg-accent-700 border-accent-700 text-white" : "bg-surface border-ink-300",
          )}
        >
          {checked && <Check size={14} strokeWidth={3} />}
        </span>
      </span>
      {label != null && <span className="min-w-0 text-sm leading-5 text-ink-800">{label}</span>}
    </label>
  );
}
