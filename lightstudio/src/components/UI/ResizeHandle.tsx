import React, { useCallback, useRef } from 'react';

interface ResizeHandleProps {
  /** 'horizontal' = drag left/right (for left/right panels), 'vertical' = drag up/down (for bottom panel) */
  direction: 'horizontal' | 'vertical';
  /** Called with mouse delta (positive = drag right or down) */
  onResize: (delta: number) => void;
  /** Double-click resets to default size */
  onDoubleClick?: () => void;
  /** Side the panel is on — affects cursor direction */
  side?: 'left' | 'right' | 'top' | 'bottom';
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  direction,
  onResize,
  onDoubleClick,
  side = 'left',
}) => {
  const isDragging = useRef(false);
  const lastPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = true;
      lastPos.current = direction === 'horizontal' ? e.clientX : e.clientY;

      // Add visual feedback to body
      document.body.style.userSelect = 'none';
      document.body.style.cursor =
        direction === 'horizontal' ? 'col-resize' : 'row-resize';

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const currentPos = direction === 'horizontal' ? ev.clientX : ev.clientY;
        let delta = currentPos - lastPos.current;
        lastPos.current = currentPos;

        // Flip delta for right/top panels (dragging left shrinks, right grows)
        if (side === 'right' || side === 'top') {
          delta = -delta;
        }

        onResize(delta);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [direction, onResize, side],
  );

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
      style={{
        width: isHorizontal ? 4 : '100%',
        height: isHorizontal ? '100%' : 4,
        cursor: isHorizontal ? 'col-resize' : 'row-resize',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
        transition: 'background 0.15s',
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        if (!isDragging.current) {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }
      }}
    />
  );
};