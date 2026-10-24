import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** A surface with a border that groups related content. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-ink-200 bg-surface p-5", className)} {...props} />;
}
