// Money helpers. All amounts are integer minor units (cents). Never use floats for money.

export type Cents = number;

export function assertCents(n: number, label = "amount"): Cents {
  if (!Number.isInteger(n)) throw new Error(`${label} must be integer cents, got ${n}`);
  return n;
}

/** Integer division rounded half-up. Both inputs must be non-negative integers. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error("denominator must be positive");
  if (numerator < 0) return -divRoundHalfUp(-numerator, denominator);
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Apply basis points (1 bp = 0.01%) to an amount, rounding half-up. */
export function applyBps(amount: Cents, bps: number): Cents {
  return divRoundHalfUp(amount * bps, 10_000);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function formatCents(c: Cents, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(c / 100);
}
