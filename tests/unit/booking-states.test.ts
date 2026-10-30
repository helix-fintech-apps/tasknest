import {
  canTransition,
  OPEN_STATUSES,
  SLOT_HOLDING_STATUSES,
  type BookingStatus,
} from "../../supabase/functions/_shared/domain/index.ts";

describe("booking state machine with pending_payment (docs/contracts.md 4.2)", () => {
  it("pending_payment becomes requested once paid, or payment_abandoned", () => {
    expect(canTransition("pending_payment", "requested")).toBe(true);
    expect(canTransition("pending_payment", "payment_abandoned")).toBe(true);
  });

  it("nothing else is reachable from pending_payment, and payment_abandoned is final", () => {
    for (const to of [
      "accepted",
      "declined",
      "canceled_client",
      "canceled_tasker",
      "in_progress",
      "completed",
    ] as BookingStatus[]) {
      expect(canTransition("pending_payment", to)).toBe(false);
    }
    expect(canTransition("payment_abandoned", "requested")).toBe(false);
    expect(canTransition("requested", "payment_abandoned")).toBe(false);
    expect(canTransition("requested", "pending_payment")).toBe(false);
  });

  it("existing transitions are unchanged", () => {
    expect(canTransition("requested", "accepted")).toBe(true);
    expect(canTransition("requested", "declined")).toBe(true);
    expect(canTransition("accepted", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
    expect(canTransition("completed", "disputed")).toBe(true);
    expect(canTransition("completed", "requested")).toBe(false);
  });

  it("the slot-holding statuses match the bookings_no_double_slot index", () => {
    expect([...SLOT_HOLDING_STATUSES].sort()).toEqual(
      ["accepted", "in_progress", "pending_payment", "requested"].sort(),
    );
    expect(OPEN_STATUSES).toContain("pending_payment");
  });
});
