/**
 * The studio SET (the room the rig is photographed in) that goes with a built-in rig, read off its card:
 * most rigs sit in a dark studio with a glossy black floor that mirrors the panels; Cyc Wall White is a white infinity cove.
 */
export type RigSetKind = 'dark_floor' | 'cyc_white' | 'strip_tunnel' | 'high_key';

export const RIG_SETS: Record<string, RigSetKind> = {
  '3-Point Classic': 'dark_floor',
  'Beauty Soft': 'dark_floor',
  'High Key White': 'high_key',
  'Low Key Dramatic': 'dark_floor',
  'Fashion Editorial': 'dark_floor',
  'Product Hero': 'dark_floor',
  'Twin Softboxes': 'dark_floor',
  'Strip Tunnel': 'strip_tunnel',
  'Panel Ring': 'dark_floor',
  'Cyc Wall White': 'cyc_white',
  'Clamshell': 'dark_floor',
  'Butterfly': 'dark_floor',
  'Rembrandt': 'dark_floor',
  'Gradient Room': 'dark_floor',
  'Octa Overhead': 'dark_floor',
  'Wide Front Wash': 'dark_floor',
  'Light Grid': 'dark_floor',
  'Rim Only': 'dark_floor',
};
