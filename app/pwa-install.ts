"use client";

import { useSyncExternalStore } from "react";

// Chrome/Edge/Samsung fire `beforeinstallprompt` once, possibly before any menu
// mounts, so it is captured at registration time and kept here.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallMode = "prompt" | "ios" | "manual" | "installed" | "none";

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export function captureInstallEvents() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isMobile() {
  return isIos() || /android/i.test(navigator.userAgent);
}

function currentMode(): InstallMode {
  if (installed || isStandalone()) return "installed";
  if (deferred) return "prompt";
  if (isIos()) return "ios";
  // Android over plain HTTP (LAN) never gets the native prompt; the browser
  // menu's "Add to Home screen" still works.
  if (isMobile()) return "manual";
  return "none";
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener); },
    currentMode,
    () => "none",
  );
}

export async function promptInstall() {
  const event = deferred;
  if (!event) return;
  deferred = null;
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === "accepted") installed = true;
  emit();
}
