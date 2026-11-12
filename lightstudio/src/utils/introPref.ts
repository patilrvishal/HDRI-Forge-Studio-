const KEY = 'lightforge.introEnabled';

/** Whether the startup intro video plays (on by default). */
export function isIntroEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setIntroEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // storage unavailable: the intro simply keeps playing
  }
}
