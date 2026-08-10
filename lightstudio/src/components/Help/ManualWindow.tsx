import React, { useState, useMemo } from 'react';

interface ManualWindowProps {
  onClose: () => void;
}

interface ManualSection {
  id: string;
  title: string;
  icon: string;
  category: string;
  content: ManualContent[];
}

interface ManualContent {
  type: 'heading' | 'text' | 'shortcut-table' | 'tip' | 'list' | 'card';
  data?: string;
  rows?: { keys: string; action: string }[];
  items?: string[];
  cards?: { icon: string; title: string; badge?: string; desc: string }[];
}

const SECTIONS: ManualSection[] = [
  {
    id: 'lightpaint',
    title: 'LightPaint',
    category: 'Lights',
    icon: '\u2728',
    content: [
      { type: 'heading', data: 'Click-to-position lighting' },
      { type: 'text', data: 'Select a light, then click the LightPaint icon (the star at the bottom of the transform toolbar) and click directly on the model. The light repositions itself automatically based on the active mode below.' },
      { type: 'heading', data: 'The five modes' },
      { type: 'card', cards: [
        { icon: '\u25CE', title: 'Reflection', badge: 'default', desc: 'Light lands so its reflection appears exactly on the clicked point. Best for chrome, glass, and car paint.' },
        { icon: '\u2600', title: 'Illumination', desc: 'Light faces the clicked point directly for maximum flat coverage. Best for matte materials.' },
        { icon: '\u263D', title: 'Shade', desc: 'Light moves to the opposite side, putting the clicked point into shadow.' },
        { icon: '\u2192', title: 'Rim', desc: 'Ignores the model entirely and places the light behind the scene along the camera sightline.' },
        { icon: '\u21BB', title: 'Shadow', desc: 'Pivots around the last Reflection/Illumination point so the cast shadow lands on the new click.' },
      ] },
      { type: 'tip', data: 'Drag continuously across a surface for a live preview - the reflection follows your cursor in real time. A light must be selected first, and the model must be loaded and visible.' },
    ],
  },
  {
    id: 'cameras',
    title: 'Cameras',
    category: 'Cameras',
    icon: '\u{1F3A5}',
    content: [
      { type: 'heading', data: 'Adding a camera' },
      { type: 'text', data: 'Use Create > Camera to add a Free Camera (manual orbit and rotation) or a Target Camera (automatically aims at and tracks a chosen scene object as either one moves).' },
      { type: 'heading', data: 'Switching cameras' },
      { type: 'text', data: 'A camera dropdown is always visible in the bottom-left corner of the viewport, listing Perspective (free orbit) plus every camera in the scene.' },
      { type: 'heading', data: 'Camera properties' },
      { type: 'list', items: [
        'Position / Rotation - world-space XYZ; rotation only applies when no target is set',
        'Target - pick an auto-tracked object, or Free Rotation for manual control',
        'Lens - focal length (mm), sensor fit, lens shift X/Y, FOV',
        'Clip - near and far clipping plane distances',
        'Depth of Field - focus object or manual distance, f-stop, blade count',
      ] },
      { type: 'tip', data: 'Orbit-drag directly in the viewport to fine-tune framing. The new position saves back to the active camera automatically when you release the drag.' },
    ],
  },
  {
    id: 'environment',
    title: 'Environment and HDRI',
    category: 'Environment and HDRI',
    icon: '\u{1F30D}',
    content: [
      { type: 'heading', data: 'Loading an HDRI' },
      { type: 'text', data: 'The Env tab loads one or more .hdr files, each as an independent layer with its own intensity, rotation, and active toggle, so multiple environments can be blended together.' },
      { type: 'heading', data: 'Gradient background' },
      { type: 'text', data: 'As an alternative or supplement to a loaded HDRI, generate a procedural gradient directly in the viewport from the collapsible Viewport panel top-left of the 3D view.' },
      { type: 'list', items: [
        'Type - Linear, Radial, or Conic',
        'Angle - rotation of the gradient direction, linear mode only',
        'Color stops - unlimited stops, each with its own color, position, and opacity',
      ] },
      { type: 'tip', data: 'When enabled, the gradient is rendered into the HDRI Preview and export pipeline as a genuine environment layer, not just a flat background image.' },
    ],
  },
  {
    id: 'status',
    title: 'Feature Status',
    category: 'Reference',
    icon: '\u2705',
    content: [
      { type: 'heading', data: 'What is fully working' },
      { type: 'list', items: [
        'All light types, color, brightness, opacity, visibility',
        'Edge softness in the exported HDRI',
        'Transform gizmos - Move, Rotate, Scale',
        'LightPaint - all five modes',
        'Presets - additive stacking',
        'HDRI loading and multi-layer blending',
        'Gradient background - viewport and export',
        'Ground plane transform and material',
        'Multi-camera creation, switching, and manual adjustment',
        'HDRI live preview and stats',
      ] },
      { type: 'heading', data: 'Partial or in progress' },
      { type: 'list', items: [
        'Ground plane baked into HDRI export - UI only for now',
        'Camera position/rotation applied to viewport - under active investigation',
        'Camera focal length, sensor, clip, and DOF - stored but not yet rendered',
        'HDRI export exposure calibration - being retuned',
      ] },
      { type: 'heading', data: 'Not yet available' },
      { type: 'list', items: [
        'Edge softness visible in the live viewport - a standard area light has no falloff parameter',
        '.erik geometry import - proprietary, undocumented format',
      ] },
    ],
  },
  {
    id: 'getting-started',
    title: 'Getting Started',
    category: 'Getting Started',
    icon: '\u{1F680}',
    content: [
      { type: 'heading', data: 'Welcome to LightForge Studio' },
      { type: 'text', data: 'LightForge Studio is a professional 3D lighting studio designed for automotive and product visualization. It provides a complete set of tools for placing, editing, and animating lights with real-time PBR preview. The workflow is centered around quickly setting up cinematic lighting rigs and exporting them as HDRIs or rendered images.' },
      { type: 'heading', data: 'Basic Workflow' },
      { type: 'list', items: [
        'Load a 3D model (.glb / .gltf) via File > Open Scene or drag-and-drop onto the viewport',
        'Add lights using the Create menu, the left panel "+" button, or keyboard shortcuts (1-6)',
        'Adjust light properties (color, intensity, position) in the right panel Properties tab',
        'Use the Viewport Design Panel for quick 3-light cinematic setups with one-click presets',
        'Fine-tune post-processing (bloom, vignette, SSAO, color grading) in the Viewport Design Panel',
        'Save your lighting setup as a preset for future reuse',
        'Export the final image (Ctrl+E) or HDRI environment map from the Project menu',
      ] },
      { type: 'tip', data: 'Click directly on the 3D viewport to select lights. Hold Shift and click to multi-select. Use the scroll wheel to zoom and middle-mouse to orbit the camera.' },
    ],
  },
  {
    id: 'lighting',
    title: 'Lighting System',
    category: 'Lights',
    icon: '\u{1F4A1}',
    content: [
      { type: 'heading', data: 'Supported Light Types' },
      { type: 'text', data: 'LightForge Studio supports all standard Three.js light types plus several specialized presets optimized for automotive and product photography:' },
      { type: 'list', items: [
        'Point Light: Omnidirectional light that emanates from a single point in space. Use for fill and ambient effects.',
        'Spot Light: Directional cone of light with adjustable angle and penumbra. Ideal for dramatic key lights and spotlighting specific areas.',
        'Directional Light: Parallel rays simulating distant light sources like the sun. Provides uniform illumination across the entire scene.',
        'Area Light (RectAreaLight): Rectangular emissive surface that produces soft, realistic shadows. The gold standard for product photography.',
        'IES Light: Uses IES profile data files to simulate real-world light fixture distributions. Perfect for architectural and studio lighting fixtures.',
        'Specialized Presets: Overhead, Under, Rim, and Fill lights are pre-configured with optimal positions and settings for common photography setups.',
      ] },
      { type: 'heading', data: 'Light Properties' },
      { type: 'text', data: 'Every light exposes these core properties in the right panel: Color (hex picker), Intensity (brightness value), Position (X/Y/Z or spherical coordinates with latitude, longitude, radius), and Falloff type. Spot lights additionally have Cone Angle and Penumbra controls. All changes update the viewport in real-time.' },
      { type: 'heading', data: 'Viewport Design Panel' },
      { type: 'text', data: 'The Viewport Design Panel (above the viewport) provides a streamlined 3-light editing workflow. It includes one-click cinematic presets (Cinematic 3-Light, Neon Noir, Golden Hour, Arctic Cool), per-light color/intensity/position controls, post-processing adjustments (bloom, vignette, SSAO, color grading, exposure), and grid/ground settings. All settings persist in scene files and restore on load.' },
      { type: 'tip', data: 'The 3-light cinematic preset is the fastest way to get a professional-looking result. Apply it first, then tweak individual light positions and colors to match your reference.' },
    ],
  },
  {
    id: 'materials',
    title: 'Material Editor',
    icon: '\u{1F3A8}',
    content: [
      { type: 'heading', data: 'PBR Material System' },
      { type: 'text', data: 'LightForge Studio features a full PBR (Physically Based Rendering) material editor supporting both MeshStandardMaterial and MeshPhysicalMaterial. When you load a 3D model, all materials are extracted and listed in the "Mat Edit" tab of the right panel. Click on a mesh in the viewport or use the search bar to select a material.' },
      { type: 'heading', data: 'Standard Properties' },
      { type: 'text', data: 'Base Color, Emissive color and intensity, Roughness (0 = mirror-like, 1 = fully rough), Metalness (0 = dielectric/plastic, 1 = metal), Opacity and transparency, Normal/Bump/AO scale, and 8 texture map slots (Albedo, Normal, Roughness, Metalness, Emissive, AO, Bump, Alpha).' },
      { type: 'heading', data: 'Physical Material Properties' },
      { type: 'text', data: 'When you enable any physical property, the material auto-upgrades to MeshPhysicalMaterial for maximum realism:' },
      { type: 'list', items: [
        'Clearcoat + Clearcoat Roughness: Simulates a thin transparent coating (car paint, lacquered surfaces, wet look)',
        'Transmission + Roughness + Thickness + IOR: Glass and refractive materials (windshields, lenses, liquids)',
        'Attenuation Color/Distance: Volume absorption for thick glass or colored liquids',
        'Sheen + Roughness + Color: Fabric-like scattering (cloth, velvet, suede)',
        'Iridescence + IOR: Rainbow interference effects (soap bubbles, pearlescent paint, beetle shells)',
        'Specular Intensity + Color: Fine-tune the Fresnel reflection for non-standard materials',
      ] },
      { type: 'tip', data: 'Physical properties appear in collapsible sections labeled with a "PHYSICAL" badge. They are hidden by default and appear the first time you adjust any physical slider. A "PHYSICAL" / "STANDARD" indicator in the header shows the current mode.' },
    ],
  },
  {
    id: 'environment',
    title: 'Environment & HDRIs',
    icon: '\u{1F30D}',
    content: [
      { type: 'heading', data: 'HDRI Environment Maps' },
      { type: 'text', data: 'HDRI (High Dynamic Range Image) environment maps provide realistic 360-degree lighting and reflections. Load HDRIs through the Environment tab in the left panel or the Environment Browser (Canvas > Environment Browser). The environment map serves dual purposes: it lights PBR materials via Image-Based Lighting (IBL), and it appears as the viewport background when enabled.' },
      { type: 'heading', data: 'Built-in Environment Presets' },
      { type: 'text', data: 'The studio ships with several built-in HDRI presets including neutral studio, warm studio, sunset, overcast, and night environments. Click any preset to apply it instantly. You can also load custom .hdr files from disk.' },
      { type: 'heading', data: 'Environment Controls' },
      { type: 'list', items: [
        'Intensity: Scales the overall brightness of the environment contribution (0-3x)',
        'Rotation: Rotates the HDRI around the Y axis to reposition key light sources',
        'Background Toggle: Show/hide the 360-degree environment as the viewport backdrop',
        'Blur: Softens the environment map for smoother, less contrasty reflections',
      ] },
      { type: 'heading', data: 'HDRI Export (Analytical)' },
      { type: 'text', data: 'LightForge Studio can export your lighting setup as a true HDR environment map (.hdr or .exr format). Unlike simple screen captures, the export uses analytical radiance calculation: for every pixel, it computes the exact light energy arriving from each light source using physical math. This produces pixel values in the hundreds to thousands range, which is what real HDRIs contain. The exported HDRI can then be used in Blender, Maya, Substance Painter, or any other DCC application that supports IBL.' },
    ],
  },
  {
    id: 'animation',
    title: 'Animation & Timeline',
    icon: '\u{23F1}',
    content: [
      { type: 'heading', data: 'Timeline System' },
      { type: 'text', data: 'The bottom panel Timeline tab provides keyframe animation for light properties, camera position, turntable rotation, and render settings. The timeline uses a frame-based system with adjustable FPS and frame range.' },
      { type: 'heading', data: 'Creating Keyframes' },
      { type: 'text', data: 'Select a light or property, navigate to the desired frame on the timeline ruler, then click the "Add Keyframe" button or press K. Keyframes appear as diamonds on the track lanes. You can drag them to retime, select and edit their values in the keyframe editor, and apply easing curves (linear, ease-in, ease-out, ease-in-out, bounce, elastic).' },
      { type: 'heading', data: 'Playback Controls' },
      { type: 'text', data: 'Use the transport bar to play (Space), stop, step forward/backward, and toggle loop mode. The current frame is displayed in the timecode. During playback, all animated properties interpolate smoothly between keyframes using the specified easing.' },
      { type: 'tip', data: 'Use the Timeline and Presets tabs at the bottom panel. They are mutually exclusive tabs - click Timeline to see animation tracks, click Presets to browse and apply lighting presets. Each gets the full bottom panel width.' },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    category: 'Reference',
    icon: '\u{2328}',
    content: [
      { type: 'heading', data: 'General' },
      { type: 'shortcut-table', rows: [
        { keys: 'Ctrl+N', action: 'New Scene' },
        { keys: 'Ctrl+O', action: 'Open Scene' },
        { keys: 'Ctrl+S', action: 'Save Scene' },
        { keys: 'Ctrl+E', action: 'Export Image' },
        { keys: 'Ctrl+Shift+E', action: 'Final Render' },
        { keys: 'Ctrl+Z / Ctrl+Y', action: 'Undo / Redo' },
        { keys: 'F', action: 'Reset View / Focus Mode' },
        { keys: 'Space', action: 'Play / Stop Animation' },
        { keys: '?', action: 'Open This Manual' },
      ] },
      { type: 'heading', data: 'Panels' },
      { type: 'shortcut-table', rows: [
        { keys: 'Ctrl+1', action: 'Toggle Left Panel (Lights/Env/Scene)' },
        { keys: 'Ctrl+2', action: 'Toggle Right Panel (Properties)' },
        { keys: 'Ctrl+3', action: 'Toggle Bottom Panel (Timeline)' },
        { keys: 'Ctrl+4', action: 'Toggle Presets' },
        { keys: 'Ctrl+5', action: 'Toggle Material Editor' },
        { keys: 'Ctrl+Shift+D', action: 'Default Layout' },
        { keys: 'Ctrl+Shift+L', action: 'Lighting Only Layout' },
        { keys: 'Ctrl+Shift+R', action: 'Reset Layout' },
      ] },
      { type: 'heading', data: 'Light Creation' },
      { type: 'shortcut-table', rows: [
        { keys: '1', action: 'Add Point Light' },
        { keys: '2', action: 'Add Spot Light' },
        { keys: '3', action: 'Add Area Light' },
        { keys: '4', action: 'Add Directional Light' },
        { keys: '5', action: 'Add IES Light' },
        { keys: '6', action: 'Add Overhead Light' },
      ] },
      { type: 'heading', data: 'Viewport' },
      { type: 'shortcut-table', rows: [
        { keys: 'Left Click', action: 'Select Light / Object' },
        { keys: 'Shift+Click', action: 'Multi-Select' },
        { keys: 'Middle Mouse', action: 'Orbit Camera' },
        { keys: 'Scroll Wheel', action: 'Zoom In/Out' },
        { keys: 'Right Mouse', action: 'Pan Camera' },
        { keys: 'K', action: 'Add Keyframe at Current Frame' },
        { keys: 'G', action: 'Toggle Grid' },
      ] },
    ],
  },
  {
    id: 'scene-management',
    title: 'Scene Management',
    category: 'Reference',
    icon: '\u{1F4C2}',
    content: [
      { type: 'heading', data: 'Scene Hierarchy' },
      { type: 'text', data: 'The Scene tab in the left panel displays a tree view of all objects in the 3D scene - meshes, lights, cameras, groups, and helpers. Click the arrow to expand/collapse groups. Click an object to select it (shows position info at the bottom). Click the eye icon to toggle visibility. Use the search bar to filter objects by name.' },
      { type: 'heading', data: 'Scene Files (.lightscene)' },
      { type: 'text', data: 'LightForge Studio uses .lightscene files to save and restore the complete studio state including: all lights with positions, colors, and properties; environment settings and HDRI references; material overrides and texture uploads; render settings, post-processing, and color grading; camera position and bookmarks; animation keyframes and timeline data; and viewport design panel state.' },
      { type: 'heading', data: 'Export Formats' },
      { type: 'list', items: [
        'PNG / JPEG: Standard image export with tone mapping applied',
        'HDRI (.hdr): Analytical radiance environment map for IBL in other applications',
        'EXR (.exr): OpenEXR float32 format for maximum dynamic range',
        'Scene (.lightscene): Complete project state for later editing',
      ] },
      { type: 'tip', data: 'Use File > Save Scene regularly. Scene files capture your entire lighting setup and can be shared with team members or revisited later.' },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: '\u{1F527}',
    content: [
      { type: 'heading', data: 'Common Issues' },
      { type: 'text', data: 'Model appears dark: Check that the environment intensity is > 0 and that lights are positioned correctly. Try applying a 3-light cinematic preset from the Viewport Design Panel as a starting point.' },
      { type: 'text', data: 'HDRI not loading: Ensure the file is a valid .hdr format. Very large HDRIs (>8K) may take longer to process. Try a smaller resolution first.' },
      { type: 'text', data: 'Material changes not visible: Make sure the material is assigned to the mesh and the mesh is visible in the scene hierarchy. Check the Scene tab for hidden objects.' },
      { type: 'text', data: 'Exported HDRI has max value = 1.0: This indicates a bug in the radiance calculation. A true HDRI should have max pixel values > 100. Check the console for "[LightForge HDRI] Max pixel value" output.' },
      { type: 'tip', data: 'If the viewport becomes unresponsive, try pressing F to reset the camera, or use Window > Reset Layout to restore the default panel arrangement.' },
    ],
  },
];

const ManualWindow: React.FC<ManualWindowProps> = ({ onClose }) => {
  const [activeSection, setActiveSection] = useState('getting-started');
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return SECTIONS;
    const q = searchQuery.toLowerCase();
    return SECTIONS.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      s.content.some((c) => {
        if (c.data && c.data.toLowerCase().includes(q)) return true;
        if (c.rows) return c.rows.some((r) => r.action.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q));
        if (c.items) return c.items.some((i) => i.toLowerCase().includes(q));
        return false;
      }),
    );
  }, [searchQuery]);

  const currentSection = useMemo(
    () => SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0],
    [activeSection],
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(1120px, 94vw)',
          height: 'min(620px, 85vh)',
          background: 'var(--bg-deep)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div
          style={{
            width: 200,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-panel)',
          }}
        >
          {/* Title */}
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>
              LightForge Manual
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
              v1.0.0
            </div>
          </div>

          {/* Search */}
          <div style={{ padding: '8px 8px 4px' }}>
            <input
              type="text"
              placeholder="Search docs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '4px 8px',
                fontSize: 10,
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text)',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Section list, grouped into collapsible categories */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {Object.entries(
              filteredSections.reduce((acc, s) => {
                (acc[s.category] = acc[s.category] || []).push(s);
                return acc;
              }, {} as Record<string, ManualSection[]>)
            ).map(([category, sections]) => {
              const isOpen = openCategories[category] ?? true;
              return (
                <div key={category}>
                  <div
                    onClick={() => setOpenCategories((p) => ({ ...p, [category]: !isOpen }))}
                    style={{
                      padding: '7px 10px', fontSize: 10, fontWeight: 600, color: 'var(--text-sec)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none',
                    }}
                  >
                    <span style={{ fontSize: 9, width: 10, display: 'inline-block' }}>{isOpen ? '\u25BE' : '\u25B8'}</span>
                    <span>{category}</span>
                  </div>
                  {isOpen && sections.map((section) => (
                    <div
                      key={section.id}
                      onClick={() => { setActiveSection(section.id); setSearchQuery(''); }}
                      style={{
                        padding: '6px 12px 6px 26px', fontSize: 10,
                        color: activeSection === section.id ? 'var(--accent-bright)' : 'var(--text-sec)',
                        background: activeSection === section.id ? 'rgba(74, 158, 255, 0.08)' : 'transparent',
                        borderRight: activeSection === section.id ? '2px solid var(--accent)' : '2px solid transparent',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.1s',
                      }}
                      onMouseEnter={(e) => { if (activeSection !== section.id) (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'; }}
                      onMouseLeave={(e) => { if (activeSection !== section.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span style={{ fontSize: 12 }}>{section.icon}</span>
                      <span>{section.title}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            {filteredSections.length === 0 && (
              <div style={{ padding: 12, fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>
                No results
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Content header */}
          <div style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 14 }}>{currentSection.icon}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
              {currentSection.title}
            </span>
            <button
              onClick={onClose}
              style={{
                width: 24, height: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12,
              }}
              title="Close (Esc)"
            >
              {'\u2715'}
            </button>
          </div>

          {/* Content body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 20px' }}>
            {currentSection.content.map((block, idx) => {
              if (block.type === 'heading') {
                return (
                  <div key={idx} style={{ fontSize: 19, fontWeight: 600, color: '#e8e9eb', marginTop: 28, marginBottom: 12 }}>
                    {block.data}
                  </div>
                );
              }
              if (block.type === 'text') {
                return (
                  <div key={idx} style={{ fontSize: 15.5, color: '#b8bcc3', lineHeight: 1.75, marginBottom: 16 }}>
                    {block.data}
                  </div>
                );
              }
              if (block.type === 'list') {
                return (
                  <div key={idx} style={{ marginBottom: 8, paddingLeft: 12 }}>
                    {block.items?.map((item, i) => (
                      <div key={i} style={{ fontSize: 15, color: '#b8bcc3', lineHeight: 1.7, marginBottom: 6, display: 'flex', gap: 8 }}>
                        <span style={{ color: '#5a9cf5', flexShrink: 0 }}>{'\u2022'}</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                );
              }
              if (block.type === 'shortcut-table') {
                return (
                  <div key={idx} style={{ marginBottom: 12 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Shortcut</th>
                          <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows?.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                            <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 10 }}>
                              {row.keys}
                            </td>
                            <td style={{ padding: '4px 8px', color: 'var(--text-sec)' }}>
                              {row.action}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }
              if (block.type === 'card') {
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
                    {block.cards?.map((card, i) => (
                      <div key={i} style={{
                        display: 'flex', gap: 10,
                        background: '#1a1c20', border: '1px solid #2a2d33',
                        borderRadius: 8, padding: '16px 18px',
                      }}>
                        <span style={{ fontSize: 22, color: '#5a9cf5', flexShrink: 0, lineHeight: 1.4 }}>{card.icon}</span>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 600, color: '#e8e9eb' }}>{card.title}</span>
                            {card.badge && (
                              <span style={{
                                fontSize: 11, fontWeight: 600, color: '#5a9cf5',
                                background: 'rgba(90, 156, 245, 0.15)', padding: '2px 9px', borderRadius: 10,
                              }}>{card.badge}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 14, color: '#9199a3', lineHeight: 1.6, marginTop: 4 }}>{card.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }
              if (block.type === 'tip') {
                return (
                  <div key={idx} style={{
                    padding: '8px 12px',
                    margin: '8px 0',
                    background: 'rgba(74, 158, 255, 0.06)',
                    border: '1px solid rgba(74, 158, 255, 0.15)',
                    borderLeft: '3px solid #5a9cf5',
                    borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                    fontSize: 10,
                    color: 'var(--text-sec)',
                    lineHeight: 1.6,
                  }}>
                    <span style={{ fontWeight: 600, color: '#5a9cf5', marginRight: 4 }}>Tip:</span>
                    {block.data}
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export { ManualWindow };