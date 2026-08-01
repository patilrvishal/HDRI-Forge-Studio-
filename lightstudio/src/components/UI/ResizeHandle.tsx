import React, { useCallback, useRef } from 'react';

interface ResizeHandleProps {
  /** 'horizontal' = drag left/right, 'vertical' = drag up/down */
  direction: 'horizontal' | 'vertical';
  /** Called with the NEW absolute size (not delta) on each RAF tick */
  onResize: (newSize: number) => void;
  /** Called to get the current size at drag start */
  getCurrentSize: () => number;
  /** Minimum allowed size in px */
  minSize?: number;
  /** Maximum allowed size in px */
  maxSize?: number;
  /** Which side the panel is on — affects delta sign */
  side?: 'left' | 'right' | 'top' | 'bottom';
  /** Double-click resets to default size */
  onDoubleClick?: () => void;
}

/**
 * Smooth, flicker-free resize handle.
 * Uses requestAnimationFrame to batch DOM writes.
 * Reports absolute size (not delta) to avoid accumulated rounding errors.
 */
export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  direction,
  onResize,
  getCurrentSize,
  minSize = 100,
  maxSize = 800,
  side = 'left',
  onDoubleClick,
}) => {
  const isDragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);
  const rafId = useRef(0);
  const lastReportedSize = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = true;
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
      startSize.current = getCurrentSize();
      lastReportedSize.current = startSize.current;

      document.body.style.userSelect = 'none';
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;

        // Use RAF for smooth rendering — no flicker
        cancelAnimationFrame(rafId.current);
        rafId.current = requestAnimationFrame(() => {
          const currentPos = direction === 'horizontal' ? ev.clientX : ev.clientY;
          let delta = currentPos - startPos.current;

          // Flip delta for right/top panels
          if (side === 'right' || side === 'top') {
            delta = -delta;
          }

          const newSize = Math.max(minSize, Math.min(maxSize, startSize.current + delta));

          // Only report if actually changed (avoid unnecessary re-renders)
          if (Math.abs(newSize - lastReportedSize.current) >= 1) {
            lastReportedSize.current = newSize;
            onResize(newSize);
          }
        });
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        cancelAnimationFrame(rafId.current);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [direction, onResize, side, minSize, maxSize, getCurrentSize],
  );

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
      className="resize-handle-glow"
      style={{
        width: isHorizontal ? 4 : '100%',
        height: isHorizontal ? '100%' : 4,
        cursor: isHorizontal ? 'col-resize' : 'row-resize',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Grip dots — visible on hover via CSS */}
      <div
        style={{
          opacity: 0,
          transition: 'opacity 0.15s ease',
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: isHorizontal ? 'column' : 'row',
          gap: 3,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className="resize-grip-dots"
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: 'var(--accent)',
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      {/* Hover effect handled by parent hover — we need inline since no parent class */}
      <style>{`
        .resize-handle-glow:hover .resize-grip-dots { opacity: 1; }
      `}</style>
    </div>
  );
};