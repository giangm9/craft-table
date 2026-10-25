// The right panel (Conversation / History) on wide screens — drag its left edge to resize (lib/panel-width.mjs);
// each person's width is remembered. The handle captures the pointer so the board's iframe cannot steal the drag,
// as in the spec panel.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { cn } from "../ui";
import { PANEL_DEFAULT, clampPanelWidth, dragPanelWidth } from "../lib/panel-width.mjs";
import { T } from "./i18n/shell";

// host: the element holding the panel (main.tsx) — it is moved here, and into the floating window when the panel pops out.
export function PanelAside({ width, onWidth, host }: { width: number; onWidth: (w: number) => void; host: HTMLElement }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const s = slot.current; if (s && host.parentElement !== s) s.appendChild(host); }, [host]);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const shown = clampPanelWidth(live ?? width, innerWidth);
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: shown };
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => { if (drag.current) setLive(dragPanelWidth(drag.current.w, drag.current.x, e.clientX, innerWidth)); };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag.current) onWidth(dragPanelWidth(drag.current.w, drag.current.x, e.clientX, innerWidth));
    drag.current = null;
    setLive(null);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowLeft" ? 24 : e.key === "ArrowRight" ? -24 : 0;
    if (d) { e.preventDefault(); onWidth(clampPanelWidth(shown + d, innerWidth)); }
  };
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
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => onWidth(PANEL_DEFAULT)}
        onKeyDown={key}
        className={cn("absolute top-0 -left-1 w-2 h-full cursor-col-resize z-10 hover:bg-accent-500/25 focus-visible:bg-accent-500/25 outline-none", live != null && "bg-accent-500/35")}
      />
      <div ref={slot} className="flex-1 min-h-0 flex flex-col" />
    </aside>
  );
}
