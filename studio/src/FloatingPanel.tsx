// The conversation panel as a floating window over the board: drag its title bar to move it, its corner to resize it,
// the button to put it back in the side panel. The panel itself is NOT drawn here: it lives in a host element
// (main.tsx `host`) that is moved between this window and the side panel, so what is typed and the open thread survive.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { GripHorizontal, PanelRight } from "lucide-react";
import { FLOAT_MIN, clampFloatRect, dragFloatRect, resizeFloatRect } from "../lib/panel-float.mjs";
import { T } from "./i18n/shell";

export type FloatRect = { x: number; y: number; w: number; h: number };

export function FloatingPanel({ host, rect, onRect, onDock }: { host: HTMLElement; rect: FloatRect; onRect: (r: FloatRect) => void; onDock: () => void }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const s = slot.current; if (s && host.parentElement !== s) s.appendChild(host); }, [host]);
  const drag = useRef<{ kind: "move" | "size"; px: number; py: number; r: FloatRect } | null>(null);
  const [live, setLive] = useState<FloatRect | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  const shown = clampFloatRect(live ?? rect, innerWidth, innerHeight); // a smaller browser window pulls it back inside
  const start = (kind: "move" | "size") => (e: RPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, px: e.clientX, py: e.clientY, r: shown };
  };
  const next = (e: RPointerEvent<HTMLElement>) => {
    const d = drag.current!;
    const f = d.kind === "move" ? dragFloatRect : resizeFloatRect;
    return f(d.r, e.clientX - d.px, e.clientY - d.py, innerWidth, innerHeight) as FloatRect;
  };
  const move = (e: RPointerEvent<HTMLElement>) => { if (drag.current) setLive(next(e)); };
  const end = (e: RPointerEvent<HTMLElement>) => {
    if (drag.current) onRect(next(e));
    drag.current = null;
    setLive(null);
  };
  return (
    <div
      data-panel
      data-float-panel
      style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h, minWidth: FLOAT_MIN.w, minHeight: FLOAT_MIN.h }}
      className="hidden lg:flex fixed z-40 flex-col rounded-xl border border-ink-300 bg-surface shadow-2xl overflow-hidden"
    >
      <div
        data-float-handle
        title={T.floatMoveHint}
        onPointerDown={start("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="shrink-0 h-7 px-1.5 flex items-center gap-1 bg-ink-50 border-b border-ink-200 cursor-grab active:cursor-grabbing select-none touch-none"
      >
        <GripHorizontal size={15} className="text-ink-400" />
        <span className="flex-1 min-w-0 truncate text-[11px] font-medium text-ink-500">{T.conversation}</span>
        <button type="button" data-panel-dock aria-label={T.dockPanel} title={T.dockPanel} onClick={onDock} className="p-1 rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-900 cursor-pointer">
          <PanelRight size={14} />
        </button>
      </div>
      <div ref={slot} className="flex-1 min-h-0 flex flex-col" />
      <div
        data-float-resize
        role="separator"
        aria-label={T.floatResizeHint}
        title={T.floatResizeHint}
        onPointerDown={start("size")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize touch-none z-10 before:absolute before:right-1 before:bottom-1 before:w-2 before:h-2 before:border-r-2 before:border-b-2 before:border-ink-400"
      />
    </div>
  );
}
