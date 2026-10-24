// craft-table UI kit: list, row, select, badge.
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./cn";

// ── JOINED list ─────────────────────────────────────────────────────────────
// One bordered box around, rows joined by dividers (divide-y): NO gap between rows, NO shadow or border per row.
// Replaces the old "each item is a separate Card with a gap" pattern. Use: <List><Row/><Row/></List>.
export function List({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "bg-surface border border-ink-200 rounded-xl overflow-hidden divide-y divide-ink-100",
        className,
      )}
    >
      {children}
    </div>
  );
}

// One row of a List. `interactive` adds a hover background + pointer cursor (for a clickable row / a <Link> /
// <button>). Default px-4 py-3, flex, vertically centred.
export function Row({
  className,
  interactive,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      {...props}
      className={cn(
        "px-4 py-3 flex items-center gap-3",
        interactive && "hover:bg-ink-50 transition-colors cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Filters / pickers ───────────────────────────────────────────────────────
// RULE (design system): filters and groupings are NEVER laid out inline (a row of chips, a flex-wrap cluster, a
// column of checkboxes) that forces scrolling: always one compact dropdown in the toolbar, ONE dropdown per filter.
//   · Pick one (exclusive): <Select> (native <select>).
//   · Pick several: <FilterMenu> (a button opening a checkbox popover with counts).

type Opt<T extends string> = { value: T; label: string; count?: number };

// Pick one: a native <select> with a chevron and the design system's style.
export function Select<T extends string>({
  value, onChange, options, className, ariaLabel, disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<Opt<T>>;
  className?: string;
  ariaLabel?: string;
  // Locks the dropdown, e.g. while a pending confirmation is awaited.
  disabled?: boolean;
}) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        className="appearance-none w-full pl-3 pr-8 py-1.5 text-sm bg-surface border border-ink-200 rounded-lg outline-none focus:border-accent-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}{o.count != null ? ` (${o.count})` : ""}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
    </div>
  );
}

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}
