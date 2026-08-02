'use client'

import React, { useState } from 'react'
import { Pipette, Box } from 'lucide-react'
import { useStudio } from '@/store/studioStore'
import { SliderRow, NumberRow, Toggle, Segmented, Section } from './ui'

export function RightPanel() {
  const { params, setParam, lights, selectedLightId } = useStudio()
  const light = lights.find((l) => l.id === selectedLightId)
  const [posMode, setPosMode] = useState<'spherical' | 'xyz'>('spherical')

  return (
    <div className="st-right st-panel">
      <div className="st-panel-head">
        <span className="st-panel-title">PROPERTIES</span>
        <div className="st-prop-tabs">
          {['LIGHT PREV', 'MATERIAL', 'MATH EDIT'].map((t, i) => (
            <button key={t} className={`st-tab${i === 0 ? ' active' : ''}`}>{t}</button>
          ))}
        </div>
      </div>

      <div className="st-scroll">
        <Section title="Light Parameters">
          <div className="st-row">
            <span className="st-row-label">Name</span>
            <input className="st-input" defaultValue={light?.name ?? 'Area Light'} />
          </div>
          <div className="st-row">
            <span className="st-row-label">Type</span>
            <select className="st-select"><option>Area</option><option>Point</option><option>Spot</option><option>Rim</option></select>
          </div>
          <div className="st-row">
            <span className="st-row-label">Profile</span>
            <select className="st-select"><option>Daylight</option><option>Tungsten</option><option>Fluorescent</option></select>
          </div>
        </Section>

        <Section title="Intensity & Color">
          <div className="st-row">
            <span className="st-row-label">Color</span>
            <div className="st-color-bar" />
            <button className="st-icon-btn"><Pipette size={13} /></button>
          </div>
          <SliderRow label="Temp" value={params.temp} min={1000} max={12000} step={10} display={`${params.temp}K`} onChange={(v) => setParam('temp', v)} />
          <SliderRow label="Brightness" value={params.brightness} min={0} max={1000} onChange={(v) => setParam('brightness', v)} />
          <SliderRow label="Opacity" value={params.opacity} min={0} max={100} unit="%" onChange={(v) => setParam('opacity', v)} />
          <div className="st-row">
            <span className="st-row-label">Visible</span>
            <Toggle on={params.visible} onChange={(v) => setParam('visible', v)} />
            <span style={{ flex: 1 }} />
            <span className="st-row-label" style={{ width: 'auto' }}>Helper</span>
            <Toggle on={params.helper} onChange={(v) => setParam('helper', v)} />
          </div>
        </Section>

        <Section title="Dimensions">
          <NumberRow label="Width" value={params.width} onChange={(v) => setParam('width', v)} />
          <NumberRow label="Height" value={params.height} onChange={(v) => setParam('height', v)} />
          <SliderRow label="Edge Softness" value={params.edgeSoftness} min={0} max={100} onChange={(v) => setParam('edgeSoftness', v)} />
          <SliderRow label="Scale" value={params.scale} min={0.1} max={5} step={0.1} unit="x" onChange={(v) => setParam('scale', v)} />
        </Section>

        <Section
          title="Spherical & XYZ Transform"
          headerRight={
            <Segmented
              options={[{ key: 'spherical', label: 'Spherical' }, { key: 'xyz', label: 'XYZ' }]}
              value={posMode}
              onChange={setPosMode}
            />
          }
        >
          {posMode === 'spherical' ? (
            <>
              <SliderRow label="Latitude" value={params.latitude} min={-90} max={90} step={0.1} unit="deg" onChange={(v) => setParam('latitude', v)} />
              <SliderRow label="Longitude" value={params.longitude} min={0} max={360} step={0.1} unit="deg" onChange={(v) => setParam('longitude', v)} />
              <SliderRow label="Radius" value={params.radius} min={0.5} max={30} step={0.1} onChange={(v) => setParam('radius', v)} />
              <SliderRow label="Height" value={params.heightPos} min={-5} max={15} step={0.1} onChange={(v) => setParam('heightPos', v)} />
            </>
          ) : (
            <div className="st-row">
              {(['x', 'y', 'z'] as const).map((ax) => (
                <React.Fragment key={ax}>
                  <span className="st-row-label" style={{ width: 12, textTransform: 'uppercase' }}>{ax}</span>
                  <input className="st-num" type="number" step={0.1} value={params[ax]} onChange={(e) => setParam(ax, parseFloat(e.target.value) || 0)} />
                </React.Fragment>
              ))}
            </div>
          )}
        </Section>

        <Section title="Position">
          <div className="st-row">
            {(['x', 'y', 'z'] as const).map((ax) => (
              <React.Fragment key={ax}>
                <span className="st-row-label" style={{ width: 12, textTransform: 'uppercase' }}>{ax}</span>
                <input className="st-num" type="number" step={0.1} value={params[ax]} onChange={(e) => setParam(ax, parseFloat(e.target.value) || 0)} />
              </React.Fragment>
            ))}
          </div>
        </Section>

        <Section title="Rotation" defaultOpen={false}>
          <SliderRow label="Rot X" value={0} min={-180} max={180} unit="deg" onChange={() => {}} />
          <SliderRow label="Rot Y" value={0} min={-180} max={180} unit="deg" onChange={() => {}} />
          <SliderRow label="Rot Z" value={0} min={-180} max={180} unit="deg" onChange={() => {}} />
        </Section>

        <Section title="Advanced Render Collection">
          <div className="st-row">
            <span className="st-row-label">Group</span>
            <select className="st-select"><option>None</option><option>Key Lights</option><option>Fill Lights</option><option>Rim Lights</option></select>
          </div>
        </Section>
      </div>

      {/* orientation gizmo */}
      <div style={{ position: 'absolute', bottom: 190, right: 12, opacity: 0.5 }}>
        <Box size={26} color="var(--st-text-muted)" />
      </div>
    </div>
  )
}
