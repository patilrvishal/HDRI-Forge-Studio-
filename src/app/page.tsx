'use client'

import './studio.css'
import { TopBar } from '@/components/studio/TopBar'
import { LeftPanel } from '@/components/studio/LeftPanel'
import { Viewport } from '@/components/studio/Viewport'
import { RightPanel } from '@/components/studio/RightPanel'
import { BottomPanel } from '@/components/studio/BottomPanel'

/**
 * LightForge Studio — professional 3D lighting/rendering studio UI.
 *
 * The viewport uses a layered CSS/SVG composition (radial background +
 * SVG perspective grid with depth fade + CSS bokeh + SVG car silhouette)
 * to stay lightweight on Vercel. To swap in a live 3D scene later, replace
 * <Viewport/>'s visual layers with a react-three-fiber <Canvas> (grid
 * helper + product mesh + environment) driven by the same zustand store.
 */
export default function Home() {
  return (
    <div className="st-root">
      <TopBar />
      <LeftPanel />
      <Viewport />
      <RightPanel />
      <BottomPanel />
    </div>
  )
}
