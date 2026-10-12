"use client";

import { useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let registered = false;

function notify() {
  listeners.forEach((l) => l());
}

/** Registers the service worker (production only) and captures the install prompt. */
function setup() {
  if (registered || typeof window === "undefined") return;
  registered = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  if (!("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV === "production") {
    const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  } else {
    // Avoid stale caches while developing.
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
  }
}

interface PwaEnv {
  standalone: boolean;
  ios: boolean;
}
const SERVER_ENV: PwaEnv = { standalone: false, ios: false };
let envCache: PwaEnv | null = null;
function getEnv(): PwaEnv {
  if (!envCache) {
    const nav = navigator as Navigator & { standalone?: boolean };
    envCache = {
      standalone: window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || nav.standalone === true,
      ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
    };
  }
  return envCache;
}

function subscribe(listener: () => void) {
  setup();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePwa() {
  const hasPrompt = useSyncExternalStore(subscribe, () => deferred !== null, () => false);
  const env = useSyncExternalStore(subscribe, getEnv, () => SERVER_ENV);
  return {
    canInstall: hasPrompt && !env.standalone,
    /** iOS Safari has no install prompt; show a manual hint instead. */
    showIosHint: env.ios && !env.standalone,
    async install() {
      if (!deferred) return;
      const ev = deferred;
      deferred = null;
      await ev.prompt();
      await ev.userChoice.catch(() => undefined);
      notify();
    },
  };
}
