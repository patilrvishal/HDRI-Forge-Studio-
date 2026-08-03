'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Projection = 'perspective' | 'top' | 'front' | 'side'
export type ProfileKey = 'area' | 'grid' | 'daylight'

export interface LightItem {
  id: string
  name: string
  type: string
  color: string
  visible: boolean
  locked: boolean
  solo: boolean
}

export interface CameraSlot {
  /** azimuth angle in degrees */
  yaw: number
  /** elevation angle in degrees */
  pitch: number
  fov: number
  saved: boolean
}

export interface LightParams {
  temp: number
  brightness: number
  opacity: number
  visible: boolean
  helper: boolean
  width: number
  height: number
  edgeSoftness: number
  scale: number
  latitude: number
  longitude: number
  radius: number
  heightPos: number
  x: number
  y: number
  z: number
}

export interface HdriItem {
  id: string
  name: string
  value: number
  hueA?: string
  hueB?: string
  /** Real preview image (object URL or data URL) shown once an HDRI is imported. */
  imageUrl?: string
}

const DEFAULT_SLOTS: CameraSlot[] = [
  { yaw: 35, pitch: 14, fov: 45, saved: true },
  { yaw: -30, pitch: 10, fov: 40, saved: true },
  { yaw: 90, pitch: 22, fov: 50, saved: true },
  { yaw: 180, pitch: 8, fov: 42, saved: true },
  { yaw: 0, pitch: 0, fov: 35, saved: false },
  { yaw: 0, pitch: 0, fov: 35, saved: false },
  { yaw: 0, pitch: 0, fov: 35, saved: false },
  { yaw: 0, pitch: 0, fov: 35, saved: false },
]

const DEFAULT_PARAMS: LightParams = {
  temp: 7450,
  brightness: 250,
  opacity: 100,
  visible: true,
  helper: true,
  width: 2,
  height: 2,
  edgeSoftness: 50,
  scale: 1,
  latitude: 10.4,
  longitude: 76.6,
  radius: 7.1,
  heightPos: 1.3,
  x: 1,
  y: 2,
  z: 6,
}

const LIGHTS: LightItem[] = [
  { id: 'l1', name: 'Area Light', type: 'Area', color: '#e8e2c8', visible: true, locked: false, solo: false },
  { id: 'l2', name: 'Fill Panel', type: 'Area', color: '#bcd4ff', visible: true, locked: false, solo: false },
  { id: 'l3', name: 'Rim Light', type: 'Rim', color: '#ffd7a8', visible: true, locked: false, solo: false },
  { id: 'l4', name: 'Key Softbox', type: 'Area', color: '#ffffff', visible: true, locked: false, solo: false },
]

export const HDRIS: HdriItem[] = [
  { id: 'h1', name: 'Gravel Pit - Golden Hour', value: 3.0, hueA: '#caa15a', hueB: '#2b2118' },
  { id: 'h2', name: 'Gravel Pit - Overcast', value: 2.66, hueA: '#8a94a3', hueB: '#20242b' },
  { id: 'h3', name: 'Reflective Gallery', value: 3.6, hueA: '#c9ccd2', hueB: '#3a3d44' },
  { id: 'h4', name: 'Gallery Glow', value: 2.4, hueA: '#7c86a0', hueB: '#191b22' },
  { id: 'h5', name: 'Studio Sweep', value: 1.8, hueA: '#d8dde6', hueB: '#2a2d33' },
  { id: 'h6', name: 'Night Street', value: 3.2, hueA: '#4a6fa5', hueB: '#0f1420' },
]

export const PRESETS = [
  'Studio Softbox', 'Gravel Pit', 'Ring Light', 'Ring Light',
  'Fresnel Spot', 'Ring Light', 'Daylight Panel', 'Daylight',
  'Daylight Panel', 'Daylight', 'Rim Sweep', 'Beauty Dish',
]

interface StudioState {
  lights: LightItem[]
  selectedLightId: string
  params: LightParams
  profile: ProfileKey
  presetIndex: number
  hdris: HdriItem[]
  selectedHdri: string
  livePreview: boolean
  cameraSlots: CameraSlot[]
  activeSlot: number
  projection: Projection

  importHdri: (item: HdriItem) => void
  selectLight: (id: string) => void
  toggleLightFlag: (id: string, key: 'visible' | 'locked' | 'solo') => void
  setParam: <K extends keyof LightParams>(key: K, value: LightParams[K]) => void
  setProfile: (p: ProfileKey) => void
  setPreset: (i: number) => void
  setHdri: (id: string) => void
  toggleLive: () => void
  setActiveSlot: (i: number) => void
  saveSlot: () => void
  setProjection: (p: Projection) => void
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      lights: LIGHTS,
      selectedLightId: 'l1',
      params: DEFAULT_PARAMS,
      profile: 'area',
      presetIndex: 0,
      hdris: HDRIS,
      selectedHdri: 'h1',
      livePreview: true,
      cameraSlots: DEFAULT_SLOTS,
      activeSlot: 0,
      projection: 'perspective',

      importHdri: (item) =>
        set((s) => ({ hdris: [...s.hdris, item], selectedHdri: item.id })),
      selectLight: (id) => set({ selectedLightId: id }),
      toggleLightFlag: (id, key) =>
        set((s) => ({
          lights: s.lights.map((l) => (l.id === id ? { ...l, [key]: !l[key] } : l)),
        })),
      setParam: (key, value) => set((s) => ({ params: { ...s.params, [key]: value } })),
      setProfile: (p) => set({ profile: p }),
      setPreset: (i) => set({ presetIndex: i }),
      setHdri: (id) => set({ selectedHdri: id }),
      toggleLive: () => set((s) => ({ livePreview: !s.livePreview })),
      setActiveSlot: (i) => set({ activeSlot: i }),
      saveSlot: () =>
        set((s) => {
          const slots = s.cameraSlots.slice()
          // "Capture" the current-ish camera into the active slot
          slots[s.activeSlot] = {
            yaw: slots[s.activeSlot].yaw || 25,
            pitch: slots[s.activeSlot].pitch || 12,
            fov: 45,
            saved: true,
          }
          return { cameraSlots: slots }
        }),
      setProjection: (p) => set({ projection: p }),
    }),
    {
      name: 'lightforge-studio-ui',
      partialize: (s) => ({
        activeSlot: s.activeSlot,
        projection: s.projection,
        cameraSlots: s.cameraSlots,
        selectedHdri: s.selectedHdri,
        profile: s.profile,
        presetIndex: s.presetIndex,
      }),
    },
  ),
)
