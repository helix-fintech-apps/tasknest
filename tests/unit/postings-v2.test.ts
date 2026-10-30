// Ledger postings added for the marketplace (plan 7.2). Each must balance (txn() throws otherwise) and move
// the right accounts.

import {
  disputeCounteredTxn,
  disputeLostAfterOpenTxn,
  disputeLostTxn,
  disputeOpenedTxn,
  disputeWonTxn,
  refundFailedTxn,
  stripeFeeTxn,
  tipRefundTxn,
  transferReversalTxn,
} from "../../supabase/functions/_shared/postings.ts";
import type { Txn } from "../../supabase/functions/_shared/domain/index.ts";

const B = "b0000000-0000-4000-8000-000000000001";
const TASKER = "a0000000-0000-4000-8000-000000000011";
const CLIENT = "a0000000-0000-4000-8000-000000000001";

const net = (t: Txn | null, account: string, party?: string) =>
  (t?.lines ?? [])
    .filter((l) => l.account === account && (party === undefined || l.party === party))
    .reduce((a, l) => a + l.credit - l.debit, 0);

describe("processing fees", () => {
  it("books the fee out of card_clearing", () => {
    const t = stripeFeeTxn(B, 335)!;
    expect(t.kind).toBe("stripe_fee");
    expect(net(t, "stripe_fees")).toBe(-335);
    expect(net(t, "card_clearing")).toBe(335);
  });
  it("posts nothing for a zero fee", () => {
    expect(stripeFeeTxn(B, 0)).toBeNull();
  });
});

describe("dispute lifecycle with money booked when the funds are withdrawn", () => {
  const amount = 10_350;
  const fee = 1_500;

  it("open: the amount and the fee leave the Stripe balance", () => {
    const t = disputeOpenedTxn(B, amount, fee);
    expect(net(t, "card_clearing")).toBe(amount + fee);
    expect(net(t, "dispute_hold")).toBe(-amount);
    expect(net(t, "dispute_fees")).toBe(-fee);
  });

  it("won: the amount comes back; the first fee does not; a countered fee does", () => {
    const open = disputeOpenedTxn(B, amount, fee);
    const countered = disputeCounteredTxn(B, 1_500)!;
    const won = disputeWonTxn(B, amount, 1_500);
    // net over the whole life: only the first fee is lost
    const all = [open, countered, won];
    expect(all.reduce((a, t) => a + net(t, "card_clearing"), 0)).toBe(fee);
    expect(all.reduce((a, t) => a + net(t, "dispute_hold"), 0)).toBe(0);
    expect(all.reduce((a, t) => a + net(t, "dispute_fees"), 0)).toBe(-fee);
  });

  it("won without a countered fee reinstates only the amount", () => {
    const won = disputeWonTxn(B, amount, 0);
    expect(net(won, "card_clearing")).toBe(-amount);
    expect(net(won, "dispute_fees")).toBe(0);
  });

  it("lost: the hold is released into the tasker's share and the platform's loss", () => {
    const t = disputeLostAfterOpenTxn(
      B,
      CLIENT,
      TASKER,
      { heldCents: amount, recover: 7_650 },
      0,
      1,
    );
    expect(net(t, "dispute_hold")).toBe(amount);
    expect(net(t, "tasker_payable", TASKER)).toBe(-7_650);
    expect(net(t, "dispute_loss")).toBe(-(amount - 7_650));
    expect(net(t, "card_clearing")).toBe(0); // the cash already left at open
  });

  it("lost, whole life: same total cost as the legacy single posting (reversed amount + fee)", () => {
    const open = disputeOpenedTxn(B, amount, fee);
    const lost = disputeLostAfterOpenTxn(
      B,
      CLIENT,
      TASKER,
      { heldCents: amount, recover: 7_650 },
      0,
      1,
    );
    const legacy = disputeLostTxn(
      B,
      CLIENT,
      TASKER,
      { reversed: amount, fee, recover: 7_650, platformLoss: amount - 7_650 + fee },
      0,
      1,
    );
    for (const account of ["card_clearing", "tasker_payable"]) {
      expect(net(open, account, undefined) + net(lost, account, undefined)).toBe(
        net(legacy, account, undefined),
      );
    }
    const loss = (t: Txn) => net(t, "dispute_loss") + net(t, "dispute_fees");
    expect(loss(open) + loss(lost)).toBe(loss(legacy));
  });

  it("countered fee of zero posts nothing", () => {
    expect(disputeCounteredTxn(B, 0)).toBeNull();
  });
});

describe("refund_failed reverses the card part of a refund", () => {
  it("card-only refund: the whole clawback comes back to the tasker", () => {
    const t = refundFailedTxn(B, TASKER, {
      cardCents: 5_000,
      totalCents: 5_000,
      taskerClawbackCents: 3_800,
    });
    expect(net(t, "card_clearing")).toBe(-5_000);
    expect(net(t, "tasker_payable", TASKER)).toBe(3_800);
    expect(net(t, "refund_expense")).toBe(1_200);
  });

  it("mixed refund: the clawback is reversed pro rata (rounded down)", () => {
    const t = refundFailedTxn(B, TASKER, {
      cardCents: 4_000,
      totalCents: 10_000,
      taskerClawbackCents: 7_650,
    });
    expect(net(t, "tasker_payable", TASKER)).toBe(Math.floor((7_650 * 4_000) / 10_000));
    expect(net(t, "card_clearing")).toBe(-4_000);
    expect(net(t, "refund_expense") + net(t, "tasker_payable", TASKER)).toBe(4_000);
  });
});

describe("tip refunds and transfer reversals", () => {
  it("tip_refund takes the whole tip back from the tasker's payable", () => {
    const t = tipRefundTxn(B, TASKER, 500);
    expect(net(t, "tasker_payable", TASKER)).toBe(-500);
    expect(net(t, "card_clearing")).toBe(500);
  });

  it("transfer_reversal makes the tasker's payable whole again", () => {
    const t = transferReversalTxn(TASKER, 2_462);
    expect(net(t, "tasker_payable", TASKER)).toBe(2_462);
    expect(net(t, "payouts_clearing", TASKER)).toBe(-2_462);
  });
});
