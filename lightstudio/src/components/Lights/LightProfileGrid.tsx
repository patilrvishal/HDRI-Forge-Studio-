import React, { useRef, useEffect, useCallback } from 'react';
import type { LightType } from '../../types/Light';

interface LightProfileGridProps {
  lights: Array<{ id: string; type: string; color: string; name: string }>;
  selectedLightId: string | null;
  onSelectLight: (id: string) => void;
}

// --- Canvas thumbnail renderer ---

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function renderLightThumb(canvas: HTMLCanvasElement, type: string, color: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const S = 48; // canvas size
  const cx = S / 2;
  const cy = S / 2;

  // Clear with dark background
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, S, S);

  switch (type as LightType) {
    case 'point':
      drawPoint(ctx, cx, cy, S, color);
      break;
    case 'spot':
      drawSpot(ctx, cx, cy, S, color);
      break;
    case 'area':
      drawArea(ctx, cx, cy, S, color);
      break;
    case 'directional':
      drawDirectional(ctx, cx, cy, S, color);
      break;
    case 'overhead':
      drawOverhead(ctx, cx, cy, S, color);
      break;
    case 'underlight':
      drawUnderlight(ctx, cx, cy, S, color);
      break;
    case 'rim':
      drawRim(ctx, cx, cy, S, color);
      break;
    case 'ies':
      drawIES(ctx, cx, cy, S, color);
      break;
    default:
      drawPoint(ctx, cx, cy, S, color);
  }
}

/* ---- Individual light renderers ---- */

function drawPoint(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, color: string) {
  const r = Math.max(1, S * 0.42);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, hexToRgba(color, 1));
  grad.addColorStop(0.35, hexToRgba(color, 0.6));
  grad.addColorStop(0.7, hexToRgba(color, 0.15));
  grad.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpot(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, color: string) {
  // Cone shape: narrow at top, wide at bottom
  const topHalf = 4;
  const bottomHalf = 16;
  const topY = 4;
  const bottomY = 42;

  ctx.beginPath();
  ctx.moveTo(cx - topHalf, topY);
  ctx.lineTo(cx + topHalf, topY);
  ctx.lineTo(cx + bottomHalf, bottomY);
  ctx.lineTo(cx - bottomHalf, bottomY);
  ctx.closePath();

  const grad = ctx.createLinearGradient(cx, topY, cx, bottomY);
  grad.addColorStop(0, hexToRgba(color, 0.95));
  grad.addColorStop(0.4, hexToRgba(color, 0.55));
  grad.addColorStop(0.8, hexToRgba(color, 0.12));
  grad.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = grad;
  ctx.fill();

  // Bright source dot at top
  const dotGrad = ctx.createRadialGradient(cx, topY + 2, 0, cx, topY + 2, 5);
  dotGrad.addColorStop(0, hexToRgba(color, 1));
  dotGrad.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = dotGrad;
  ctx.beginPath();
  ctx.arc(cx, topY + 2, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawArea(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, color: string) {
  const w = 32;
  const h = 20;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const r = 4;

  // Rounded rectangle path
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();

  // Soft gradient fill
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, w * 0.6));
  grad.addColorStop(0, hexToRgba(color, 0.85));
  grad.addColorStop(0.7, hexToRgba(color, 0.45));
  grad.addColorStop(1, hexToRgba(color, 0.08));
  ctx.fillStyle = grad;
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = hexToRgba(color, 0.35);
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawDirectional(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, color: string) {
  const arrowCount = 4;
  const spacing = 9;
  const startX = cx - (spacing * (arrowCount - 1)) / 2;
  const arrowTop = 6;
  const arrowBottom = 40;
  const headSize = 3.5;

  ctx.strokeStyle = hexToRgba(color, 0.7);
  ctx.fillStyle = hexToRgba(color, 0.7);
  ctx.lineWidth = 1.5;

  for (let i = 0; i < arrowCount; i++) {
    const x = startX + i * spacing;

    // Shaft
    ctx.beginPath();
    ctx.moveTo(x, arrowTop);
    ctx.lineTo(x, arrowBottom - headSize);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(x, arrowBottom);
    ctx.lineTo(x - headSize, arrowBottom - headSize * 1.6);
    ctx.lineTo(x + headSize, arrowBottom - headSize * 1.6);
    ctx.closePath();
    ctx.fill();
  }

  // Faint glow behind arrows
  const glow = ctx.createLinearGradient(cx, arrowTop - 2, cx, arrowBottom + 2);
  glow.addColorStop(0, hexToRgba(color, 0.0));
  glow.addColorStop(0.3, hexToRgba(color, 0.06));
  glow.addColorStop(0.7, hexToRgba(color, 0.06));
  glow.addColorStop(1, hexToRgba(color, 0.0));
  ctx.fillStyle = glow;
  ctx.fillRect(startX - 5, arrowTop - 2, spacing * (arrowCount - 1) + 10, arrowBottom - arrowTop + 4);
}

function drawOverhead(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, color: string) {
  const w = 38;
  const h = 8;
  const x = cx - w / 2;
  const y = 6;

  // Main bar
  const grad = ctx.createLinearGradient(cx, y, cx, y + h);
  grad.addColorStop(0, hexToRgba(color, 0.9));
  grad.addColorStop(1, hexToRgba(color, 0.3));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 2);
  ctx.fill();

  // Downward light spill
  const spillGrad = ctx.createLinearGradient(cx, y + h, cx, 42);
  spillGrad.addColorStop(0, hexToRgba(color, 0.25));
  spillGrad.addColorStop(0.5, hexToRgba(color, 0.07));
  spillGrad.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = spillGrad;

  ctx.beginPath();
  ctx.moveTo(x + 2, y + h);
  ctx.lineTo(x + w - 2, y + h);
  ctx.lineTo(cx + w * 0.42, 42);
  ctx.lineTo(cx - w * 0.42, 42);
  ctx.closePath();
  ctx.fill();
}

function drawUnderlight(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, color: string) {
  // Inverted glow from bottom
  const sourceY = 44;

  // Source bar at bottom
  const barW = 34;
  const barH = 5;
  const barX = cx - barW / 2;
  ctx.fillStyle = hexToRgba(color, 0.85);
  ctx.beginPath();
  ctx.roundRect(barX, sourceY - barH, barW, barH, 2);
  ctx.fill();

  // Upward glow
  const grad = ctx.createLinearGradient(cx, sourceY, cx, 6);
  grad.addColorStop(0, hexToRgba(color, 0.35));
  grad.addColorStop(0.3, hexToRgba(color, 0.1));
  grad.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(barX + 2, sourceY - barH);
  ctx.lineTo(barX + barW - 2, sourceY - barH);
  ctx.lineTo(cx + barW * 0.38, 6);
  ctx.lineTo(cx - barW * 0.38, 6);
  ctx.closePath();
  ctx.fill();
}

function drawRim(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, color: string) {
  // Crescent / arc on the right side
  const outerR = 20;
  const innerR = 14;

  // Outer arc
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, outerR), -Math.PI * 0.45, Math.PI * 0.45, false);
  ctx.arc(cx, cy, Math.max(1, innerR), Math.PI * 0.45, -Math.PI * 0.45, true);
  ctx.closePath();

  const grad = ctx.createRadialGradient(cx + outerR * 0.3, cy, Math.max(1, innerR * 0.8), cx, cy, Math.max(1, outerR));
  grad.addColorStop(0, hexToRgba(color, 0.15));
  grad.addColorStop(0.6, hexToRgba(color, 0.55));
  grad.addColorStop(1, hexToRgba(color, 0.9));
  ctx.fillStyle = grad;
  ctx.fill();

  // Bright edge highlight
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, outerR), -Math.PI * 0.35, Math.PI * 0.35, false);
  ctx.strokeStyle = hexToRgba(color, 0.9);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawIES(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, color: string) {
  // Multiple radial lobes (teardrop shapes)
  const lobeCount = 6;
  const lobeLength = 18;
  const lobeWidth = Math.PI * 0.12;

  // Background radial glow
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, lobeLength * 0.6));
  bgGrad.addColorStop(0, hexToRgba(color, 0.3));
  bgGrad.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, lobeLength * 0.6), 0, Math.PI * 2);
  ctx.fill();

  // Draw lobes
  for (let i = 0; i < lobeCount; i++) {
    const angle = (i / lobeCount) * Math.PI * 2 - Math.PI / 2;
    const length = lobeLength * (0.7 + Math.sin(i * 2.3 + 1.1) * 0.3); // Vary lengths for realism

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Teardrop shape
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(
      length * 0.3, -lobeWidth * length,
      length * 0.8, -lobeWidth * length * 0.4,
      length, 0
    );
    ctx.bezierCurveTo(
      length * 0.8, lobeWidth * length * 0.4,
      length * 0.3, lobeWidth * length,
      0, 0
    );

    const lobeGrad = ctx.createLinearGradient(0, 0, length, 0);
    lobeGrad.addColorStop(0, hexToRgba(color, 0.8));
    lobeGrad.addColorStop(0.5, hexToRgba(color, 0.35));
    lobeGrad.addColorStop(1, hexToRgba(color, 0.05));
    ctx.fillStyle = lobeGrad;
    ctx.fill();

    ctx.restore();
  }

  // Center dot
  const centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 3);
  centerGrad.addColorStop(0, hexToRgba(color, 1));
  centerGrad.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = centerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
}

// --- Component ---

export const LightProfileGrid: React.FC<LightProfileGridProps> = ({
  lights,
  selectedLightId,
  onSelectLight,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  // Track previously rendered data to avoid redundant redraws
  const renderedData = useRef<Map<string, { type: string; color: string }>>(new Map());

  // Stable callback
  const stableSelect = useCallback((id: string) => {
    onSelectLight(id);
  }, [onSelectLight]);

  // Render canvases when light data changes
  useEffect(() => {
    lights.forEach((light) => {
      const prev = renderedData.current.get(light.id);
      if (prev && prev.type === light.type && prev.color === light.color) {
        return; // No change, skip re-render
      }

      const canvas = canvasRefs.current.get(light.id);
      if (canvas) {
        renderLightThumb(canvas, light.type, light.color);
        renderedData.current.set(light.id, { type: light.type, color: light.color });
      }
    });

    // Clean up refs for lights that were removed
    const currentIds = new Set(lights.map((l) => l.id));
    for (const [id] of renderedData.current) {
      if (!currentIds.has(id)) {
        renderedData.current.delete(id);
        canvasRefs.current.delete(id);
      }
    }
  }, [lights]);

  // Cleanup refs on unmount
  useEffect(() => {
    return () => {
      canvasRefs.current.clear();
      renderedData.current.clear();
    };
  }, []);

  const setCanvasRef = useCallback((id: string) => (el: HTMLCanvasElement | null) => {
    if (el) {
      canvasRefs.current.set(id, el);
    } else {
      canvasRefs.current.delete(id);
    }
  }, []);

  return (
    <div ref={containerRef} style={gridStyle}>
      {lights.map((light) => {
        const isSelected = light.id === selectedLightId;

        return (
          <div
            key={light.id}
            onClick={() => stableSelect(light.id)}
            style={{
              ...thumbWrapperStyle,
              ...(isSelected ? selectedThumbStyle : {}),
            }}
            onMouseEnter={(e) => {
              if (!isSelected) {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent-dim)';
                (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
                (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)';
              }
            }}
          >
            <canvas
              ref={setCanvasRef(light.id)}
              width={48}
              height={48}
              style={canvasStyle}
            />
            <span style={labelStyle}>{light.name}</span>
          </div>
        );
      })}
    </div>
  );
};

// --- Styles ---

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
  gap: '8px',
  padding: '8px',
};

const thumbWrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '5px',
  padding: '6px',
  borderRadius: '8px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  cursor: 'pointer',
  transition: 'border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease',
  userSelect: 'none',
  background: 'var(--bg-card)',
};

const selectedThumbStyle: React.CSSProperties = {
  borderColor: 'var(--accent)',
  background: 'var(--accent-bg)',
  boxShadow: '0 0 0 1px var(--accent-dim), 0 0 14px rgba(34, 211, 238, 0.22)',
};

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: 'auto',
  aspectRatio: '1 / 1',
  borderRadius: '6px',
  display: 'block',
  background: '#0d0d0f',
};

const labelStyle: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 500,
  color: 'var(--text-sec)',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
  lineHeight: '1.2',
};

export default LightProfileGrid;