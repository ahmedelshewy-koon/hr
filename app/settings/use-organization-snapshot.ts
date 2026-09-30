"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Row } from '../ui-types';
import type { OrganizationCatalog } from '../organization/assignment-policy.ts';
import { onHrDataChanged } from '../organization/latest-loader.ts';
import { organizationSettingsAccess, type HrScopeCount, type UsageIndex } from '../organization/settings-model.ts';

export type OrganizationSnapshot = {
  catalog: OrganizationCatalog;
  usage: UsageIndex;
  occupants: Record<string, Row[]>;
  hrScopes: HrScopeCount[];
  legacyWorkLocations: { text: string; employees: number }[];
  /** HR responsibility resolver inputs from the same snapshot. */
  hrRoster: Row[];
  hrEmployees: Row[];
  unlinkedHrAccounts: Row[];
};
export type SnapshotStatus = 'loading' | 'ready' | 'unavailable' | 'error';

/** Permission hook for Organizational Structure Settings; keeps UI gating identical to the server's rules. */
export function useOrganizationAccess(user: Row | null | undefined, permissions: Row[] | null | undefined) {
  return useMemo(() => organizationSettingsAccess(user, permissions), [user, permissions]);
}

/**
 * One repeatable-read snapshot from the server: catalog, authoritative usage counts, position occupants and HR
 * routing counts. The latest request wins so a slow response can never overwrite a newer one.
 */
export function useOrganizationSnapshot(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [status, setStatus] = useState<SnapshotStatus>('loading');
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const response = await fetch('/api/organization', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (request !== latest.current) return;
      if (response.status === 401) window.dispatchEvent(new Event('portal-session-expired'));
      if (!response.ok) { setStatus('error'); return; }
      if (!body.ready) { setSnapshot(null); setStatus('unavailable'); return; }
      setSnapshot({ catalog: body.catalog, usage: body.usage ?? {}, occupants: body.occupants ?? {}, hrScopes: body.hrScopes ?? [], legacyWorkLocations: body.legacyWorkLocations ?? [], hrRoster: body.hrRoster ?? [], hrEmployees: body.hrEmployees ?? [], unlinkedHrAccounts: body.unlinkedHrAccounts ?? [] });
      setStatus('ready');
    } catch {
      if (request === latest.current) setStatus('error');
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const requests = latest;
    const timer = window.setTimeout(() => void load(), 0);
    // Employee company/branch/override changes elsewhere move HR counts; refresh without a browser reload.
    const stop = onHrDataChanged(window, () => void load());
    return () => { window.clearTimeout(timer); stop(); ++requests.current; };
  }, [enabled, load]);
  return { snapshot, status, reload: load };
}

/** Lets other screens (for example the retired Departments tab) open a specific Settings section. */
let requestedSection: string | null = null;
export const requestOrganizationSection = (section: string) => { requestedSection = section; };
export const consumeOrganizationSection = () => { const section = requestedSection; requestedSection = null; return section; };
