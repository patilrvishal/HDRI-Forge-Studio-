import type { ModelingController } from './ModelingController';

let current: ModelingController | null = null;

/** Lets code outside the viewport (menus, scene save/load) reach the live controller. */
export function setModelingController(c: ModelingController | null): void {
  current = c;
  if (import.meta.env.DEV) (window as unknown as { __modeling?: ModelingController | null }).__modeling = c;
}

export function getModelingController(): ModelingController | null {
  return current;
}
