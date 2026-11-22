import React, { useState } from 'react';
import { LightingPresetCard } from './LightingPresetCard';

const PRESETS = [
  { title: 'High Key White', lightCount: 4, imageSrc: '/rigcards/high_key_white.png' },
  { title: 'Low Key Dramatic', lightCount: 3, imageSrc: '/rigcards/low_key_dramatic.png' },
  { title: 'Beauty Soft', lightCount: 3, imageSrc: '/rigcards/beauty_soft.png' },
];

/** A small grid showing the card in its default, hover and selected states (click a card to select it). */
export const LightingPresetCardExample: React.FC = () => {
  const [selected, setSelected] = useState('High Key White');
  return (
    <div className="min-h-screen bg-[#0B0D10] p-8">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {PRESETS.map((p) => (
          <LightingPresetCard key={p.title} {...p} selected={selected === p.title} onClick={() => setSelected(p.title)} />
        ))}
      </div>
    </div>
  );
};

export default LightingPresetCardExample;
