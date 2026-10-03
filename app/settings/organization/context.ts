"use client";
import { createContext, useContext } from 'react';
import type { Row } from '../../ui-types';
import type { OrganizationCatalog } from '../../organization/assignment-policy.ts';
import type { HrScopeCount, OrganizationAccess, UsageIndex } from '../../organization/settings-model.ts';
import type { ImpactPreview } from './impact-review';

export type OrganizationSettingsValue = {
  rtl: boolean;
  access: OrganizationAccess;
  catalog: OrganizationCatalog;
  /** Authoritative server counts; display and lock hints only, never authorization. */
  usage: UsageIndex;
  occupants: Record<string, Row[]>;
  hrScopes: HrScopeCount[];
  /** HR resolver inputs from the Settings snapshot (roster with eligibility, employees, unlinked HR accounts). */
  hrRoster?: Row[];
  hrEmployees?: Row[];
  unlinkedHrAccounts?: Row[];
  legacyWorkLocations: { text: string; employees: number }[];
  employees: Row[];
  hrResponsibles: Row[];
  hrCandidates: Row[];
  /** POST /api/organization; reloads the snapshot and rejects with a localized message on failure. */
  saveEntity: (entity: string, record: Row) => Promise<void>;
  saveJobTitle: (payload: Row) => Promise<void>;
  /** Server impact preview (no write). Same validation and plan as the save. */
  previewEntity: (entity: string, record: Row) => Promise<ImpactPreview>;
  previewJobTitle: (payload: Row) => Promise<ImpactPreview>;
  /** Permanent delete of an unreferenced record; referenced records must be deactivated. */
  deleteEntity: (entity: string, id: unknown) => Promise<void>;
  /** Super Admin only: deletes a unit (with its sub-units), position or job title even when in use, clearing references. */
  forceDeleteEntity: (entity: string, id: unknown) => Promise<void>;
  saveHrResponsible: (payload: Row) => Promise<void>;
  saveHrAssignment: (companyId: string, branchId: string, employeeId: string, hrDataScope?: string) => Promise<Row>;
  goTo: (section: string) => void;
};

export const OrganizationSettingsContext = createContext<OrganizationSettingsValue | null>(null);
export function useOrganization(): OrganizationSettingsValue {
  const value = useContext(OrganizationSettingsContext);
  if (!value) throw new Error('useOrganization must be used inside OrganizationSettings');
  return value;
}

export const CURRENT_STATUSES = ['active', 'probation', 'notice_period'];
