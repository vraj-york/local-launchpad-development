import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MIN_PREVIEW_WIDTH = 320;
const MAX_PREVIEW_WIDTH = 1920;
/** Dark vertical strip (hit area), matches device-frame drag affordance. */
const DRAG_STRIP_W_PX = 14;

/**
 * Centered "device" column for iframe preview: measured stage width, smooth width transitions,
 * device-style border frame, and left/right edge drag handles.
 */
export function ClientLinkResponsivePreviewShell({
  widthPx,
  resizeHandleEnabled = true,
  onStageWidthChange,
  onWidthChangeFromDrag,
  children,
}) {
  const stageRef = useRef(null);
  const dragRef = useRef({
    active: false,
    startX: 0,
    startWidth: 0,
    pointerId: null,
    /** @type {'left' | 'right' | null} */
    edge: null,
  });
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w != null && w > 0) onStageWidthChange?.(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onStageWidthChange]);

  const clampWidth = useCallback((w, stageW) => {
    const cap = stageW > 0 ? Math.min(stageW, MAX_PREVIEW_WIDTH) : MAX_PREVIEW_WIDTH;
    return Math.round(
      Math.min(cap, Math.max(MIN_PREVIEW_WIDTH, w)),
    );
  }, []);

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    d.active = false;
    d.pointerId = null;
    d.edge = null;
    setIsDragging(false);
  }, []);

  const handleResizePointerDown = useCallback(
    (edge) => (e) => {
      if (!resizeHandleEnabled) return;
      e.preventDefault();
      e.stopPropagation();
      const stageEl = stageRef.current;
      const stageW = stageEl ? Math.floor(stageEl.getBoundingClientRect().width) : 0;
      const d = dragRef.current;
      d.active = true;
      d.startX = e.clientX;
      d.startWidth = widthPx;
      d.pointerId = e.pointerId;
      d.edge = edge;
      setIsDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      const onMove = (ev) => {
        if (!dragRef.current.active) return;
        const delta = ev.clientX - dragRef.current.startX;
        const sign = dragRef.current.edge === "right" ? 1 : -1;
        const next = clampWidth(
          dragRef.current.startWidth + sign * delta,
          stageW,
        );
        onWidthChangeFromDrag?.(next);
      };

      const onUp = (ev) => {
        if (dragRef.current.pointerId != null && ev.pointerId !== dragRef.current.pointerId) {
          return;
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          e.currentTarget.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        endDrag();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [
      clampWidth,
      endDrag,
      onWidthChangeFromDrag,
      resizeHandleEnabled,
      widthPx,
    ],
  );

  useEffect(() => {
    return () => endDrag();
  }, [endDrag]);

  const safeWidth = Math.max(MIN_PREVIEW_WIDTH, widthPx);
  const stripExtra =
    resizeHandleEnabled ? 2 * DRAG_STRIP_W_PX : 0;
  const rowWidthPx = safeWidth + stripExtra;

  const dragStrip = (side) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={
        side === "left"
          ? "Resize preview width from the left"
          : "Resize preview width from the right"
      }
      className="group flex h-full shrink-0 cursor-ew-resize touch-none select-none items-center justify-center"
      style={{ width: DRAG_STRIP_W_PX }}
      onPointerDown={handleResizePointerDown(side)}
    >
      <span
        className="h-20 w-[7px] shrink-0 rounded-full bg-[#888888] transition-colors group-hover:bg-[#9e9e9e]"
        aria-hidden
      />
    </div>
  );

  return (
    <div className="relative mt-0 flex min-h-0 flex-1 flex-col">
      <div
        ref={stageRef}
        className={cn(
          "relative flex min-h-0 flex-1 items-stretch justify-center overflow-auto p-6",
          "bg-linear-to-b from-slate-100/90 via-slate-50/80 to-violet-50/30",
        )}
      >
        <div
          className={cn(
            "relative flex h-full min-h-0 shrink-0 flex-row items-stretch",
            !isDragging && "transition-[width] duration-300 ease-out",
          )}
          style={{ width: rowWidthPx }}
        >
          {resizeHandleEnabled ? dragStrip("left") : null}
          <div
            className={cn(
              "relative h-full min-h-0 shrink-0 overflow-hidden rounded-[1.35rem]",
              "border-[6px] border-slate-700/85",
            )}
            style={{ width: safeWidth }}
          >
            {children}
          </div>
          {resizeHandleEnabled ? dragStrip("right") : null}
        </div>
      </div>
    </div>
  );
}