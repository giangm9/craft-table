import { useRef, type MouseEvent as ReactMouseEvent } from "react";

// "Click outside to close" for a backdrop that does NOT close by mistake when someone selects text inside the dialog
// and releases the mouse over the backdrop. Why it happened: `click` fires on the common ancestor of mousedown and
// mouseup, so dragging from inside (an input, an editor) and releasing on the backdrop still clicks the backdrop →
// closes. Close only when BOTH the mousedown AND the click land on the backdrop element itself.
// Use: `<div className="fixed inset-0 …" {...useBackdropClose(onClose)}>` (instead of `onClick={onClose}` on it).
export function useBackdropClose(onClose: () => void) {
  const downOnBackdrop = useRef(false);
  return {
    onMouseDown: (e: ReactMouseEvent) => {
      downOnBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e: ReactMouseEvent) => {
      if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
    },
  };
}
