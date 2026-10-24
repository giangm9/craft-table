import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-ink-100 border-ink-200 text-ink-700",
  accent: "bg-accent-50 border-accent-200 text-accent-600",
  success: "bg-success-50 border-success-200 text-success-700",
  warning: "bg-warning-50 border-warning-200 text-warning-700",
  danger: "bg-danger-50 border-danger-200 text-danger-700",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone };

/** A short label: a status, a due date, a count. One meaning per tone — never warning for an error. */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full border text-xs font-medium whitespace-nowrap", TONE[tone], className)}
    />
  );
}
