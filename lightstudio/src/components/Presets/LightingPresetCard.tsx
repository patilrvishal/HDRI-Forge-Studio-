import React from 'react';

export interface LightingPresetCardProps {
  title: string;
  lightCount: number;
  imageSrc: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

/** A simple white line icon of a four-light studio set-up: two ceiling panels over two stand lights. */
const FourLightIcon: React.FC = () => (
  <svg viewBox="0 0 64 56" className="h-full w-full" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="19" y="3" width="26" height="8" rx="3" />
    <rect x="25" y="14" width="14" height="5" rx="2.5" />
    <path d="M32 19v5M32 24L16 36M32 24l16 12" />
    <rect x="7" y="34" width="14" height="14" rx="3" transform="rotate(-24 14 41)" />
    <rect x="43" y="34" width="14" height="14" rx="3" transform="rotate(24 50 41)" />
  </svg>
);

/**
 * A selectable lighting-preset card: studio preview on top (74%), a dark information panel below (26%).
 * Keeps a 560:352 aspect ratio at every size and scales its radius, text and padding with the card width.
 */
export const LightingPresetCard: React.FC<LightingPresetCardProps> = ({ title, lightCount, imageSrc, selected = false, onClick, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    aria-label={`${title}, ${lightCount} ${lightCount === 1 ? 'light' : 'lights'}${selected ? ', selected' : ''}`}
    // container-type makes `cqw` units follow the card's own width, so the radius and text scale with it
    style={{ aspectRatio: '560 / 352', containerType: 'inline-size', borderRadius: '5.357cqw' } as React.CSSProperties}
    className={[
      'group relative block w-full overflow-hidden border bg-[#171D24] p-0 text-left',
      'transition-[transform,box-shadow,border-color] duration-200 ease-out',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E0A64B] focus-visible:ring-offset-2 focus-visible:ring-offset-black',
      selected
        ? 'border-[#D9A441] shadow-[0_0_0_1px_#D9A441,0_0_22px_rgba(217,164,65,0.35)]'
        : 'border-[#A8772B] shadow-[0_2px_8px_rgba(0,0,0,0.45)] hover:-translate-y-0.5 hover:border-[#C48F37] hover:shadow-[0_10px_26px_rgba(0,0,0,0.6)]',
      selected ? '' : 'hover:-translate-y-[3px]',
      className,
    ].join(' ')}
  >
    <img src={imageSrc} alt="" draggable={false} className="block w-full object-cover" style={{ height: '74%' }} />
    <div className="absolute inset-x-0 bottom-0 flex items-center bg-[#171D24]" style={{ height: '26%', padding: '0 6.07cqw' }}>
      <div className="shrink-0" style={{ width: '9.5cqw', height: '8.4cqw' }}>
        <FourLightIcon />
      </div>
      <div className="shrink-0 bg-[#96A0AA]" style={{ width: '1px', height: '58%', margin: '0 4.6cqw' }} />
      <div className="min-w-0">
        <div className="truncate font-bold leading-tight text-white" style={{ fontSize: '5.54cqw', fontFamily: 'Inter, Geist, system-ui, sans-serif' }}>{title}</div>
        <div className="leading-tight text-[#CDD1D6]" style={{ fontSize: '3.39cqw', fontFamily: 'Inter, Geist, system-ui, sans-serif' }}>
          {lightCount} {lightCount === 1 ? 'light' : 'lights'}
        </div>
      </div>
    </div>
  </button>
);

export default LightingPresetCard;
