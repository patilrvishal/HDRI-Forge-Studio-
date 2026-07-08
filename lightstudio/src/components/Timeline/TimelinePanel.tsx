import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useAnimationStore } from '../../store/animationStore';
import { useLightsStore } from '../../store/lightsStore';
import {
  type AnimationTrack,
  type AnimatedProperty,
  type TrackCategory,
  type EasingType,
  getPropertyLabel,
  getCategoryColor,
} from '../../types/Animation';
import { KeyframeEditor } from './KeyframeEditor';

// ── Constants ────────────────────────────────────────────────────────────────

const FRAME_WIDTH = 8; // pixels per frame
const TRACK_HEIGHT = 24;
const RULER_HEIGHT = 22;
const HEADER_WIDTH = 140;

const TRACKABLE_PROPERTIES: { property: AnimatedProperty; label: string; category: TrackCategory }[] = [
  // Light
  { property: 'light.brightness', label: 'Brightness', category: 'light' },
  { property: 'light.positionX', label: 'Position X', category: 'light' },
  { property: 'light.positionY', label: 'Position Y', category: 'light' },
  { property: 'light.positionZ', label: 'Position Z', category: 'light' },
  { property: 'light.rotationX', label: 'Rotation X', category: 'light' },
  { property: 'light.rotationY', label: 'Rotation Y', category: 'light' },
  { property: 'light.rotationZ', label: 'Rotation Z', category: 'light' },
  // Camera
  { property: 'camera.positionX', label: 'Camera Pos X', category: 'camera' },
  { property: 'camera.positionY', label: 'Camera Pos Y', category: 'camera' },
  { property: 'camera.positionZ', label: 'Camera Pos Z', category: 'camera' },
  { property: 'camera.fov', label: 'Camera FOV', category: 'camera' },
  // Turntable
  { property: 'turntable.speed', label: 'Turntable Speed', category: 'turntable' },
  { property: 'turntable.rotation', label: 'Turntable Rotation', category: 'turntable' },
  // Render
  { property: 'render.exposure', label: 'Exposure', category: 'render' },
  { property: 'render.bloomIntensity', label: 'Bloom Intensity', category: 'render' },
];

const EASING_OPTIONS: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeInQuad', label: 'Ease In Quad' },
  { value: 'easeOutQuad', label: 'Ease Out Quad' },
  { value: 'easeInOutQuad', label: 'Ease In/Out Quad' },
  { value: 'easeInCubic', label: 'Ease In Cubic' },
  { value: 'easeOutCubic', label: 'Ease Out Cubic' },
  { value: 'easeInOutCubic', label: 'Ease In/Out Cubic' },
  { value: 'easeInExpo', label: 'Ease In Expo' },
  { value: 'easeOutExpo', label: 'Ease Out Expo' },
  { value: 'easeInOutExpo', label: 'Ease In/Out Expo' },
];

// ── Component ────────────────────────────────────────────────────────────────

export const TimelinePanel: React.FC = () => {
  const tracksRef = useRef<HTMLDivElement>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addCategory, setAddCategory] = useState<TrackCategory>('light');

  // ── Store selectors ─────────────────────────────────────────────────────
  const currentFrame = useAnimationStore((s) => s.currentFrame);
  const frameStart = useAnimationStore((s) => s.frameStart);
  const frameEnd = useAnimationStore((s) => s.frameEnd);
  const fps = useAnimationStore((s) => s.fps);
  const isPlaying = useAnimationStore((s) => s.isPlaying);
  const isLooping = useAnimationStore((s) => s.isLooping);
  const snapToFrame = useAnimationStore((s) => s.snapToFrame);
  const tracks = useAnimationStore((s) => s.tracks);
  const selectedTrackId = useAnimationStore((s) => s.selectedTrackId);
  const selectedKeyframeId = useAnimationStore((s) => s.selectedKeyframeId);

  const togglePlaying = useAnimationStore((s) => s.togglePlaying);
  const stop = useAnimationStore((s) => s.stop);
  const stepForward = useAnimationStore((s) => s.stepForward);
  const stepBackward = useAnimationStore((s) => s.stepBackward);
  const jumpToStart = useAnimationStore((s) => s.jumpToStart);
  const jumpToEnd = useAnimationStore((s) => s.jumpToEnd);
  const setCurrentFrame = useAnimationStore((s) => s.setCurrentFrame);
  const setFrameRange = useAnimationStore((s) => s.setFrameRange);
  const setFPS = useAnimationStore((s) => s.setFPS);
  const toggleLooping = useAnimationStore((s) => s.toggleLooping);
  const toggleSnapToFrame = useAnimationStore((s) => s.toggleSnapToFrame);
  const addTrack = useAnimationStore((s) => s.addTrack);
  const removeTrack = useAnimationStore((s) => s.removeTrack);
  const toggleTrackMute = useAnimationStore((s) => s.toggleTrackMute);
  const toggleTrackVisible = useAnimationStore((s) => s.toggleTrackVisible);
  const selectTrack = useAnimationStore((s) => s.selectTrack);
  const selectKeyframe = useAnimationStore((s) => s.selectKeyframe);
  const clearAllTracks = useAnimationStore((s) => s.clearAllTracks);

  // ── Lights store ────────────────────────────────────────────────────────
  const lights = useLightsStore((s) => s.lights);
  const selectedLightId = useLightsStore((s) => s.selectedLightId);

  // ── Derived ─────────────────────────────────────────────────────────────
  const totalFrames = frameEnd - frameStart;
  const timelineWidth = Math.max(totalFrames * FRAME_WIDTH, 200);
  const frameToX = useCallback(
    (frame: number) => (frame - frameStart) * FRAME_WIDTH,
    [frameStart],
  );
  const xToFrame = useCallback(
    (x: number) => {
      const raw = frameStart + x / FRAME_WIDTH;
      return snapToFrame ? Math.round(raw) : raw;
    },
    [frameStart, snapToFrame],
  );

  // ── Scrubbing ───────────────────────────────────────────────────────────
  const isScrubbing = useRef(false);

  const handleScrubAreaMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = xToFrame(x);
      setCurrentFrame(frame);
      isScrubbing.current = true;

      const handleMove = (ev: MouseEvent) => {
        if (!isScrubbing.current) return;
        const mx = ev.clientX - rect.left;
        setCurrentFrame(xToFrame(mx));
      };
      const handleUp = () => {
        isScrubbing.current = false;
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [setCurrentFrame, xToFrame],
  );

  // ── Keyframe click ──────────────────────────────────────────────────────
  const handleKeyframeClick = useCallback(
    (e: React.MouseEvent, trackId: string, kfId: string) => {
      e.stopPropagation();
      selectTrack(trackId);
      selectKeyframe(kfId);
    },
    [selectTrack, selectKeyframe],
  );

  // ── Double-click on track lane to add keyframe ──────────────────────────
  const handleTrackLaneDoubleClick = useCallback(
    (e: React.MouseEvent, track: AnimationTrack) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = xToFrame(x);

      // Get current value for this property
      let value = 0;
      if (track.category === 'light' && track.lightId) {
        const light = lights.find((l) => l.id === track.lightId);
        if (light) {
          switch (track.property) {
            case 'light.brightness': value = light.brightness; break;
            case 'light.positionX': value = light.transform.position.x; break;
            case 'light.positionY': value = light.transform.position.y; break;
            case 'light.positionZ': value = light.transform.position.z; break;
            case 'light.rotationX': value = light.transform.rotation.x; break;
            case 'light.rotationY': value = light.transform.rotation.y; break;
            case 'light.rotationZ': value = light.transform.rotation.z; break;
            default: value = 0;
          }
        }
      } else if (track.category === 'camera') {
        value = 1; // Placeholder; camera values come from scene store
      } else if (track.category === 'turntable') {
        value = 1.0;
      } else if (track.category === 'render') {
        value = 1.0;
      }

      useAnimationStore.getState().addKeyframe(track.id, Math.round(frame), value, 'linear');
    },
    [xToFrame, lights],
  );

  // ── Add track handler ───────────────────────────────────────────────────
  const handleAddTrack = useCallback(
    (item: { property: AnimatedProperty; label: string; category: TrackCategory }) => {
      const lightId = item.category === 'light' ? selectedLightId : null;
      const name = item.category === 'light' && selectedLightId
        ? `${lights.find((l) => l.id === selectedLightId)?.name ?? 'Light'} — ${item.label}`
        : item.label;
      addTrack(item.property, name, item.category, lightId);
      setShowAddMenu(false);
    },
    [addTrack, selectedLightId, lights],
  );

  // ── Selected keyframe data ──────────────────────────────────────────────
  const selectedKfData = useMemo(() => {
    if (!selectedTrackId || !selectedKeyframeId) return null;
    const track = tracks.find((t) => t.id === selectedTrackId);
    if (!track) return null;
    const kf = track.keyframes.find((k) => k.id === selectedKeyframeId);
    if (!kf) return null;
    return { track, keyframe: kf };
  }, [selectedTrackId, selectedKeyframeId, tracks]);

  // ── Format time from frame ──────────────────────────────────────────────
  const formatTime = useCallback(
    (frame: number) => {
      const totalSec = frame / fps;
      const min = Math.floor(totalSec / 60);
      const sec = Math.floor(totalSec % 60);
      const frac = Math.floor((totalSec % 1) * 100);
      return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${frac.toString().padStart(2, '0')}`;
    },
    [fps],
  );

  // ── Ruler tick marks ────────────────────────────────────────────────────
  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    // Determine tick interval based on total frames
    let interval = 1;
    if (totalFrames > 500) interval = 50;
    else if (totalFrames > 200) interval = 20;
    else if (totalFrames > 100) interval = 10;
    else if (totalFrames > 50) interval = 5;

    for (let f = frameStart; f <= frameEnd; f += interval) {
      ticks.push(f);
    }
    return ticks;
  }, [frameStart, frameEnd, totalFrames]);

  // ── Close add menu on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!showAddMenu) return;
    const handler = () => setShowAddMenu(false);
    const timer = setTimeout(() => window.addEventListener('click', handler), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handler);
    };
  }, [showAddMenu]);

  // ── Scroll to keep current frame visible ────────────────────────────────
  useEffect(() => {
    if (!tracksRef.current) return;
    const playheadX = frameToX(currentFrame);
    const scrollLeft = tracksRef.current.scrollLeft;
    const viewWidth = tracksRef.current.clientWidth;
    if (playheadX < scrollLeft || playheadX > scrollLeft + viewWidth) {
      tracksRef.current.scrollLeft = playheadX - viewWidth / 3;
    }
  }, [currentFrame, frameToX]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="timeline-panel">
      {/* ── Transport bar ──────────────────────────────────────────────── */}
      <div className="tl-transport">
        <div className="tl-transport-left">
          {/* Play/Pause */}
          <button
            className={`btn-icon ${isPlaying ? 'active' : ''}`}
            onClick={togglePlaying}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <rect x="1" y="0.5" width="3" height="9" rx="0.5" />
                <rect x="6" y="0.5" width="3" height="9" rx="0.5" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <path d="M1.5 1l8 4-8 4z" />
              </svg>
            )}
          </button>

          {/* Stop */}
          <button className="btn-icon" onClick={stop} title="Stop" aria-label="Stop">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1" y="1" width="8" height="8" rx="1" />
            </svg>
          </button>

          {/* Step back */}
          <button className="btn-icon" onClick={stepBackward} title="Step Back (<)" aria-label="Step Back">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M8 1l-6 4 6 4z" />
              <rect x="1" y="1" width="1.5" height="8" />
            </svg>
          </button>

          {/* Step forward */}
          <button className="btn-icon" onClick={stepForward} title="Step Forward (>)" aria-label="Step Forward">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 1l6 4-6 4z" />
              <rect x="7.5" y="1" width="1.5" height="8" />
            </svg>
          </button>

          {/* Jump to start */}
          <button className="btn-icon" onClick={jumpToStart} title="Jump to Start (Home)" aria-label="Jump to Start">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 5h8M5 1L1 5l4 4" />
              <line x1="1" y1="1" x2="1" y2="9" />
            </svg>
          </button>

          {/* Jump to end */}
          <button className="btn-icon" onClick={jumpToEnd} title="Jump to End (End)" aria-label="Jump to End">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 5H1M5 1l4 4-4 4" />
              <line x1="9" y1="1" x2="9" y2="9" />
            </svg>
          </button>
        </div>

        <div className="tl-transport-center">
          {/* Current frame display */}
          <span className="tl-frame-display">{formatTime(currentFrame)}</span>
          <span className="tl-frame-slash">/</span>
          <span className="tl-frame-display tl-frame-total">{formatTime(frameEnd)}</span>
        </div>

        <div className="tl-transport-right">
          {/* Frame range */}
          <div className="tl-frame-range">
            <input
              type="number"
              className="tl-frame-input"
              value={frameStart}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setFrameRange(v, frameEnd);
              }}
              title="Start Frame"
              aria-label="Start Frame"
            />
            <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>-</span>
            <input
              type="number"
              className="tl-frame-input"
              value={frameEnd}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setFrameRange(frameStart, v);
              }}
              title="End Frame"
              aria-label="End Frame"
            />
          </div>

          {/* FPS */}
          <div className="tl-fps-control">
            <span style={{ fontSize: 9, color: 'var(--text-dim)', marginRight: 2 }}>FPS</span>
            <input
              type="number"
              className="tl-frame-input"
              style={{ width: 34 }}
              value={fps}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setFPS(v);
              }}
              min={1}
              max={120}
              title="Frames Per Second"
              aria-label="FPS"
            />
          </div>

          {/* Loop toggle */}
          <button
            className={`btn-icon ${isLooping ? 'active' : ''}`}
            onClick={toggleLooping}
            title={isLooping ? 'Looping On' : 'Looping Off'}
            aria-label="Toggle Looping"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M2 6a4 4 0 018 0 4 4 0 01-8 0" />
              <path d="M9 2.5v2.5H6.5" />
            </svg>
          </button>

          {/* Snap toggle */}
          <button
            className={`btn-icon ${snapToFrame ? 'active' : ''}`}
            onClick={toggleSnapToFrame}
            title={snapToFrame ? 'Snap On' : 'Snap Off'}
            aria-label="Toggle Snap"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M0 3h12M0 6h12M0 9h12M3 0v12M6 0v12M9 0v12" />
            </svg>
          </button>

          {/* Clear all */}
          <button className="btn-icon" onClick={clearAllTracks} title="Clear All Tracks" aria-label="Clear All">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>

          {/* Add track */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn-icon"
              onClick={(e) => {
                e.stopPropagation();
                setShowAddMenu(!showAddMenu);
              }}
              title="Add Track"
              aria-label="Add Track"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 1v10M1 6h10" />
              </svg>
            </button>

            {/* Add track dropdown */}
            {showAddMenu && (
              <div className="tl-add-menu" onClick={(e) => e.stopPropagation()}>
                {/* Category tabs */}
                <div className="tl-add-tabs">
                  {(['light', 'camera', 'turntable', 'render'] as const).map((cat) => (
                    <button
                      key={cat}
                      className={`tl-add-tab ${addCategory === cat ? 'active' : ''}`}
                      onClick={() => setAddCategory(cat)}
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Property list */}
                <div className="tl-add-list">
                  {TRACKABLE_PROPERTIES.filter((p) => p.category === addCategory).map((item) => (
                    <button
                      key={item.property}
                      className="tl-add-item"
                      onClick={() => handleAddTrack(item)}
                    >
                      <span
                        className="tl-track-color-dot"
                        style={{ background: getCategoryColor(item.category) }}
                      />
                      {item.label}
                    </button>
                  ))}
                  {addCategory === 'light' && (
                    <div className="tl-add-note">
                      {selectedLightId
                        ? `Targets: ${lights.find((l) => l.id === selectedLightId)?.name ?? '—'}`
                        : 'Select a light first'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tracks area ────────────────────────────────────────────────── */}
      <div className="tl-tracks-container" ref={tracksRef}>
        {/* Ruler row */}
        <div className="tl-ruler-row">
          <div className="tl-track-header" style={{ width: HEADER_WIDTH }}>
            <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>TRACKS</span>
          </div>
          <div
            className="tl-ruler"
            style={{ width: timelineWidth }}
            onMouseDown={handleScrubAreaMouseDown}
          >
            {rulerTicks.map((f) => (
              <div
                key={f}
                className="tl-ruler-tick"
                style={{ left: frameToX(f) }}
              >
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Track rows */}
        <div className="tl-tracks-body">
          {tracks.length === 0 ? (
            <div className="tl-empty">
              <span>No animation tracks</span>
              <span style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
                Click + to add a track, or double-click a track lane to add keyframes
              </span>
            </div>
          ) : (
            tracks.map((track) => (
              <div
                key={track.id}
                className={`tl-track-row ${selectedTrackId === track.id ? 'selected' : ''} ${track.muted ? 'muted' : ''}`}
                onClick={() => selectTrack(track.id)}
              >
                {/* Track header */}
                <div
                  className="tl-track-header"
                  style={{ width: HEADER_WIDTH, borderRight: `2px solid ${track.color}` }}
                >
                  <div className="tl-track-header-content">
                    <span className="tl-track-name" title={track.name}>
                      {track.name}
                    </span>
                    <div className="tl-track-header-actions">
                      <button
                        className={`btn-icon tl-mute-btn ${track.muted ? 'muted' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleTrackMute(track.id); }}
                        title={track.muted ? 'Unmute' : 'Mute'}
                        aria-label={track.muted ? 'Unmute' : 'Mute'}
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                          {track.muted ? (
                            <path d="M1 2h1v4H1zM3 1h1v6H3zM5 2.5h1v3H5zM7 1.5h1v5H7z" />
                          ) : (
                            <path d="M1 2h1v4H1zM3 1h1v6H3zM5 2.5h1v3H5z" />
                          )}
                        </svg>
                      </button>
                      <button
                        className={`btn-icon tl-vis-btn ${!track.visible ? 'hidden' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleTrackVisible(track.id); }}
                        title={track.visible ? 'Hide' : 'Show'}
                        aria-label={track.visible ? 'Hide Track' : 'Show Track'}
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1">
                          {track.visible ? (
                            <>
                              <path d="M1 4a3.5 3.5 0 016 0 3.5 3.5 0 01-6 0" />
                              <circle cx="4" cy="4" r="1" fill="currentColor" />
                            </>
                          ) : (
                            <path d="M2 2l4 4M6 2l-4 4" />
                          )}
                        </svg>
                      </button>
                      <button
                        className="btn-icon tl-del-btn"
                        onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                        title="Remove Track"
                        aria-label="Remove Track"
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2">
                          <path d="M1 1l6 6M7 1l-6 6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Track lane */}
                <div
                  className="tl-track-lane"
                  style={{ width: timelineWidth, height: TRACK_HEIGHT }}
                  onDoubleClick={(e) => handleTrackLaneDoubleClick(e, track)}
                  onMouseDown={handleScrubAreaMouseDown}
                >
                  {/* Keyframe diamonds */}
                  {track.keyframes.map((kf) => (
                    <div
                      key={kf.id}
                      className={`tl-keyframe-diamond ${selectedKeyframeId === kf.id ? 'selected' : ''}`}
                      style={{
                        left: frameToX(kf.frame) - 5,
                        top: (TRACK_HEIGHT - 10) / 2,
                        borderColor: track.color,
                        background: selectedKeyframeId === kf.id ? track.color : 'var(--bg-panel)',
                      }}
                      onMouseDown={(e) => handleKeyframeClick(e, track.id, kf.id)}
                      title={`Frame ${kf.frame}: ${kf.value.toFixed(2)} [${kf.easing}]`}
                    />
                  ))}

                  {/* Interpolation line between keyframes */}
                  {track.keyframes.length >= 2 && (
                    <svg
                      className="tl-interpolation-line"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: timelineWidth,
                        height: TRACK_HEIGHT,
                        pointerEvents: 'none',
                      }}
                    >
                      <polyline
                        fill="none"
                        stroke={track.color}
                        strokeWidth={1}
                        strokeOpacity={0.4}
                        points={track.keyframes
                          .map((kf) => {
                            const x = frameToX(kf.frame);
                            // Normalize value to track height for visualization
                            const values = track.keyframes.map((k) => k.value);
                            const min = Math.min(...values);
                            const max = Math.max(...values);
                            const range = max - min || 1;
                            const y = TRACK_HEIGHT - 2 - ((kf.value - min) / range) * (TRACK_HEIGHT - 4);
                            return `${x},${y}`;
                          })
                          .join(' ')}
                      />
                    </svg>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Playhead */}
        <div
          className="tl-playhead"
          style={{ left: HEADER_WIDTH + frameToX(currentFrame) }}
        />
      </div>

      {/* ── Keyframe editor (bottom strip) ─────────────────────────────── */}
      {selectedKfData && (
        <KeyframeEditor
          track={selectedKfData.track}
          keyframe={selectedKfData.keyframe}
        />
      )}
    </div>
  );
};