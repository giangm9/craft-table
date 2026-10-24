import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: ReactNode;
  /** Help under the field; replaced by `error` when there is one. */
  hint?: ReactNode;
  error?: ReactNode;
  /** Icon inside the field, on the left (lucide-react, size 16). */
  icon?: ReactNode;
};

/** A one-line text input with its label, help and error. */
export function TextField({ label, hint, error, icon, id, className, ...props }: TextFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const note = error ?? hint;
  return (
    <div className={cn("space-y-1.5", className)}>
      {label != null && <label htmlFor={fieldId} className="block text-sm font-medium text-ink-800">{label}</label>}
      <div className="relative">
        {icon != null && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none">{icon}</span>}
        <input
          id={fieldId}
          {...props}
          aria-invalid={error ? true : undefined}
          aria-describedby={note != null ? `${fieldId}-note` : undefined}
          className={cn(
            "w-full h-10 rounded-lg border bg-surface text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-colors",
            "focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 disabled:opacity-60",
            icon != null ? "pl-9 pr-3" : "px-3",
            error ? "border-danger-700" : "border-ink-200",
          )}
        />
      </div>
      {note != null && <p id={`${fieldId}-note`} className={cn("text-xs", error ? "text-danger-700" : "text-ink-500")}>{note}</p>}
    </div>
  );
}
