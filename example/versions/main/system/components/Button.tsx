import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent-700 border-accent-700 text-white hover:bg-accent-800 hover:border-accent-800",
  secondary: "bg-surface border-ink-200 text-ink-800 hover:bg-ink-50",
  ghost: "bg-transparent border-transparent text-ink-700 hover:bg-ink-100",
  danger: "bg-surface border-danger-200 text-danger-700 hover:bg-danger-50",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 gap-1.5 text-sm",
  md: "h-10 px-4 gap-2 text-sm",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon before the label (lucide-react, size 16). */
  icon?: ReactNode;
};

/** One button for every action: primary (one per screen), secondary, ghost (toolbars), danger (delete). */
export function Button({ variant = "primary", size = "md", icon, type = "button", className, children, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg border font-medium whitespace-nowrap transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 disabled:opacity-50 disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
