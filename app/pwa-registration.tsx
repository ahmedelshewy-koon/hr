"use client";

import { useEffect } from "react";
import { captureInstallEvents } from "./pwa-install";

export function PwaRegistration() {
  useEffect(() => {
    captureInstallEvents();
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installation is optional; the online application remains usable.
      });
    }
  }, []);
  return null;
}
