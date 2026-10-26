// A panel edge you drag to resize: the right-hand panel (its left edge) and the board list (its right edge). The handle
// captures the pointer so the board's iframe cannot steal the drag; the arrow keys step 24 px; a double-click goes back to
// the default. The width is the caller's (remembered per person); while dragging, `shown` follows the pointer.
import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";

export function useResize({ width, onWidth, edge, clamp, def }: {
  width: number;
  onWidth: (w: number) => void;
  /** where the handle sits: "left" = a panel on the right of the screen (moving left widens it), "right" = one on the left */
  edge: "left" | "right";
  clamp: (w: number) => number;
  def: number;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const shown = clamp(live ?? width);
  const at = (x: number) => clamp(drag.current!.w + (edge === "left" ? drag.current!.x - x : x - drag.current!.x));
  const handle = {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, w: shown };
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => { if (drag.current) setLive(at(e.clientX)); },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      if (drag.current) onWidth(at(e.clientX));
      drag.current = null;
      setLive(null);
    },
    onPointerCancel: () => { drag.current = null; setLive(null); },
    onDoubleClick: () => onWidth(def),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const wider = edge === "left" ? "ArrowLeft" : "ArrowRight", narrower = edge === "left" ? "ArrowRight" : "ArrowLeft";
      const d = e.key === wider ? 24 : e.key === narrower ? -24 : 0;
      if (d) { e.preventDefault(); onWidth(clamp(shown + d)); }
    },
  };
  return { shown, dragging: live != null, handle };
}
