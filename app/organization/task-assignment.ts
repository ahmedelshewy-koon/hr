/**
 * Who may hand a task to whom, derived from the organization levels.
 *
 * Level 0 is the department (or company) manager; 1 and above are the team,
 * where a larger number sits lower in the structure. A person can only assign
 * tasks downward: level 2 may assign to level 3 (or 4, 5, ...) but never to
 * level 1, and nobody assigns to their own level.
 *
 * Levels are numbered per department, so they are only compared within the same
 * department. A manager (level 0) additionally reaches everyone in the
 * departments nested beneath their own.
 */
export type TaskAssignmentParty = {
  level: number;
  departmentId: number | null;
};

export type TaskAssignmentDepartment = {
  id: number;
  parent_id: number | null;
};

const isValidLevel = (level: number) => Number.isInteger(level) && level >= 0;

function isDescendantDepartment(
  departmentId: number,
  ancestorId: number,
  departments: TaskAssignmentDepartment[],
) {
  const parentById = new Map(departments.map((department) => [Number(department.id), department.parent_id === null ? null : Number(department.parent_id)]));
  const visited = new Set<number>();
  let current = parentById.get(departmentId) ?? null;
  while (current !== null && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}

export function canAssignTask(
  assigner: TaskAssignmentParty,
  assignee: TaskAssignmentParty,
  departments: TaskAssignmentDepartment[] = [],
) {
  if (!isValidLevel(assigner.level) || !isValidLevel(assignee.level)) return false;
  if (assigner.departmentId === null || assignee.departmentId === null) return false;
  if (assigner.departmentId === assignee.departmentId) return assigner.level < assignee.level;
  return assigner.level === 0 && isDescendantDepartment(assignee.departmentId, assigner.departmentId, departments);
}
