const STORAGE_KEY = 'bb_sound_muted';

let muted = readMuted();
let clip: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isSoundMuted() {
  return muted;
}

export function setSoundMuted(next: boolean) {
  muted = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    /* ignore private browsing */
  }
  listeners.forEach((listener) => listener());
}

export function subscribeSoundMuted(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function pageClip() {
  if (!clip) {
    clip = new Audio('/page-flip-01a.mp3');
    clip.preload = 'auto';
  }
  return clip;
}

/** Plays the recorded page flip. Restarts if another page is turned mid-clip. */
export function playPageTurn() {
  if (muted) return;
  const sound = pageClip();
  sound.currentTime = 0;
  void sound.play().catch(() => {});
}
