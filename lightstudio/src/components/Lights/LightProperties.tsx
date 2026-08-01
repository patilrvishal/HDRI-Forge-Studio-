import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useLightsStore } from '../../store/lightsStore';
import type { Light, LightType, ColorProfile, FalloffType } from '../../types/Light';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { NumericInput } from '../UI/NumericInput';
import { Dropdown } from '../UI/Dropdown';
import { ColorPicker } from '../UI/ColorPicker';
import { sphericalToCartesian, cartesianToSpherical } from '../../utils/math';
import { colorProfileToHex, hexToKelvin, kelvinToHex } from '../../utils/colorConversion';

const LIGHT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'point', label: 'Point' },
  { value: 'spot', label: 'Spot' },
  { value: 'area', label: 'Area' },
  { value: 'directional', label: 'Directional' },
  { value: 'overhead', label: 'Overhead' },
  { value: 'underlight', label: 'Underlight' },
  { value: 'rim', label: 'Rim' },
  { value: 'ies', label: 'IES' },
];

const COLOR_PROFILE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'daylight', label: 'Daylight' },
  { value: 'tungsten', label: 'Tungsten' },
  { value: 'fluorescent', label: 'Fluorescent' },
  { value: 'custom', label: 'Custom' },
];

const FALLOFF_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'quadratic', label: 'Quadratic' },
  { value: 'linear', label: 'Linear' },
  { value: 'none', label: 'None' },
  { value: 'custom', label: 'Custom (1.5)' },
];

export const LightProperties: React.FC = () => {
  const selectedLightId = useLightsStore((s) => s.selectedLightId);
  const lights = useLightsStore((s) => s.lights);
  const updateLight = useLightsStore((s) => s.updateLight);
  const updateLightTransform = useLightsStore((s) => s.updateLightTransform);

  const light = useMemo(
    () => lights.find((l) => l.id === selectedLightId) ?? null,
    [lights, selectedLightId],
  );

  // Safe accessor for spherical values â€” guards against NaN/undefined
  const safeSpherical = useMemo(() => {
    if (!light) return { lat: 0, lng: 0, radius: 5, height: 3 };
    const s = light.transform.spherical;
    return {
      lat: Number.isFinite(s.lat) ? s.lat : 0,
      lng: Number.isFinite(s.lng) ? s.lng : 0,
      radius: Number.isFinite(s.radius) ? Math.max(0.5, s.radius) : 5,
      height: Number.isFinite(s.height) ? s.height : 3,
    };
  }, [light]);

  // Safe accessor for position values
  const safePosition = useMemo(() => {
    if (!light) return { x: 0, y: 0, z: 0 };
    const p = light.transform.position;
    return {
      x: Number.isFinite(p.x) ? p.x : 0,
      y: Number.isFinite(p.y) ? p.y : 0,
      z: Number.isFinite(p.z) ? p.z : 0,
    };
  }, [light]);

  // Safe accessor for rotation values
  const safeRotation = useMemo(() => {
    if (!light) return { x: 0, y: 0, z: 0, enabled: false };
    const r = light.transform.rotation;
    return {
      x: Number.isFinite(r.x) ? r.x : 0,
      y: Number.isFinite(r.y) ? r.y : 0,
      z: Number.isFinite(r.z) ? r.z : 0,
      enabled: r.enabled,
    };
  }, [light]);

  // Area light uniform scale.
  // The slider is sticky: it holds its own value, and the base W/H are captured
  // whenever a different light is selected. Without this the slider snaps back
  // to 1 on every drag and the dimensions compound (1.5x then 1.5x = 2.25x).
  const [areaScale, setAreaScale] = useState(1);
  const areaBaseRef = useRef<{ w: number; h: number }>({ w: 2, h: 2 });

  useEffect(() => {
    if (!light) return;
    areaBaseRef.current = {
      w: light.areaWidth ?? 2,
      h: light.areaHeight ?? 2,
    };
    setAreaScale(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light?.id]);

  const handleUpdate = useCallback(
    (updates: Partial<Light>) => {
      if (!selectedLightId) return;
      updateLight(selectedLightId, updates);
    },
    [selectedLightId, updateLight],
  );

  const handleAreaScale = useCallback(
    (scale: number) => {
      const base = areaBaseRef.current;
      setAreaScale(scale);
      handleUpdate({
        areaWidth: Math.min(20, Math.max(0.1, base.w * scale)),
        areaHeight: Math.min(20, Math.max(0.1, base.h * scale)),
      });
    },
    [handleUpdate],
  );

  const handleAreaWidth = useCallback(
    (v: number) => {
      areaBaseRef.current = { w: v, h: light?.areaHeight ?? 2 };
      setAreaScale(1);
      handleUpdate({ areaWidth: v });
    },
    [handleUpdate, light?.areaHeight],
  );

  const handleAreaHeight = useCallback(
    (v: number) => {
      areaBaseRef.current = { w: light?.areaWidth ?? 2, h: v };
      setAreaScale(1);
      handleUpdate({ areaHeight: v });
    },
    [handleUpdate, light?.areaWidth],
  );

  const handleTypeChange = useCallback(
    (type: string) => {
      if (!light) return;
      // When switching types, also set visibility of gear (helper)
      const isAreaType = type === 'area' || type === 'overhead';
      handleUpdate({
        type: type as LightType,
        areaLight: isAreaType,
        gearVisible: true,
      });
    },
    [light, handleUpdate],
  );

  const handleColorChange = useCallback(
    (color: string) => {
      handleUpdate({ color, colorProfile: 'custom' });
    },
    [handleUpdate],
  );

  const handleProfileChange = useCallback(
    (profile: string) => {
      const hex = colorProfileToHex(profile);
      handleUpdate({ colorProfile: profile as ColorProfile, color: hex });
    },
    [handleUpdate],
  );

  const handleSphericalChange = useCallback(
    (key: 'lat' | 'lng' | 'radius' | 'height', value: number) => {
      if (!light || !Number.isFinite(value)) return;
      // Start from safe current spherical values to avoid propagating NaN
      const base = safeSpherical;
      const newSpherical = { ...base, [key]: value };
      const cart = sphericalToCartesian(
        newSpherical.lat,
        newSpherical.lng,
        newSpherical.radius,
        newSpherical.height,
      );
      updateLightTransform(light.id, {
        spherical: newSpherical,
        position: cart,
      });
    },
    [light, updateLightTransform, safeSpherical],
  );

  const handlePositionChange = useCallback(
    (axis: 'x' | 'y' | 'z', value: number) => {
      if (!light || !Number.isFinite(value)) return;
      const newPos = { ...safePosition, [axis]: value };
      // Recalculate spherical from the new Cartesian position to keep them in sync
      const sph = cartesianToSpherical(newPos.x, newPos.y, newPos.z);
      updateLightTransform(light.id, {
        position: newPos,
        spherical: { lat: sph.lat, lng: sph.lng, radius: sph.radius, height: sph.height },
      });
    },
    [light, updateLightTransform, safePosition],
  );

  const handleRotationChange = useCallback(
    (axis: 'x' | 'y' | 'z', value: number) => {
      if (!light || !Number.isFinite(value)) return;
      const newRot = { ...light.transform.rotation, [axis]: value };
      updateLightTransform(light.id, {
        rotation: newRot,
      });
    },
    [light, updateLightTransform],
  );

  // Color temperature display (approximate kelvin from hex)
  const kelvinValue = useMemo(() => {
    if (!light) return 6500;
    return hexToKelvin(light.color);
  }, [light]);

  // No light selected
  if (!light) {
    return (
      <div className="placeholder-panel" style={{ height: '100%' }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Select a light to view its properties
        </span>
      </div>
    );
  }

  const isSpotLike = light.type === 'spot' || light.type === 'rim';
  const isAreaLike = light.type === 'area' || light.type === 'overhead';
  const hasFalloff = light.type === 'point' || light.type === 'spot' || light.type === 'underlight' || light.type === 'ies';
  const hasShadows = light.type === 'spot' || light.type === 'directional' || light.type === 'point' || light.type === 'rim';

  return (
    <div className="light-properties">
      {/* Header */}
      <div className="props-section">
        <div className="section-header">Light Settings</div>

        {/* Name */}
        <div className="field-row" style={{ marginBottom: 6 }}>
          <span className="field-label">Name</span>
          <input
            className="field-input"
            value={light.name}
            onChange={(e) => handleUpdate({ name: e.target.value })}
          />
        </div>

        {/* Type */}
        <Dropdown
          label="Type"
          value={light.type}
          options={LIGHT_TYPE_OPTIONS}
          onChange={handleTypeChange}
        />

        {/* Color Profile */}
        <Dropdown
          label="Profile"
          value={light.colorProfile}
          options={COLOR_PROFILE_OPTIONS}
          onChange={handleProfileChange}
        />

        {/* Color Picker */}
        <ColorPicker label="Color" color={light.color} onChange={handleColorChange} />

        {/* Color temperature display */}
        <div className="field-row">
          <span className="field-label">Temp</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-sec)' }}>
            ~{kelvinValue}K
          </span>
        </div>

        {/* Brightness */}
        <Slider
          label="Brightness"
          value={light.brightness}
          min={0}
          max={1000}
          step={1}
          onChange={(v) => handleUpdate({ brightness: v })}
        />

        {/* Opacity */}
        <Slider
          label="Opacity"
          value={light.opacity}
          min={0}
          max={200}
          step={1}
          onChange={(v) => handleUpdate({ opacity: v })}
          unit="%"
        />

        {/* Visible + Gear toggles */}
        <div style={{ display: 'flex', gap: 12, marginTop: 4, marginBottom: 4 }}>
          <Toggle
            label="Visible"
            checked={light.visible}
            onChange={(v) => handleUpdate({ visible: v })}
          />
          <Toggle
            label="Helper"
            checked={light.gearVisible}
            onChange={(v) => handleUpdate({ gearVisible: v })}
          />
        </div>
      </div>

      {/* Falloff section */}
      {hasFalloff && (
        <div className="props-section">
          <div className="section-header">Falloff</div>
          <Dropdown
            label="Decay"
            value={light.falloff}
            options={FALLOFF_OPTIONS}
            onChange={(v) => handleUpdate({ falloff: v as FalloffType })}
          />
        </div>
      )}

      {/* Spotlight params */}
      {isSpotLike && (
        <div className="props-section">
          <div className="section-header">Spotlight</div>
          <Slider
            label="Angle"
            value={light.spotAngle}
            min={1}
            max={90}
            step={1}
            onChange={(v) => handleUpdate({ spotAngle: v })}
            unit="deg"
          />
          <Slider
            label="Penumbra"
            value={Math.round(light.spotPenumbra * 100)}
            min={0}
            max={100}
            step={1}
            onChange={(v) => handleUpdate({ spotPenumbra: v / 100 })}
            unit="%"
          />
        </div>
      )}

      {/* Area light dimensions */}
      {isAreaLike && (
        <div className="props-section">
          <div className="section-header">Area Dimensions</div>
          <NumericInput
            label="Width"
            value={light.areaWidth}
            min={0.1}
            max={20}
            step={0.1}
            onChange={handleAreaWidth}
          />
          <Slider
            label="Width"
            value={light.areaWidth ?? 2}
            min={0.1}
            max={20}
            step={0.1}
            onChange={handleAreaWidth}
          />
          <NumericInput
            label="Height"
            value={light.areaHeight}
            min={0.1}
            max={20}
            step={0.1}
            onChange={handleAreaHeight}
          />
          <Slider
            label="Height"
            value={light.areaHeight ?? 2}
            min={0.1}
            max={20}
            step={0.1}
            onChange={handleAreaHeight}
          />
          <Slider
            label="Edge Softness"
            value={light.edgeSoftness ?? 50}
            min={0}
            max={100}
            step={1}
            onChange={(v) => handleUpdate({ edgeSoftness: v })}
          />
          <Slider
            label="Scale"
            value={areaScale}
            min={0.1}
            max={5}
            step={0.05}
            onChange={handleAreaScale}
            unit="x"
          />
        </div>
      )}

      {/* Position: Spherical */}
      <div className="props-section">
        <div className="section-header">
          Position
          <span style={{ float: 'right', fontWeight: 400, textTransform: 'none', letterSpacing: 'normal', fontSize: 9, color: 'var(--text-dim)' }}>
            Spherical
          </span>
        </div>
        <Slider
          label="Latitude"
          value={safeSpherical.lat}
          min={-90}
          max={90}
          step={0.5}
          onChange={(v) => handleSphericalChange('lat', v)}
          unit="deg"
        />
        <Slider
          label="Longitude"
          value={safeSpherical.lng}
          min={0}
          max={360}
          step={0.5}
          onChange={(v) => handleSphericalChange('lng', v)}
          unit="deg"
        />
        <Slider
          label="Radius"
          value={safeSpherical.radius}
          min={0.5}
          max={30}
          step={0.1}
          onChange={(v) => handleSphericalChange('radius', v)}
        />
        <Slider
          label="Height"
          value={safeSpherical.height}
          min={-5}
          max={15}
          step={0.1}
          onChange={(v) => handleSphericalChange('height', v)}
        />
      </div>

      {/* Position: Cartesian XYZ */}
      <div className="props-section">
        <div className="section-header">
          Position
          <span style={{ float: 'right', fontWeight: 400, textTransform: 'none', letterSpacing: 'normal', fontSize: 9, color: 'var(--text-dim)' }}>
            XYZ
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <NumericInput
              label="X"
              value={safePosition.x}
              min={-20}
              max={20}
              step={0.1}
              onChange={(v) => handlePositionChange('x', v)}
              width="100%"
            />
          </div>
          <div style={{ flex: 1 }}>
            <NumericInput
              label="Y"
              value={safePosition.y}
              min={-5}
              max={15}
              step={0.1}
              onChange={(v) => handlePositionChange('y', v)}
              width="100%"
            />
          </div>
          <div style={{ flex: 1 }}>
            <NumericInput
              label="Z"
              value={safePosition.z}
              min={-20}
              max={20}
              step={0.1}
              onChange={(v) => handlePositionChange('z', v)}
              width="100%"
            />
          </div>
        </div>
      </div>

      {/* Rotation */}
      <div className="props-section">
        <div className="section-header">
          Rotation
          <span style={{ marginLeft: 'auto' }}>
            <Toggle
              checked={safeRotation.enabled}
              onChange={(v) =>
                handleUpdate({
                  transform: {
                    ...light.transform,
                    rotation: { ...light.transform.rotation, enabled: v },
                  },
                })
              }
            />
          </span>
        </div>
        {safeRotation.enabled && (
          <>
            <Slider
              label="Rot X"
              value={safeRotation.x}
              min={-180}
              max={180}
              step={1}
              onChange={(v) => handleRotationChange('x', v)}
              unit="deg"
            />
            <Slider
              label="Rot Y"
              value={safeRotation.y}
              min={-180}
              max={180}
              step={1}
              onChange={(v) => handleRotationChange('y', v)}
              unit="deg"
            />
            <Slider
              label="Rot Z"
              value={safeRotation.z}
              min={-180}
              max={180}
              step={1}
              onChange={(v) => handleRotationChange('z', v)}
              unit="deg"
            />
          </>
        )}
      </div>

      {/* Collection assignment */}
      <div className="props-section">
        <div className="section-header">Collection</div>
        <Dropdown
          label="Group"
          value={light.collectionId ?? '__none__'}
          options={[
            { value: '__none__', label: 'None' },
            { value: 'default', label: 'Default' },
            { value: 'key', label: 'Key Lights' },
            { value: 'fill', label: 'Fill Lights' },
            { value: 'rim', label: 'Rim Lights' },
          ]}
          onChange={(v) => handleUpdate({ collectionId: v === '__none__' ? null : v })}
        />
      </div>
    </div>
  );
};