'use client'

import React, { useMemo } from 'react'
import {
  Move, Orbit, RefreshCw, Frame, Plus, MousePointer2, Ruler, Camera, ChevronDown, X,
} from 'lucide-react'
import { useStudio, type Projection } from '@/store/studioStore'

const VW = 1600
const VH = 900

/** Build grid line segments for the given projection. */
function useGridLines(projection: Projection) {
  return useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; o: number }[] = []
    if (projection === 'perspective') {
      const horizonY = VH * 0.5
      const cx = VW / 2
      // converging vertical rails
      for (let x = -1600; x <= 1600; x += 130) {
        const o = 0.22 * (1 - Math.min(1, Math.abs(x) / 1700) * 0.5)
        lines.push({ x1: cx + x, y1: VH, x2: cx, y2: horizonY, o })
      }
      // horizontal depth lines — denser + fainter toward the horizon
      const n = 16
      for (let k = 1; k <= n; k++) {
        const f = 1 - k / n
        const y = horizonY + (VH - horizonY) * f * f
        lines.push({ x1: 0, y1: y, x2: VW, y2: y, o: Math.pow(f, 0.8) * 0.3 })
      }
    } else {
      // orthographic — flat, non-converging, uniform grid
      for (let x = 0; x <= VW; x += 80) lines.push({ x1: x, y1: 0, x2: x, y2: VH, o: 0.14 })
      for (let y = 0; y <= VH; y += 80) lines.push({ x1: 0, y1: y, x2: VW, y2: y, o: 0.14 })
    }
    return lines
  }, [projection])
}

function CarSilhouette() {
  return (
    <svg
      viewBox="0 0 520 200"
      style={{ position: 'absolute', left: '50%', top: '54%', width: '46%', transform: 'translate(-46%, -20%)', pointerEvents: 'none' }}
    >
      <defs>
        <linearGradient id="carBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3d44" />
          <stop offset="0.5" stopColor="#17181c" />
          <stop offset="1" stopColor="#050506" />
        </linearGradient>
        <linearGradient id="carGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b7280" />
          <stop offset="1" stopColor="#1a1d22" />
        </linearGradient>
        <radialGradient id="carShadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(0,0,0,0.55)" />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="260" cy="182" rx="230" ry="20" fill="url(#carShadow)" />
      {/* body */}
      <path
        d="M40 150 Q55 120 95 112 L150 108 Q175 74 235 70 L330 72 Q380 78 410 112 L470 122 Q495 130 498 150 L495 162 Q490 170 470 170 L70 170 Q45 168 40 158 Z"
        fill="url(#carBody)"
        stroke="#4a4e57"
        strokeWidth="1"
        strokeOpacity="0.4"
      />
      {/* greenhouse / glass */}
      <path d="M165 106 Q185 82 232 80 L322 82 Q368 86 392 108 Z" fill="url(#carGlass)" opacity="0.85" />
      {/* wheels */}
      <circle cx="145" cy="168" r="34" fill="#0a0a0c" stroke="#26282e" strokeWidth="3" />
      <circle cx="145" cy="168" r="15" fill="#1c1e23" />
      <circle cx="388" cy="168" r="34" fill="#0a0a0c" stroke="#26282e" strokeWidth="3" />
      <circle cx="388" cy="168" r="15" fill="#1c1e23" />
      {/* highlight sweep */}
      <path d="M95 118 Q220 96 470 128" stroke="rgba(255,255,255,0.28)" strokeWidth="2" fill="none" />
    </svg>
  )
}

function MiniPreview({ style, label, onClose }: { style: React.CSSProperties; label?: string; onClose?: () => void }) {
  return (
    <div className="st-mini-preview" style={style}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(90% 80% at 50% 40%, #26262e, #0b0b0e)' }} />
      <div style={{ position: 'absolute', left: '30%', top: '45%', width: '44%', height: '26%', background: '#050506', borderRadius: 4, boxShadow: '0 0 10px rgba(120,140,180,0.25)' }} />
      {label && <div className="st-mini-label">{label} <ChevronDown size={9} /></div>}
      {onClose && <div className="st-mini-close" onClick={onClose}><X size={9} /></div>}
    </div>
  )
}

const PROJ_LABELS: Record<Projection, string> = {
  perspective: 'Perspective', top: 'Orthographic (Top)', front: 'Orthographic (Front)', side: 'Orthographic (Side)',
}

export function Viewport() {
  const { projection, setProjection, cameraSlots, activeSlot, setActiveSlot, saveSlot } = useStudio()
  const lines = useGridLines(projection)
  const slot = cameraSlots[activeSlot]

  // Camera-driven car transform (slots visibly change the view).
  const carTransform =
    projection === 'perspective'
      ? `perspective(1400px) rotateY(${slot.yaw * 0.35}deg) rotateX(${slot.pitch * 0.2}deg) scale(${1 + (45 - slot.fov) * 0.006})`
      : projection === 'top' ? 'rotateX(72deg) scale(0.9)'
        : projection === 'front' ? 'rotateY(88deg) scale(0.95)' : 'none'

  return (
    <div className="st-viewport">
      {/* Bokeh light flares */}
      <div className="st-bokeh" style={{ width: 260, height: 260, left: '18%', top: '10%', background: '#ffb15e' }} />
      <div className="st-bokeh" style={{ width: 200, height: 200, left: '62%', top: '6%', background: '#5ea0ff' }} />
      <div className="st-bokeh" style={{ width: 160, height: 160, left: '44%', top: '20%', background: '#8f6bff', opacity: 0.3 }} />

      {/* Perspective grid */}
      <svg className="st-grid-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
        {lines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#3a3a42" strokeOpacity={l.o} strokeWidth={1} />
        ))}
      </svg>
      <div className="st-horizon-glow" style={{ top: 'calc(50% - 80px)' }} />

      {/* Subject */}
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transition: 'transform 0.5s ease' }}>
        <div style={{ position: 'absolute', inset: 0, transform: carTransform, transition: 'transform 0.5s ease' }}>
          <CarSilhouette />
        </div>
      </div>

      {/* Floating mini previews */}
      <MiniPreview style={{ left: 12, top: 12 }} label="Viewport" onClose={() => {}} />
      <MiniPreview style={{ right: 12, top: 12 }} onClose={() => {}} />
      <MiniPreview style={{ right: 12, bottom: 64 }} />

      {/* Top-center floating toolbar */}
      <div className="st-vp-float" style={{ top: 8, left: '50%', transform: 'translateX(-50%)' }}>
        {[Move, Orbit, RefreshCw, Frame, Plus].map((Icon, i) => (
          <button key={i} className={`st-icon-btn${i === 0 ? ' active' : ''}`}><Icon size={14} /></button>
        ))}
      </div>

      {/* Bottom-left floating toolbar */}
      <div className="st-vp-float" style={{ bottom: 12, left: 12 }}>
        {[MousePointer2, Orbit, Ruler, Camera].map((Icon, i) => (
          <button key={i} className="st-icon-btn"><Icon size={14} /></button>
        ))}
      </div>

      {/* Camera slot bar */}
      <div className="st-cam-bar">
        <select
          className="st-mini-select"
          style={{ height: 22, appearance: 'none', paddingRight: 6 }}
          value={projection}
          onChange={(e) => setProjection(e.target.value as Projection)}
        >
          {(Object.keys(PROJ_LABELS) as Projection[]).map((p) => (
            <option key={p} value={p}>{PROJ_LABELS[p]}</option>
          ))}
        </select>
        {cameraSlots.map((s, i) => (
          <button
            key={i}
            className={`st-slot${i === activeSlot ? ' active' : ''}${s.saved ? '' : ' empty'}`}
            onClick={() => setActiveSlot(i)}
            title={s.saved ? `Camera ${i + 1}` : `Empty slot ${i + 1}`}
          >
            {i + 1}
          </button>
        ))}
        <button className="st-btn" style={{ height: 22 }} onClick={saveSlot}><Plus size={12} /> Save</button>
      </div>

      {/* HUD */}
      <div className="st-hud">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Scene Render Progress: 86%</span>
          <span className="st-hud-bar"><span style={{ width: '86%' }} /></span>
        </div>
        <span>Memory: 16.50 GB / 32 GB</span>
      </div>
    </div>
  )
}
