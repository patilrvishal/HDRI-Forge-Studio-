'use client'

import React from 'react'
import { Search, Play, Undo2, Redo2, LayoutGrid, Share2, Grid3x3, Camera, ChevronDown } from 'lucide-react'
import { useStudio } from '@/store/studioStore'

const MENUS = ['Project', 'Edit', 'Create', 'Canvas', 'Window', 'Help']

export function TopBar() {
  const projection = useStudio((s) => s.projection)
  const viewLabel =
    projection === 'perspective' ? 'Perspective'
      : projection === 'top' ? 'Top'
        : projection === 'front' ? 'Front' : 'Side'

  return (
    <div className="st-top st-topbar">
      {MENUS.map((m) => (
        <div key={m} className="st-menu-item">{m}</div>
      ))}

      <div className="st-search" style={{ marginLeft: 10 }}>
        <Search size={11} />
        <span>LIGHT LIST</span>
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <span className="st-topbar-title">EMP_A_AWO_EXTERIOR</span>
      </div>

      <span className="st-tag">ENGINE</span>
      <div className="st-mini-select">PBR<ChevronDown size={11} /></div>
      <span className="st-tag" style={{ marginLeft: 6 }}>VIEW</span>
      <div className="st-mini-select">{viewLabel}<ChevronDown size={11} /></div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 10 }}>
        <button className="st-icon-btn active"><Play size={13} /></button>
        <button className="st-icon-btn"><Undo2 size={13} /></button>
        <button className="st-icon-btn"><Redo2 size={13} /></button>
        <button className="st-icon-btn"><Grid3x3 size={13} /></button>
        <button className="st-icon-btn"><Camera size={13} /></button>
        <button className="st-icon-btn"><LayoutGrid size={13} /></button>
        <button className="st-icon-btn"><Share2 size={13} /></button>
      </div>
    </div>
  )
}
