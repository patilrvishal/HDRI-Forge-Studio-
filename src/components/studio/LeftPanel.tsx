'use client'

import React from 'react'
import {
  MousePointer2, Move, RotateCw, Maximize2, EyeOff, Bookmark, Magnet, Ruler,
  Maximize, Settings, Eye, Lock, Circle, Plus, ChevronDown, SquareStack, Grid2x2, Sun,
} from 'lucide-react'
import { useStudio, PRESETS, type ProfileKey } from '@/store/studioStore'

const RAIL_TOOLS = [
  MousePointer2, Move, RotateCw, Maximize2, EyeOff, Bookmark, Magnet, Ruler, Maximize, Settings,
]

const PROFILE_TILES: { key: ProfileKey; label: string; icon: React.ReactNode; bg: string }[] = [
  { key: 'area', label: 'Area Light', icon: <SquareStack size={22} />, bg: 'radial-gradient(circle at 50% 40%, #cfd6e6, #2b2f3a 70%)' },
  { key: 'grid', label: 'Light Grid', icon: <Grid2x2 size={22} />, bg: 'radial-gradient(circle at 50% 45%, #9aa4b8, #23262e 72%)' },
  { key: 'daylight', label: 'Daylight', icon: <Sun size={22} />, bg: 'radial-gradient(circle at 50% 40%, #ffd18a, #6b4a1e 72%)' },
]

/** Deterministic moody gradient thumbnail per preset index. */
function presetBg(i: number): string {
  const hues = [
    ['#3a4252', '#0c0d10'], ['#4a3a2a', '#0d0b09'], ['#2f3a44', '#0a0c0e'],
    ['#3a2f44', '#0c0a0e'], ['#44392a', '#0e0b09'], ['#2a3a3a', '#090c0c'],
  ]
  const [a, b] = hues[i % hues.length]
  const cx = 30 + (i * 17) % 40
  const cy = 30 + (i * 23) % 35
  return `radial-gradient(circle at ${cx}% ${cy}%, ${a} 0%, ${b} 70%)`
}

export function LeftPanel() {
  const { lights, selectedLightId, selectLight, toggleLightFlag, profile, setProfile, presetIndex, setPreset } = useStudio()

  return (
    <div className="st-left st-panel">
      <div className="st-panel-head">
        <span className="st-panel-title">LIGHT LIST</span>
        <button className="st-icon-btn"><Settings size={13} /></button>
      </div>

      <div className="st-rail-body">
        <div className="st-rail">
          {RAIL_TOOLS.map((Icon, i) => (
            <button key={i} className={`st-icon-btn${i === 1 ? ' active' : ''}`}><Icon size={15} /></button>
          ))}
        </div>

        <div className="st-left-inner">
          <div style={{ display: 'flex', gap: 2, padding: '6px 8px 4px' }}>
            {['LIGHTS', 'ENV', 'SCENE'].map((t, i) => (
              <button key={t} className={`st-tab${i === 0 ? ' active' : ''}`}>{t}</button>
            ))}
          </div>

          <div style={{ padding: '0 8px 6px' }}>
            <div className="st-select" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              All Lights <ChevronDown size={12} />
            </div>
          </div>

          <div className="st-scroll">
            {/* Light rows */}
            <div style={{ padding: '0 6px' }}>
              {lights.map((l) => (
                <div
                  key={l.id}
                  className={`st-light-row${l.id === selectedLightId ? ' sel' : ''}`}
                  onClick={() => selectLight(l.id)}
                  style={{ opacity: l.visible ? 1 : 0.45 }}
                >
                  <span className="st-swatch" style={{ background: l.color }} />
                  <span className="st-light-name">{l.name}</span>
                  <span className="st-light-actions">
                    <button className="st-icon-btn" onClick={(e) => { e.stopPropagation(); toggleLightFlag(l.id, 'visible') }}>
                      {l.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button className="st-icon-btn" onClick={(e) => { e.stopPropagation(); toggleLightFlag(l.id, 'locked') }}>
                      <Lock size={12} style={{ opacity: l.locked ? 1 : 0.5 }} />
                    </button>
                    <button className="st-icon-btn" onClick={(e) => { e.stopPropagation(); toggleLightFlag(l.id, 'solo') }}>
                      <Circle size={12} style={{ color: l.solo ? 'var(--st-accent)' : undefined }} />
                    </button>
                  </span>
                </div>
              ))}
            </div>

            {/* Light profiles tiles */}
            <div className="st-profiles-head">
              <span className="st-section-label">Light Profiles</span>
              <ChevronDown size={12} style={{ opacity: 0.6 }} />
            </div>
            <div className="st-tiles">
              {PROFILE_TILES.map((t) => (
                <div key={t.key} className={`st-tile${profile === t.key ? ' sel' : ''}`} onClick={() => setProfile(t.key)}>
                  <div className="st-tile-thumb" style={{ background: t.bg }}>
                    <span style={{ color: 'rgba(255,255,255,0.85)' }}>{t.icon}</span>
                  </div>
                  <span className="st-tile-label">{t.label}</span>
                </div>
              ))}
            </div>

            {/* Preset grid */}
            <div className="st-profiles-head" style={{ paddingTop: 2 }}>
              <span className="st-section-label">Light Profiles</span>
            </div>
            <div className="st-preset-grid">
              {PRESETS.map((name, i) => (
                <div key={i} className={`st-preset-card${presetIndex === i ? ' sel' : ''}`} onClick={() => setPreset(i)}>
                  <div className="st-preset-thumb" style={{ background: presetBg(i) }}>
                    <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 -20px 30px rgba(0,0,0,0.6)' }} />
                    <div style={{ position: 'absolute', top: '28%', left: '30%', width: '40%', height: '20%', borderRadius: '50%', background: 'rgba(255,255,255,0.16)', filter: 'blur(8px)' }} />
                  </div>
                  <div className="st-preset-label">{name}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="st-add-row">
            <button className="st-btn accent"><Plus size={13} /> Add</button>
            <div className="st-btn" style={{ flex: 1, justifyContent: 'space-between' }}>Point Light <ChevronDown size={12} /></div>
          </div>
        </div>
      </div>
    </div>
  )
}
