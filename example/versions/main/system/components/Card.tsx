import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type CardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** Heading in the card's top bar. */
  title?: ReactNode;
  /** Small actions on the right of the top bar (buttons, a badge). */
  actions?: ReactNode;
};

/** A raised plane: border, no shadow. Lists inside a card use divide-y rows that touch each other. */
export function Card({ title, actions, className, children, ...props }: CardProps) {
  return (
    <section {...props} className={cn("bg-surface border border-ink-200 rounded-xl", className)}>
      {(title != null || actions != null) && (
        <header className="flex items-center gap-3 px-4 py-3 border-b border-ink-100">
          {title != null && <h2 className="flex-1 min-w-0 text-sm font-semibold text-ink-900 truncate">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
