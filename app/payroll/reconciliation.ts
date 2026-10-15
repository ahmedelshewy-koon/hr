type Row = Record<string, unknown>;
const verified = (row: Row | null | undefined) =>
  Boolean(row?.verified_by) && !row?.used_at && Boolean(String(row?.evidence_reference ?? "").trim());

/** Two different master administrators must record and verify external accounting evidence. */
export function mayVerifyReconciliation(row: Row, actorId: number) {
  return Number(row.submitted_by) !== actorId && !row.verified_by && actorId > 0;
}

export function mayResetErpAttempt(run: Row, reconciliation: Row | null | undefined) {
  return Boolean(run.erp_post_failed_at) && !run.sent_to_accounting_at && verified(reconciliation) &&
    ["not_posted", "voided"].includes(String(reconciliation?.outcome));
}

export function mayRollbackSentRun(run: Row, reconciliation: Row | null | undefined) {
  return Boolean(run.sent_to_accounting_at) && verified(reconciliation) && reconciliation?.outcome === "voided";
}
