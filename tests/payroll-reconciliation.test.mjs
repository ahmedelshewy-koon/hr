import test from "node:test";
import assert from "node:assert/strict";
import { mayVerifyReconciliation, mayResetErpAttempt, mayRollbackSentRun } from "../app/payroll/reconciliation.ts";

test("one admin cannot verify their own accounting reconciliation", () => {
  assert.equal(mayVerifyReconciliation({submitted_by:7,verified_by:null},7),false);
  assert.equal(mayVerifyReconciliation({submitted_by:7,verified_by:null},8),true);
});

test("failed posting can retry only after independent verified evidence that invoices are absent or voided", () => {
  const run={erp_post_failed_at:"2026-10-13",sent_to_accounting_at:null};
  assert.equal(mayResetErpAttempt(run,null),false);
  assert.equal(mayResetErpAttempt(run,{outcome:"not_posted",verified_by:null}),false);
  assert.equal(mayResetErpAttempt(run,{outcome:"not_posted",verified_by:8,evidence_reference:"ERP-42"}),true);
  assert.equal(mayResetErpAttempt(run,{outcome:"posted",verified_by:8,evidence_reference:"ERP-42"}),false);
});

test("sent run rollback requires a verified ERP reversal reference", () => {
  const run={sent_to_accounting_at:"2026-10-13"};
  assert.equal(mayRollbackSentRun(run,{outcome:"voided",verified_by:null,evidence_reference:"VOID-1"}),false);
  assert.equal(mayRollbackSentRun(run,{outcome:"not_posted",verified_by:8,evidence_reference:"VOID-1"}),false);
  assert.equal(mayRollbackSentRun(run,{outcome:"voided",verified_by:8,evidence_reference:"VOID-1"}),true);
});
