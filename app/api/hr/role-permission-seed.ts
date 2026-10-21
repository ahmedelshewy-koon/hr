/**
 * Role-permission seeding done by the runtime reseed (ensureSeed, when system_settings.seed_version differs from the
 * release's SEED_VERSION). Insert-only: it fills (role, module, action) keys that do not exist yet and never changes an
 * existing row, so permissions customized in the Permissions screen, explicit denials and grants written by reviewed
 * migrations survive any SEED_VERSION bump. Changing an existing role's access belongs in a reviewed migration.
 */
export const SEED_PERMISSION_SQL =
  "INSERT INTO permissions (role_id,module,action,allowed) VALUES (?,?,?,?) ON CONFLICT(role_id,module,action) DO NOTHING";

export type SeedPermissionRow = [roleId: number, module: string, action: string, allowed: 0 | 1];

/** One row per module and action: allowed=1 for the default actions, an explicit 0 for the rest. */
export function seedPermissionRows(roleId: number, moduleDefaults: Record<string, readonly string[]>, actions: readonly string[]): SeedPermissionRow[] {
  return Object.entries(moduleDefaults).flatMap(([module, allowed]) =>
    actions.map(action => [roleId, module, action, allowed.includes(action) ? 1 : 0] as SeedPermissionRow));
}
