import { withDatabase } from '../../../route-helpers';
import { enforceWriteOrigin, requireActor, requirePermission } from '../../../api-security';
import { body } from '../../../../talent/talent-service';
import { assertEmployeeManager } from '../../../../employees/hr-assignment';
import { branchHrCanSee, isBranchScopedHr } from '../../../../employees/hr-data-scope';
import { deleteContact, endInsurance, saveContact, saveInsurance, savePersonal } from '../../../../employees/profile-extras';

/**
 * Personal details for the profile Overview: HR (Super Admin / HR Manager within scope), the employee themself or their direct manager.
 * Kept out of the general profile API. HR notes: HR only.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return withDatabase('Unable to load personal details', async db => {
  const actor = await requireActor(request, db), employeeId = Number((await context.params).id);
  const self = Number(actor.employeeId) === employeeId, hr = ['Super Admin', 'HR Manager'].includes(actor.roleName);
  const manager = !self && !hr && await assertEmployeeManager(db, employeeId, Number(actor.employeeId) || null).then(() => true, () => false);
  if (!self && !hr && !manager) throw new Response('Personal details are restricted', { status: 403 });
  if (!self && isBranchScopedHr(actor) && !await branchHrCanSee(db, actor, employeeId)) throw new Response('Employee is outside your access scope', { status: 403 });
  const ready = Boolean((await db.prepare("SELECT to_regclass('public.employee_job_history') AS name").first<{ name: string | null }>())?.name);
  const row = await db.prepare(`SELECT birth_date,gender,nationality,religion,identification_number,passport_number,address,personal_phone${ready ? ',marital_status' : ''}${ready && hr ? ',profile_notes' : ''} FROM employees WHERE id=? AND employment_status<>'deleted'`).bind(employeeId).first();
  if (!row) throw new Response('Employee not found', { status: 404 });
  return Response.json({ personal: row }, { headers: { 'cache-control': 'no-store' } });
}); }

/**
 * Profile extras written from the employee profile: emergency contacts, medical insurance, marital status and notes.
 * HR only (Super Admin / HR Manager with employees:edit); a branch HR only for employees it is responsible for.
 * action: save_contact | delete_contact | save_insurance | end_insurance | save_personal
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return withDatabase('Unable to save employee profile', async db => {
  enforceWriteOrigin(request);
  const actor = await requireActor(request, db), employeeId = Number((await context.params).id);
  if (!['Super Admin', 'HR Manager'].includes(actor.roleName)) throw new Response('Only HR can edit employee profiles', { status: 403 });
  await requirePermission(db, actor, 'employees', 'edit');
  if (isBranchScopedHr(actor) && !await branchHrCanSee(db, actor, employeeId)) throw new Response('Employee is outside your access scope', { status: 403 });
  if (!await db.prepare("SELECT id FROM employees WHERE id=? AND employment_status<>'deleted'").bind(employeeId).first()) throw new Response('Employee not found', { status: 404 });
  const input = await body(request), action = String(input.action || ''), record = (input.record && typeof input.record === 'object' ? input.record : {}) as Record<string, unknown>;
  const result = await db.transaction(async tx => {
    if (action === 'save_contact') return { contact: await saveContact(tx, employeeId, record, actor.id) };
    if (action === 'delete_contact') { await deleteContact(tx, employeeId, Number(record.id), actor.id); return {}; }
    if (action === 'save_insurance') return { insurance: await saveInsurance(tx, employeeId, record, actor.id) };
    if (action === 'end_insurance') { await endInsurance(tx, employeeId, actor.id); return {}; }
    if (action === 'save_personal') return { personal: await savePersonal(tx, employeeId, record, actor.id) };
    throw new Response('Unknown action', { status: 400 });
  });
  return Response.json({ ok: true, ...result });
}); }
