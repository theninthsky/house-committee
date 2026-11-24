import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

// ===== Install prompt (Chrome / Edge / Android) =====

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  canInstall: boolean;
  needRefresh: boolean;
}

let state: PwaState = { canInstall: false, needRefresh: false };
let deferred: BeforeInstallPromptEvent | null = null;
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  set({ canInstall: true });
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  set({ canInstall: false });
});

export async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  set({ canInstall: false });
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ===== Service worker + update prompt =====

export function initPwa() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  updateSW = registerSW({
    onNeedRefresh: () => set({ needRefresh: true }),
    // check for a new version every hour while the app stays open
    onRegisteredSW: (_url, reg) => reg && setInterval(() => void reg.update(), 60 * 60 * 1000),
  });
}

export function applyUpdate() {
  void updateSW?.(true);
}

export function dismissUpdate() {
  set({ needRefresh: false });
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
