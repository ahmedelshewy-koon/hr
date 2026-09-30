/**
 * "Latest request wins" loading: every call gets a version; a response (or failure) is applied only while its
 * version is still the newest, so a slow earlier response can never overwrite newer data. `cancel()` also bumps
 * the version, which discards anything still in flight (e.g. after unmount).
 */
export function createLatestLoader<T>(fetcher: () => Promise<T>, apply: (value: T) => void, fail: (error: unknown) => void = () => {}) {
  let latest = 0;
  return {
    async load() {
      const version = ++latest;
      try { const value = await fetcher(); if (version === latest) apply(value); }
      catch (error) { if (version === latest) fail(error); }
    },
    cancel() { ++latest; },
  };
}

/** The application-wide refresh signal fired after employee, team-transfer and organization-settings writes. */
export const HR_DATA_CHANGED = 'hr-data-changed';
export function onHrDataChanged(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, refresh: () => void): () => void {
  target.addEventListener(HR_DATA_CHANGED, refresh);
  return () => target.removeEventListener(HR_DATA_CHANGED, refresh);
}
