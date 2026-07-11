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
- TypeScript compilation: 0 errors