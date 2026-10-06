import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_MODULES, filterAvailablePages } from '../app/page-availability.ts';
import { normalizePageOrder, movePage, orderPages, validatePageOrder } from '../app/page-order.ts';

test('saved ordering keeps known pages once and appends new pages', () => {
  const order = normalizePageOrder(['settings', 'employees', 'settings', 'unknown']);
  assert.deepEqual(order.slice(0, 3), ['settings', 'employees', 'dashboard']);
  assert.equal(order.length, Object.keys(PAGE_MODULES).length);
  assert.deepEqual(normalizePageOrder(null), Object.keys(PAGE_MODULES));
});
test('moving pages works both ways without losing or duplicating entries', () => {
  assert.deepEqual(movePage(['dashboard', 'employees', 'settings'], 'settings', 'dashboard'), ['settings', 'dashboard', 'employees']);
  assert.deepEqual(movePage(['dashboard', 'employees', 'settings'], 'dashboard', 'settings'), ['employees', 'settings', 'dashboard']);
  assert.deepEqual(movePage(['dashboard', 'settings'], 'unknown', 'settings'), ['dashboard', 'settings']);
});
test('ordering only reorders granted visible pages and never grants access', () => {
  const visible = filterAvailablePages(['dashboard', 'employees', 'settings'], 'Employee', { employees: false });
  assert.deepEqual(orderPages(visible, ['settings', 'employees', 'dashboard']), ['dashboard']);
  assert.deepEqual(orderPages(['dashboard', 'employees'], ['employees', 'dashboard']), ['employees', 'dashboard']);
});
test('only a super administrator may save an exact permutation of known pages', () => {
  const all = Object.keys(PAGE_MODULES).reverse();
  assert.deepEqual(validatePageOrder('Super Admin', all), all);
  assert.throws(() => validatePageOrder('HR Manager', all), e => e.status === 403);
  for (const bad of [null, {}, all.slice(1), [...all, 'unknown'], all.map(() => 'dashboard')]) {
    assert.throws(() => validatePageOrder('Super Admin', bad), e => e.status === 400);
  }
});
