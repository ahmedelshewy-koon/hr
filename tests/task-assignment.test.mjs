import assert from "node:assert/strict";
import test from "node:test";

import { canAssignTask } from "../app/organization/task-assignment.ts";

const party = (level, departmentId = 1) => ({ level, departmentId });

test("a level can only assign tasks to deeper levels of the same department", () => {
  assert.equal(canAssignTask(party(2), party(3)), true);
  assert.equal(canAssignTask(party(2), party(5)), true);
  assert.equal(canAssignTask(party(2), party(1)), false);
  assert.equal(canAssignTask(party(2), party(2)), false);
});

test("the manager at level 0 can assign to every level of their department", () => {
  for (const level of [1, 2, 3, 20]) assert.equal(canAssignTask(party(0), party(level)), true);
  assert.equal(canAssignTask(party(1), party(0)), false);
});

test("a manager reaches nested departments but nobody else crosses departments", () => {
  const departments = [
    { id: 1, parent_id: null },
    { id: 2, parent_id: 1 },
    { id: 3, parent_id: 2 },
    { id: 4, parent_id: null },
  ];
  assert.equal(canAssignTask(party(0, 1), party(0, 2), departments), true);
  assert.equal(canAssignTask(party(0, 1), party(4, 3), departments), true);
  assert.equal(canAssignTask(party(0, 2), party(1, 1), departments), false);
  assert.equal(canAssignTask(party(0, 1), party(1, 4), departments), false);
  assert.equal(canAssignTask(party(1, 1), party(9, 2), departments), false);
});

test("missing or invalid levels and departments never grant assignment", () => {
  assert.equal(canAssignTask(party(1, null), party(2, null)), false);
  assert.equal(canAssignTask(party(-1), party(2)), false);
  assert.equal(canAssignTask(party(1), party(1.5)), false);
});

test("a department cycle in bad data does not hang the check", () => {
  const cyclic = [
    { id: 1, parent_id: 2 },
    { id: 2, parent_id: 1 },
  ];
  assert.equal(canAssignTask(party(0, 3), party(1, 1), cyclic), false);
});
