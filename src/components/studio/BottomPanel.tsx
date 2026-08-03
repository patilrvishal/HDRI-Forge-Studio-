'use client'

import React, { useRef, useState } from 'react'
import { Check, Play, SkipBack, SkipForward, Repeat, Upload, Loader2 } from 'lucide-react'
import { useStudio, type HdriItem } from '@/store/studioStore'
import { fileToPreviewUrl } from './hdri'
import { Toggle } from './ui'

/** Equirectangular-looking placeholder (sky band + horizon + ground). */
function placeholderBg(h: HdriItem): string {
  const a = h.hueA ?? '#8a94a3'
  const b = h.hueB ?? '#20242b'
  return `linear-gradient(180deg, ${a} 0%, ${a} 38%, rgba(255,255,255,0.18) 40%, ${b} 44%, ${b} 100%)`
}

export function BottomPanel() {
  const { hdris, selectedHdri, setHdri, importHdri, livePreview, toggleLive } = useStudio()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setImporting(true)
    try {
      for (const file of Array.from(files)) {
        const url = await fileToPreviewUrl(file)
        const name = file.name.replace(/\.[^.]+$/, '')
        importHdri({
          id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name,
          value: 1.0,
          imageUrl: url ?? undefined,
          hueA: '#7c86a0',
          hueB: '#191b22',
        })
      }
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

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
          {hdris.map((h) => (
            <div key={h.id} className={`st-hdri-card${selectedHdri === h.id ? ' sel' : ''}`} onClick={() => setHdri(h.id)}>
              <div
                className="st-hdri-thumb"
                style={
                  h.imageUrl
                    ? { backgroundImage: `url(${h.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : { background: placeholderBg(h) }
                }
              >
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.55))' }} />
                {selectedHdri === h.id && <div className="st-check"><Check size={10} /></div>}
                <div className="st-badge" style={{ top: 5, left: selectedHdri === h.id ? 24 : 5 }}>HDR</div>
                <div className="st-badge" style={{ top: 5, right: 5 }}>{h.value.toFixed(1)}</div>
              </div>
              <div className="st-hdri-name">{h.name}</div>
            </div>
          ))}

          {/* Import card */}
          <div className="st-hdri-card" onClick={() => fileRef.current?.click()}>
            <div
              className="st-hdri-thumb"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px dashed var(--st-border)', background: 'var(--st-bg)', color: 'var(--st-text-muted)', gap: 6,
              }}
            >
              {importing ? <Loader2 size={16} className="st-spin" /> : <Upload size={16} />}
              <span style={{ fontSize: 11 }}>{importing ? 'Importing…' : 'Import HDRI'}</span>
            </div>
            <div className="st-hdri-name" style={{ color: 'var(--st-text-dim)' }}>.hdr / .jpg / .png / .exr</div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".hdr,.exr,image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        <div className="st-global-env">
          <span className="st-section-label">Global Environment</span>
          <div className="st-row">
            <span className="st-row-label" style={{ width: 'auto', flex: 1 }}>Live Preview</span>
            <Toggle on={livePreview} onChange={toggleLive} />
          </div>
          <button className="st-btn" onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> Import HDRI
          </button>
          <span className="st-caption">
            Import a .hdr or equirectangular image — its preview appears in the strip and drives the scene lighting.
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
