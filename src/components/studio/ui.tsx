'use client'

import React, { useState } from 'react'
import { ChevronRight } from 'lucide-react'

export function SliderRow({
  label, value, min, max, step = 1, unit = '', display, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  display?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="st-row">
      <span className="st-row-label">{label}</span>
      <input
        className="st-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="st-val">{display ?? `${value}${unit}`}</span>
    </div>
  )
}

export function NumberRow({
  label, value, step = 0.1, onChange,
}: {
  label: string
  value: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="st-row">
      <span className="st-row-label">{label}</span>
      <input
        className="st-num"
        style={{ width: 'auto', flex: 1 }}
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  )
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <div className={`st-toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on} />
}

export function Segmented<T extends string>({
  options, value, onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="st-seg">
      {options.map((o) => (
        <button key={o.key} className={value === o.key ? 'active' : ''} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Section({
  title, headerRight, defaultOpen = true, children,
}: {
  title: string
  headerRight?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="st-section">
      <div className="st-section-head" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={12} className={`st-chevron${open ? ' open' : ''}`} />
        <span className="st-section-label" style={{ flex: 1 }}>{title}</span>
        {headerRight && <span onClick={(e) => e.stopPropagation()}>{headerRight}</span>}
      </div>
      {open && <div className="st-section-body">{children}</div>}
    </div>
  )
}
