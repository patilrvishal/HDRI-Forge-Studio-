/** Designed card artwork (sphere render, name and tile) for built-in environments; others fall back to the generated globe. */
export const ENV_CARDS: Record<string, string> = {
  'studio-neutral': '/envcards/studio-neutral.png',
  'studio-warm': '/envcards/studio-warm.png',
  'studio-cool': '/envcards/studio-cool.png',
  'studio-dramatic': '/envcards/studio-dramatic.png',
  'studio-ring': '/envcards/studio-ring.png',
  'studio-movie': '/envcards/studio-movie.png',
};

/** Icons in the All / Studio / Outdoor / Creative pills (white idle, orange active). */
export const ENV_PILL_ICONS: Record<string, string> = { all: 'env_all', studio: 'env_studio', outdoor: 'env_outdoor', creative: 'env_creative' };
