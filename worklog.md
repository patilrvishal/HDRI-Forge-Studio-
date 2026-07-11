---
Task ID: 1
Agent: Main Agent
Task: Blender-style Scene Hierarchy Panel + Bottom Properties Panel

Work Log:
- Read full existing SceneHierarchy.tsx (1670 lines), sceneHierarchyStore.ts, uiStore.ts, AppLayout.tsx
- Identified issues: fragile maxHeight:50% split, stale useMemo for properties, no drag-drop, no collection filter fix
- Rewrote SceneHierarchy.tsx (2049 lines) with full-stack-developer subagent

Stage Summary:
- **Resizable Split Layout**: splitRatio state (default 0.6) + SplitHandle component with drag support
- **Live Properties Updates**: tick-based refresh + setInterval(250ms) in ObjectPropertiesPanel to pick up gizmo changes
- **Collection Filter Fix**: Group filter now explicitly includes Collections
- **Drag-and-Drop**: HTML5 drag-drop on TreeNode, amber highlight on collection drop targets, isDescendantOf guard
- **Visual Polish**: 24px row height, refined selection/hover colors, InfoRow helper, type badge with tinted borders
- **Properties Sections**: Transform (Location/Rotation/Scale), Object Info, Mesh Info (collapsible), Light Info (collapsible), Quick Actions (Visible/Isolate)
- **"No Selection" placeholder** when nothing selected, tree takes full height
- **Independent scrolling** for tree and properties panels
- TypeScript compilation: 0 errors in changed files

---
Task ID: 3
Agent: Main Agent
Task: Carpet Material Parameters — verify sheen/sheenRoughness/sheenColor are functional

Work Log:
- Checked Three.js r165 API: sheen is number (0-1), sheenRoughness is number (0-1), sheenColor is THREE.Color
- Verified MaterialEditor.ts types already have sheen, sheenRoughness, sheenColor
- Verified PROP_ROWS already includes Fabric / Carpet section with sheen, sheen roughness, sheen color
- Verified MaterialManager.ts already reads/writes sheen properties to Three.js
- Changed Fabric / Carpet section to defaultExpanded: true (was false) for better discoverability

Stage Summary:
- Carpet parameters (sheen, sheenRoughness, sheenColor) were already fully implemented in types, store, UI, and Three.js sync
- Improved discoverability by making the Fabric / Carpet section default expanded when material is Physical
- No new code needed — all real-time editing was already functional

---
Task ID: 4
Agent: Main Agent
Task: Fix NaN in LightProperties slider (cartesianToSpherical bug)

Work Log:
- Analyzed cartesianToSpherical: `lat = atan2(y - height, hDist)` where `height = y`, so lat was always 0
- Fixed: `lat = atan2(y, horizontalDist)` for proper elevation angle, with NaN guard for (0,0,0)
- Added NaN guard for longitude when (x=0, z=0)
- Added `Number.isFinite()` guards in Slider.tsx display (shows "—" for NaN)
- Added `safeSpherical`, `safePosition`, `safeRotation` useMemo accessors in LightProperties.tsx
- Added `Number.isFinite(value)` guards in handleSphericalChange, handlePositionChange, handleRotationChange
- Updated ManualWindow.tsx to remove the NaN bug troubleshooting entry

Stage Summary:
- **math.ts**: Fixed cartesianToSpherical lat calculation (was always 0), added edge-case NaN guards
- **Slider.tsx**: NaN value displays as "—" instead of "NaN"
- **LightProperties.tsx**: All slider/input values go through safeSpherical/safePosition/safeRotation with Number.isFinite fallbacks; all handlers reject NaN/Infinity inputs
- **ManualWindow.tsx**: Removed outdated NaN troubleshooting entry
- Zero new TypeScript errors in changed files