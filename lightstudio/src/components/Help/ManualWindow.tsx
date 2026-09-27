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
      { type: 'heading', data: 'Welcome to HDRI Forge Studio' },
      { type: 'text', data: 'HDRI Forge Studio is a professional 3D lighting studio designed for automotive and product visualization. It provides a complete set of tools for placing, editing, and animating lights with real-time PBR preview. The workflow is centered around quickly setting up cinematic lighting rigs and exporting them as HDRIs or rendered images.' },
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
      { type: 'text', data: 'HDRI Forge Studio supports all standard Three.js light types plus several specialized presets optimized for automotive and product photography:' },
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
    category: 'Materials',
    icon: '\u{1F3A8}',
    content: [
      { type: 'heading', data: 'PBR Material System' },
      { type: 'text', data: 'HDRI Forge Studio features a full PBR (Physically Based Rendering) material editor supporting both MeshStandardMaterial and MeshPhysicalMaterial. When you load a 3D model, all materials are extracted and listed in the "Mat Edit" tab of the right panel. Click on a mesh in the viewport or use the search bar to select a material.' },
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
    category: 'Environment',
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
      { type: 'text', data: 'HDRI Forge Studio can export your lighting setup as a true HDR environment map (.hdr or .exr format). Unlike simple screen captures, the export uses analytical radiance calculation: for every pixel, it computes the exact light energy arriving from each light source using physical math. This produces pixel values in the hundreds to thousands range, which is what real HDRIs contain. The exported HDRI can then be used in Blender, Maya, Substance Painter, or any other DCC application that supports IBL.' },
    ],
  },
  {
    id: 'animation',
    title: 'Animation & Timeline',
    category: 'Animation',
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
    id: 'modeling',
    title: 'Modeling & Edit Mode',
    category: 'Scene',
    icon: '🧊',
    content: [
      { type: 'heading', data: 'Add shapes' },
      { type: 'text', data: 'Press Shift+A in the viewport (or use the Add button / Create > Mesh) to add a Plane, Cube, Circle, UV Sphere, Ico Sphere, Cylinder, Cone, Torus or Grid at the 3D cursor. The Last Operation panel lets you change segments, radius and size after adding. Meshes use a physical material (colour, roughness, metalness, clearcoat and emission in the N panel) and render in both PBR and the path tracer.' },
      { type: 'heading', data: 'Object Mode' },
      { type: 'shortcut-table', rows: [
        { keys: 'Click', action: 'Select a mesh (Shift = extend)' },
        { keys: 'Tab', action: 'Enter / leave Edit Mode' },
        { keys: 'G / R / S', action: 'Move / rotate / scale (X, Y, Z lock an axis, type a number)' },
        { keys: 'Shift+D', action: 'Duplicate' },
        { keys: 'X / Delete', action: 'Delete' },
        { keys: 'Ctrl+J', action: 'Join selected meshes' },
        { keys: 'Ctrl+A', action: 'Apply transforms' },
        { keys: 'N', action: 'Item and material panel' },

      ] },
      { type: 'heading', data: 'Select in Edit Mode' },
      { type: 'shortcut-table', rows: [
        { keys: '1 / 2 / 3', action: 'Vertex / edge / face select' },
        { keys: 'A / Alt+A / Ctrl+I', action: 'Select all / none / invert' },
        { keys: 'B / C', action: 'Box select / circle select (wheel = brush size)' },
        { keys: 'Alt+Click', action: 'Edge loop (Ctrl+Alt+Click = edge ring)' },
        { keys: 'Ctrl+Click', action: 'Shortest path from the active vertex' },
        { keys: 'Ctrl+Numpad +/-', action: 'Grow / shrink selection' },
        { keys: 'L / Ctrl+L', action: 'Select linked under cursor / from selection' },
        { keys: 'Alt+Z', action: 'X-Ray' },
        { keys: 'H / Alt+H / Shift+H', action: 'Hide / reveal / hide unselected' },

      ] },
      { type: 'heading', data: 'Modelling tools' },
      { type: 'shortcut-table', rows: [
        { keys: 'G / R / S', action: 'Move / rotate / scale; X Y Z lock axis, press twice for local, Shift+axis excludes it' },
        { keys: 'E', action: 'Extrude (moves along the normal)' },
        { keys: 'Ctrl+Right Click', action: 'Extrude to cursor' },
        { keys: 'I', action: 'Inset faces (Ctrl = depth, B boundary, I individual, O outset)' },
        { keys: 'Ctrl+B', action: 'Bevel (wheel = segments, Ctrl+Shift+B = vertices)' },
        { keys: 'Ctrl+R', action: 'Loop cut: hover, wheel = cuts, click, slide, click' },
        { keys: 'K', action: 'Knife: click points, Enter to cut, Z = cut through' },
        { keys: 'Shift+Space, P', action: 'Poly Build' },
        { keys: 'Alt+R', action: 'Spin around the 3D cursor' },
        { keys: 'X / Delete', action: 'Delete or dissolve menu' },
        { keys: 'M', action: 'Merge (centre, cursor, first, last, collapse, by distance)' },
        { keys: 'F / Alt+F', action: 'Make edge or face / fill holes' },
        { keys: 'V', action: 'Rip' },
        { keys: 'Y', action: 'Split' },
        { keys: 'P', action: 'Separate to a new object' },
        { keys: 'J', action: 'Connect vertex path' },
        { keys: 'Shift+V', action: 'Vertex slide (G G = edge slide)' },
        { keys: 'O', action: 'Proportional editing (wheel = size, Shift+O = falloff)' },
        { keys: 'Shift+Tab', action: 'Snapping' },
        { keys: 'Ctrl+V / Ctrl+E / Ctrl+F', action: 'Vertex / edge / face menus' },
        { keys: 'Right Click', action: 'Context menu' },
        { keys: 'Shift+Ctrl+Alt+S', action: 'Shear' },
        { keys: 'Shift+Right Click', action: 'Place the 3D cursor' },
        { keys: 'Ctrl+Z', action: 'Undo' },

      ] },
      { type: 'tip', data: 'The behaviour of extrude, inset, bevel, loop cut, dissolve and the other operators was checked against Blender, including vertex positions, so results match. Modelled meshes are saved inside the scene file.' },
    ],
  },
  {
    id: 'object-lights',
    title: 'Object Lights & HDRI Include',
    category: 'Lights',
    icon: '💡',
    content: [
      { type: 'heading', data: 'Use any object as a light' },
      { type: 'text', data: 'Select a mesh (in the Scene hierarchy, or click a modelled shape) and open Properties. Under Light, switch on Use as light. The object starts to glow, lights the model, and an Object Light appears in the Lights list. The face that points at the model emits light; change it with Emits from. Move, rotate or scale the object and the light follows.' },
      { type: 'list', items: [
        'Full light controls: colour and profile (daylight, tungsten, fluorescent, custom), temperature, Brightness, Opacity, Edge Softness, Drop Shadow, Visible / Solo.',
        'Object glows: turn off if you only want the light and not a glowing object.',
        'Works for modelled shapes, imported model parts and whole groups. Imported parts keep their own material for other meshes; only the chosen object glows.',
        'The light is exported into the HDRI like any area light, and in the path tracer the glowing surface lights the scene.',
        'Stop using as light restores the object exactly as it was.',
      ] },
      { type: 'heading', data: 'Include or exclude an object in the HDRI' },
      { type: 'text', data: 'Under HDRI Render, Include in HDRI paints the object into the exported HDRI and the HDRI preview as seen from the capture point, using its real silhouette. It also hides any light behind it, so a black object works as a flag / blocker. Excluded objects (the default) never appear in the HDRI.' },
      { type: 'list', items: [
        'Intensity: brightness of the object in the HDRI (1 = its own colour).',
        'Opacity: 100% is solid, lower lets the background show through.',
        'Colour: use the object material or a custom colour. Make blocker paints it solid black.',
        'Settings are saved in the scene file.',
      ] },
      { type: 'tip', data: 'For a softbox: add a Plane (Shift+A), scale it, place it beside the model and switch on Use as light. Turn on Include in HDRI for a flag or card that should appear in the exported HDRI but is not a light.' },
    ],
  },
  {
    id: 'light-appearance',
    title: 'Light Appearance & Presets',
    category: 'Lights',
    icon: '🎨',
    content: [
      { type: 'heading', data: 'Design what a light looks like' },
      { type: 'text', data: 'Select an area light and open Properties > Light Appearance. Press Enable Light Appearance to give the light a designed look instead of a plain flat panel. The preview shows the result over a checkerboard: transparent areas are see-through.' },
      { type: 'list', items: [
        'Content types: Bulb, Box Gradient, Gradient, Flat, Polygon, Image, Lumi-Curve, Scrim and Sky.',
        'Master is the base look. Value Blend layers blend colour into it (Normal, Multiply, Add, Subtract, Screen, Overlay, Darken, Lighten, Difference, Divide). Alpha Multiply layers shape the light: they multiply its transparency, which is how softboxes, rings and strips are made.',
        'Every layer has Transform (scale, rotation, offset, flips), Invert, Amount and can be reordered or removed.',
        'Global controls: Brightness (EV), Tint, Hue, Saturation, Contrast, Gamma, Opacity, Texture scale, Flip X / Y.',
        'Image content loads PNG, JPG, WebP, HDR and EXR files (imported images are saved in the scene file). Sky content has sun, turbidity, horizon and clouds.',
        'Filters: add Diffusion or Motion blur to soften or streak the finished light (see Diffusion & Motion Blur).',
      ] },
      { type: 'heading', data: 'Preset Library' },
      { type: 'text', data: 'The Preset Library (left panel, and inside Light Appearance) has 46 ready-made looks in categories: Softboxes, Strips, Bulbs & Spots, Shapes, Rings, Gradients, Curves, Scrims, Blinds & Flags and Sky. Hover a preset to preview it on the selected light, click to apply. Save preset stores your own; right-click a saved preset to delete it. Clicking a preset in the left panel adds a new light that looks like it. Presets are original designs: import your own photos of real lights with Image content.' },
      { type: 'heading', data: 'HDR Textured Area Lights' },
      { type: 'text', data: 'Turn on Textured Area Light for a light and it becomes a real 3D rectangle carrying its appearance as an RGBA texture. It lights and reflects in the viewport and the path tracer, and it is delivered as a texture instead of being painted into the exported HDRI.' },
      { type: 'list', items: [
        'Camera visibility: off = the panel still lights but is not seen.',
        'Smart Dolly: puts the panel just outside the model automatically. Dolly multiplier scales that (or the manual) distance.',
        'Maintain reflection size: scales the panel with the dolly so its reflection stays the same size.',
        'Spread: 100% is wide (Lambert) emission, lower makes a tighter beam in the HDRI.',
        'Export area-light pack writes one RGBA EXR (or PNG) per light plus a JSON with where each rectangle sits, for rebuilding the lights in another 3D app. Export EXR / PNG saves a single light.',
      ] },
      { type: 'tip', data: 'Path tracer: place a light with the Venetian Blinds preset in Area Light mode beside a glossy model and the blinds appear in its reflections.' },
    ],
  },
  {
    id: 'filters',
    title: 'Diffusion & Motion Blur',
    category: 'Lights',
    icon: '🌫',
    content: [
      { type: 'text', data: 'Filters work on light textures (planar) and on HDRI maps (spherical, pole aware). Add them from Light Appearance > Filters, from a Composite, or from an Edit HDRI layer.' },
      { type: 'list', items: [
        'Diffusion Blur mimics light passing through tracing paper or cloth. Energy conserving keeps the total light constant, so the light spreads and softens without getting brighter or darker overall.',
        'Motion Blur has a Linear mode (angle and length) and an Advanced mode that adds Curve, Tilt, Noise and a Speed map: the brightness of a second image scales the streak length at each point.',
        'Filters stack: enable, reorder or remove each one.',
      ] },
    ],
  },
  {
    id: 'edit-hdri',
    title: 'Edit HDRI Environments',
    category: 'Environment',
    icon: '🌅',
    content: [
      { type: 'text', data: 'Select an HDRI (or add one from the Add menu > Procedural Sky) and open Properties > Edit HDRI Environment. The map preview shows the edited result; the original file is never changed.' },
      { type: 'list', items: [
        'Layers: Colour / Exposure, Blur, Blocker, Remove / Clone, Sun and Mix HDRI, each with an on/off switch, opacity and order.',
        'Regions: every layer can act on the whole map, a circle or a rectangle with Feather and Invert. Use Pick position on map, then click the preview.',
        'Colour / Exposure: exposure, hue, saturation, contrast, gamma and tint in just the region.',
        'Blocker: darken a region or paint a solid colour card.',
        'Remove fills the region from its surroundings. Clone copies another area (with Gain) and Move removes the original.',
        'Sun finds the bright sun in the region and can Resize it (energy is kept), Move or Remove it.',
        'Mix HDRI brings a region of another HDRI in, with Replace / Add / Multiply / Screen.',
        'Procedural Sky: sun azimuth, elevation, size (energy preserving), turbidity and colours.',
      ] },
      { type: 'text', data: 'Edited and sky HDRIs feed the HDRI Preview, the exported file and the live 3D viewport. Show in the 3D viewport makes an asset the one you see reflected in the model.' },
    ],
  },
  {
    id: 'canvas-composites',
    title: 'Canvas, Composites & Looks',
    category: 'Lights',
    icon: '🗺',
    content: [
      { type: 'heading', data: 'Canvas' },
      { type: 'text', data: 'The Canvas tab (bottom panel) is the flat map of the lighting. Each light is outlined on the baked HDRI.' },
      { type: 'list', items: [
        'Select / Move: drag a light to move it around the model, drag a corner to resize it, mouse wheel scales the selected light.',
        'Energy-Conserving Light Scaling: hold Shift while resizing (Canvas or the 3D scale gizmo), or switch on Keep energy beside Scale, and the brightness is adjusted so the total light stays constant. A bigger, softer light does not get brighter.',
        'Paint Sun: click the map to place the sun of a Sky.',
        'Draw Lumi-Curve: draw a flowing line on the map; it becomes a light whose appearance is that curve, sized to fit. Edit the path, thickness, glow and taper under Light Appearance.',
      ] },
      { type: 'heading', data: 'LightPaint the Sun' },
      { type: 'text', data: 'Turn on LightPaint (T), choose Sun in the mode bar and click a reflective surface: the sun of the procedural sky (or of a light with Sky content) moves so its reflection lands exactly where you clicked. The bar also gives Reflection, Illumination, Shade, Rim and Shadow.' },
      { type: 'heading', data: 'Composites' },
      { type: 'text', data: 'Under Group & Composite give lights the same group and switch on Composite. The group then has shared Brightness, Opacity, Rotate (yaw), Tilt (pitch), Distance and Visible, and its own filters, which blur the group as one image in the HDRI. To take control of a light that is already inside an HDRI, use an Edit HDRI layer: Sun, or Clone with Gain and Move.' },
      { type: 'heading', data: 'Light Looks' },
      { type: 'text', data: 'In the Presets tab switch to Looks. Save Look captures the whole lighting design: lights and their appearances, groups, HDRI edits, object settings and the camera. Click a Look to apply it, Update to overwrite it with the current scene, Duplicate to make a variant and Rename. Use the A/B compare to flip between two Looks.' },
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
      { type: 'text', data: 'HDRI Forge Studio uses .lightscene files to save and restore the complete studio state including: all lights with positions, colors, and properties; environment settings and HDRI references; material overrides and texture uploads; render settings, post-processing, and color grading; camera position and bookmarks; animation keyframes and timeline data; and viewport design panel state.' },
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
    category: 'Help',
    icon: '\u{1F527}',
    content: [
      { type: 'heading', data: 'Common Issues' },
      { type: 'text', data: 'Model appears dark: Check that the environment intensity is > 0 and that lights are positioned correctly. Try applying a 3-light cinematic preset from the Viewport Design Panel as a starting point.' },
      { type: 'text', data: 'HDRI not loading: Ensure the file is a valid .hdr format. Very large HDRIs (>8K) may take longer to process. Try a smaller resolution first.' },
      { type: 'text', data: 'Material changes not visible: Make sure the material is assigned to the mesh and the mesh is visible in the scene hierarchy. Check the Scene tab for hidden objects.' },
      { type: 'text', data: 'Exported HDRI has max value = 1.0: This indicates a bug in the radiance calculation. A true HDRI should have max pixel values > 100. Check the console for "[HDRI Forge] Max pixel value" output.' },
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
              HDRI Forge Manual
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
                        background: activeSection === section.id ? 'rgba(34, 211, 238, 0.08)' : 'transparent',
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
                  <div key={idx} style={{ fontSize: 19, fontWeight: 600, color: 'var(--text)', marginTop: 28, marginBottom: 12 }}>
                    {block.data}
                  </div>
                );
              }
              if (block.type === 'text') {
                return (
                  <div key={idx} style={{ fontSize: 15.5, color: 'var(--text-sec)', lineHeight: 1.75, marginBottom: 16 }}>
                    {block.data}
                  </div>
                );
              }
              if (block.type === 'list') {
                return (
                  <div key={idx} style={{ marginBottom: 8, paddingLeft: 12 }}>
                    {block.items?.map((item, i) => (
                      <div key={i} style={{ fontSize: 15, color: 'var(--text-sec)', lineHeight: 1.7, marginBottom: 6, display: 'flex', gap: 8 }}>
                        <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{'\u2022'}</span>
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
                        background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: 8, padding: '16px 18px',
                      }}>
                        <span style={{ fontSize: 22, color: 'var(--accent)', flexShrink: 0, lineHeight: 1.4 }}>{card.icon}</span>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{card.title}</span>
                            {card.badge && (
                              <span style={{
                                fontSize: 11, fontWeight: 600, color: 'var(--accent)',
                                background: 'var(--accent-bg)', padding: '2px 9px', borderRadius: 10,
                              }}>{card.badge}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6, marginTop: 4 }}>{card.desc}</div>
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
                    background: 'rgba(34, 211, 238, 0.06)',
                    border: '1px solid rgba(34, 211, 238, 0.15)',
                    borderLeft: '3px solid var(--accent)',
                    borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                    fontSize: 10,
                    color: 'var(--text-sec)',
                    lineHeight: 1.6,
                  }}>
                    <span style={{ fontWeight: 600, color: 'var(--accent)', marginRight: 4 }}>Tip:</span>
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