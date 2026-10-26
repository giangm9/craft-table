// The right panel (Conversation / History) on wide screens — drag its left edge to resize (lib/panel-width.mjs,
// useResize.ts); each person's width is remembered.
import { useLayoutEffect, useRef } from "react";
import { cn } from "../ui";
import { PANEL_DEFAULT, clampPanelWidth } from "../lib/panel-width.mjs";
import { useResize } from "./useResize";
import { T } from "./i18n/shell";

// host: the element holding the panel (main.tsx) — it is moved here, and into the floating window when the panel pops out.
export function PanelAside({ width, onWidth, host }: { width: number; onWidth: (w: number) => void; host: HTMLElement }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const s = slot.current; if (s && host.parentElement !== s) s.appendChild(host); }, [host]);
  const { shown, dragging, handle } = useResize({ width, onWidth, edge: "left", clamp: (w) => clampPanelWidth(w, innerWidth), def: PANEL_DEFAULT });
  return (
    <aside data-panel style={{ width: shown }} className="hidden lg:flex shrink-0 border-l border-ink-200 bg-surface flex-col min-h-0 relative">
      <div
        data-panel-resize
        role="separator"
        aria-orientation="vertical"
        aria-label={T.panelResizeLabel}
        aria-valuenow={shown}
        tabIndex={0}
        title={T.panelResizeHint}
        {...handle}
        className={cn("absolute top-0 -left-1 w-2 h-full cursor-col-resize z-10 hover:bg-accent-500/25 focus-visible:bg-accent-500/25 outline-none", dragging && "bg-accent-500/35")}
      />
      <div ref={slot} className="flex-1 min-h-0 flex flex-col" />
    </aside>
  );
}
