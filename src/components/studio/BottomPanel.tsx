'use client'

import React from 'react'
import { Check, Play, SkipBack, SkipForward, Repeat } from 'lucide-react'
import { useStudio, HDRIS } from '@/store/studioStore'
import { Toggle } from './ui'

export function BottomPanel() {
  const { selectedHdri, setHdri, livePreview, toggleLive } = useStudio()

  return (
    <div className="st-bottom">
      <div className="st-panel-head" style={{ background: 'var(--st-surface)' }}>
        <div className="st-tabs">
          {['HDRI PREVIEW', 'TIMELINE', 'PRESETS'].map((t, i) => (
            <button key={t} className={`st-tab${i === 0 ? ' active' : ''}`}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div className="st-env-row">
          {HDRIS.map((h) => (
            <div key={h.id} className={`st-hdri-card${selectedHdri === h.id ? ' sel' : ''}`} onClick={() => setHdri(h.id)}>
              <div className="st-hdri-thumb" style={{ background: `linear-gradient(100deg, ${h.hueB}, ${h.hueA} 45%, ${h.hueB})` }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.5))' }} />
                {selectedHdri === h.id && <div className="st-check"><Check size={10} /></div>}
                <div className="st-badge" style={{ top: 5, left: selectedHdri === h.id ? 24 : 5 }}>HDR</div>
                <div className="st-badge" style={{ top: 5, right: 5 }}>{h.value.toFixed(1)}</div>
              </div>
              <div className="st-hdri-name">{h.name}</div>
            </div>
          ))}
        </div>

        <div className="st-global-env">
          <span className="st-section-label">Global Environment</span>
          <div className="st-row">
            <span className="st-row-label" style={{ width: 'auto', flex: 1 }}>Live Preview</span>
            <Toggle on={livePreview} onChange={toggleLive} />
          </div>
          <span className="st-caption">
            Live preview updates the scene lighting from the selected HDRI in real time. Turn off for a one-off render.
          </span>
        </div>
      </div>

      <div className="st-timeline">
        <button className="st-icon-btn"><SkipBack size={13} /></button>
        <button className="st-icon-btn active"><Play size={13} /></button>
        <button className="st-icon-btn"><SkipForward size={13} /></button>
        <button className="st-icon-btn"><Repeat size={13} /></button>
        <span className="st-val" style={{ width: 'auto', color: 'var(--st-text-muted)' }}>00:00</span>
        <div className="st-track"><div className="st-playhead" style={{ left: '18%' }} /></div>
        <span className="st-val" style={{ width: 'auto', color: 'var(--st-text-muted)' }}>00:30</span>
      </div>
    </div>
  )
}
