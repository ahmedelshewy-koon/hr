export function validateWfhTransition(
  action: "check_in" | "check_out" | "force_checkout",
  open: { checked_in_at: string } | null,
  at: Date,
) {
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid checkout time");
  if (action === "check_in") {
    if (open) throw new Error("A WFH session is already open");
    return true;
  }
  if (!open) throw new Error("No open WFH session");
  if (at.getTime() <= Date.parse(open.checked_in_at)) throw new Error("Checkout must be after check-in");
  return true;
}
