import React, { useRef, useEffect, useCallback } from 'react';
import { useLightsStore } from '../../store/lightsStore';
import type { Light } from '../../types/Light';
import { hexToRgb } from '../../utils/colorConversion';

/** Convert hex color to rgba string for canvas */
function hexToRgba(hex: string, alpha: number): string {
  try {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  } catch {
    return `rgba(255,255,255,${alpha})`;
  }
}

export const LightPreview: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const selectedLightId = useLightsStore((s) => s.selectedLightId);
  const lights = useLightsStore((s) => s.lights);

  const light = lights.find((l) => l.id === selectedLightId) ?? null;

  const draw = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      // Clear
      ctx.fillStyle = '#0a0a12';
      ctx.fillRect(0, 0, w, h);

      // Draw grid
      ctx.strokeStyle = '#1a1a28';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < w; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Draw animated time-stamp bar at bottom
      const timeSec = (timestamp / 1000) % 10;
      const timeFrac = timeSec / 10;
      drawTimeBar(ctx, w, h, timeFrac);

      if (!light) {
        // No light selected — show placeholder
        ctx.fillStyle = '#5a5a72';
        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No light selected', w / 2, h / 2);
        return;
      }

      drawLightVisualization(ctx, light, w, h, timestamp);
    },
    [light],
  );

  useEffect(() => {
    const animate = (t: number) => {
      draw(t);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [draw]);

  // Handle resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = canvas.parentElement;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          canvas.width = Math.round(width * Math.min(window.devicePixelRatio, 2));
          canvas.height = Math.round(height * Math.min(window.devicePixelRatio, 2));
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        borderRadius: 'var(--radius-sm)',
      }}
    />
  );
};

// ── Drawing helpers ──────────────────────────────────────────────────────────

function drawTimeBar(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frac: number,
): void {
  const barY = h - 22;
  const barH = 14;
  const barX = 40;
  const barW = w - 80;

  // Track background
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0, 'rgba(74,158,255,0.15)');
  grad.addColorStop(1, 'rgba(139,92,246,0.15)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, 3);
  ctx.fill();

  // Progress fill
  const fillGrad = ctx.createLinearGradient(barX, 0, barX + barW * frac, 0);
  fillGrad.addColorStop(0, 'rgba(74,158,255,0.4)');
  fillGrad.addColorStop(1, 'rgba(139,92,246,0.4)');
  ctx.fillStyle = fillGrad;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW * frac, barH, 3);
  ctx.fill();

  // Tick marks
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 10; i++) {
    const tx = barX + (barW * i) / 10;
    ctx.beginPath();
    ctx.moveTo(tx, barY);
    ctx.lineTo(tx, barY + barH);
    ctx.stroke();
  }
}

function drawLightVisualization(
  ctx: CanvasRenderingContext2D,
  ld: Light,
  w: number,
  h: number,
  _timestamp: number,
): void {
  const cx = w / 2;
  const cy = h / 2 - 15;

  // Draw falloff / glow based on light type
  if (ld.type === 'point' || ld.type === 'spot' || ld.type === 'underlight' || ld.type === 'ies') {
    const radius =
      ld.falloff === 'none' ? 120 : ld.falloff === 'linear' ? 90 : 70;

    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glowGrad.addColorStop(0, hexToRgba(ld.color, 0.5));
    glowGrad.addColorStop(0.4, hexToRgba(ld.color, 0.15));
    glowGrad.addColorStop(1, hexToRgba(ld.color, 0));
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Area light rectangle
  if (ld.type === 'area' || ld.type === 'overhead') {
    const aw = ld.type === 'overhead' ? Math.min(4 * 18, w * 0.6) : Math.min(2 * 18, w * 0.5);
    const ah = ld.type === 'overhead' ? Math.min(4 * 18, h * 0.45) : Math.min(2 * 18, h * 0.3);

    // Soft glow behind
    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(aw, ah));
    glowGrad.addColorStop(0, hexToRgba(ld.color, 0.35));
    glowGrad.addColorStop(1, hexToRgba(ld.color, 0));
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h - 28);

    // Rectangle itself
    ctx.fillStyle = hexToRgba(ld.color, 0.85);
    ctx.shadowColor = ld.color;
    ctx.shadowBlur = 20;
    ctx.fillRect(cx - aw / 2, cy - ah / 2, aw, ah);
    ctx.shadowBlur = 0;

    // Border
    ctx.strokeStyle = hexToRgba('#ffffff', 0.25);
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - aw / 2, cy - ah / 2, aw, ah);
  }

  // Spot cone
  if (ld.type === 'spot' || ld.type === 'rim') {
    const halfAngle = 22.5 * (Math.PI / 180); // Default ~45 deg cone
    const coneLen = 80;

    ctx.beginPath();
    ctx.moveTo(cx, cy - 25);
    ctx.lineTo(
      cx - Math.sin(halfAngle) * coneLen,
      cy + Math.cos(halfAngle) * coneLen - 25,
    );
    ctx.lineTo(
      cx + Math.sin(halfAngle) * coneLen,
      cy + Math.cos(halfAngle) * coneLen - 25,
    );
    ctx.closePath();

    const coneGrad = ctx.createLinearGradient(cx, cy - 25, cx, cy + coneLen - 25);
    coneGrad.addColorStop(0, hexToRgba(ld.color, 0.7));
    coneGrad.addColorStop(1, hexToRgba(ld.color, 0.05));
    ctx.fillStyle = coneGrad;
    ctx.fill();

    ctx.strokeStyle = hexToRgba(ld.color, 0.4);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Angle label
    ctx.fillStyle = '#9090a8';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('45°', cx, cy + coneLen - 10);
  }

  // Point light center dot
  if (ld.type === 'point' || ld.type === 'underlight') {
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(ld.color, 0.9);
    ctx.shadowColor = ld.color;
    ctx.shadowBlur = 15;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // IES pattern visualization
  if (ld.type === 'ies') {
    ctx.strokeStyle = hexToRgba('#4a9eff', 0.3);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();

    for (let a = 0; a <= 360; a += 3) {
      const rad = (a * Math.PI) / 180;
      const intensity =
        0.4 +
        0.6 *
          Math.abs(Math.cos(rad * 1.5)) *
          Math.abs(Math.cos(rad * 0.7));
      const x = cx + Math.sin(rad) * 65 * intensity;
      const y = cy - Math.cos(rad) * 65 * intensity;

      if (a === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Directional light arrows
  if (ld.type === 'directional') {
    ctx.strokeStyle = hexToRgba(ld.color, 0.6);
    ctx.lineWidth = 2;
    const arrowLen = 70;

    // Main shaft
    ctx.beginPath();
    ctx.moveTo(cx, cy - arrowLen / 2);
    ctx.lineTo(cx, cy + arrowLen / 2);
    ctx.stroke();

    // Arrow head
    ctx.beginPath();
    ctx.moveTo(cx, cy + arrowLen / 2);
    ctx.lineTo(cx - 8, cy + arrowLen / 2 - 12);
    ctx.moveTo(cx, cy + arrowLen / 2);
    ctx.lineTo(cx + 8, cy + arrowLen / 2 - 12);
    ctx.stroke();

    // Parallel rays
    ctx.strokeStyle = hexToRgba(ld.color, 0.2);
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      ctx.beginPath();
      ctx.moveTo(cx + i * 14, cy - arrowLen / 2 + 5);
      ctx.lineTo(cx + i * 14, cy + arrowLen / 2 - 15);
      ctx.stroke();
    }
  }

  // Info overlay (top-left)
  ctx.fillStyle = '#9090a8';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`TYPE: ${ld.type.toUpperCase()}`, 10, 18);
  ctx.fillText(`INT:  ${ld.brightness.toFixed(1)}`, 10, 32);
  ctx.fillText(`OPAC: ${ld.opacity}%`, 10, 46);

  // Color swatch (top-right)
  ctx.textAlign = 'right';
  ctx.fillStyle = ld.color;
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillText(`● ${ld.color}`, w - 10, 18);

  // Color profile (top-right, second line)
  ctx.fillStyle = '#5a5a72';
  ctx.fillText(ld.colorProfile.toUpperCase(), w - 10, 32);
}