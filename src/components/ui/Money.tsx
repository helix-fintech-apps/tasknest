import type { HTMLAttributes } from "react";
import { formatCents } from "@domain";

export const MONEY_KINDS = [
  "subtotal",
  "service_fee",
  "tax",
  "total",
  "promo",
  "points",
  "wallet",
  "card_hold",
  "card_charge",
  "card_capture",
  "released",
  "extras",
  "expenses",
  "tip",
  "refund",
  "refund_pending",
  "tasker_net",
  "commission",
  "fee",
  "balance",
  "transfer",
  "bank_payout",
  "dispute_amount",
  "dispute_fee",
] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];
export type MoneyTender = "card" | "wallet" | "points" | "promo";
export type MoneySource = "server" | "browser";

export interface MoneyProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Integer cents. Never a float. A negative value renders with a minus sign. */
  cents: number;
  kind: MoneyKind;
  tender?: MoneyTender;
  /** Where the number came from. "browser" marks a preview shown while the server one loads. */
  source?: MoneySource;
  policyVersion?: number;
  /** `minus` shows a positive amount as a deduction; `plus` forces a leading +. */
  sign?: "auto" | "minus" | "plus";
  testId?: string;
}

/**
 * Renders an amount with machine-readable attributes, so tests (and Helix) can assert exact cents:
 *   <span data-money-cents="8350" data-money-kind="card_hold" data-source="server">$83.50</span>
 * `data-money-cents` is the magnitude; a negative display adds `data-money-sign="minus"`.
 * The minus sign is U+2212 with aria-label "minus". All money is tabular-nums.
 */
export function Money({
  cents,
  kind,
  tender,
  source = "server",
  policyVersion,
  sign = "auto",
  testId,
  className = "",
  ...rest
}: MoneyProps) {
  const whole = Math.trunc(cents);
  const negative = sign === "minus" ? whole !== 0 : whole < 0;
  const magnitude = Math.abs(whole);
  const text = formatCents(magnitude);
  return (
    <span
      {...rest}
      data-testid={testId ?? (rest as { "data-testid"?: string })["data-testid"]}
      data-money-cents={magnitude}
      data-money-kind={kind}
      data-tender={tender}
      data-source={source}
      data-policy-version={policyVersion}
      data-money-sign={negative ? "minus" : undefined}
      className={`tabular-nums ${className}`.trim()}
    >
      {negative && (
        <span role="img" aria-label="minus">
          −
        </span>
      )}
      {sign === "plus" && !negative && whole > 0 && (
        <span role="img" aria-label="plus">
          +
        </span>
      )}
      {text}
    </span>
  );
}
