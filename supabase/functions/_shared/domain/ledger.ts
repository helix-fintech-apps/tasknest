// Double-entry ledger. Every money event posts lines whose debits equal credits, per unit
// (USD cents and loyalty POINTS are separate units).

export type Unit = "USD" | "POINTS";

export type Account =
  | "client_funds_held"      // money collected from clients, not yet earned
  | "card_clearing"          // card processor clearing
  | "platform_revenue"
  | "tasker_payable"         // owed to taskers (sub-ledger by tasker id)
  | "tips_payable"
  | "tax_payable"
  | "points_liability"       // USD value of points outstanding
  | "promo_expense"
  | "wallet_liability"
  | "refund_expense"
  | "dispute_loss"
  | "payouts_clearing"
  | "points_outstanding"     // POINTS unit
  | "points_issued";         // POINTS unit

export interface Line { account: Account; party?: string; unit: Unit; debit: number; credit: number }

export interface Txn { kind: string; bookingId?: string; lines: Line[] }

export function assertBalanced(txn: Txn): void {
  const byUnit = new Map<Unit, number>();
  for (const l of txn.lines) {
    if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit) || l.debit < 0 || l.credit < 0) {
      throw new Error(`invalid line amounts in ${txn.kind}`);
    }
    byUnit.set(l.unit, (byUnit.get(l.unit) ?? 0) + l.debit - l.credit);
  }
  for (const [unit, net] of byUnit) {
    if (net !== 0) throw new Error(`unbalanced ${txn.kind}: ${unit} off by ${net}`);
  }
}

export const dr = (account: Account, amount: number, party?: string, unit: Unit = "USD"): Line => ({ account, party, unit, debit: amount, credit: 0 });
export const cr = (account: Account, amount: number, party?: string, unit: Unit = "USD"): Line => ({ account, party, unit, debit: 0, credit: amount });

export function txn(kind: string, lines: Line[], bookingId?: string): Txn {
  const t = { kind, bookingId, lines: lines.filter((l) => l.debit !== 0 || l.credit !== 0) };
  assertBalanced(t);
  return t;
}
