import { Cents, applyBps } from "./money.ts";

export interface PromoCode { code: string; kind: "fixed" | "percent"; value: number; firstTaskOnly: boolean; maxDiscountCents?: Cents; expiresAt?: Date }

export function promoDiscount(p: PromoCode, subtotal: Cents, isFirstTask: boolean, alreadyUsed: boolean, now: Date): Cents {
  if (alreadyUsed) throw new Error("promo code already used");
  if (p.expiresAt && now > p.expiresAt) throw new Error("promo code expired");
  if (p.firstTaskOnly && !isFirstTask) throw new Error("promo code is for first tasks only");
  const raw = p.kind === "fixed" ? p.value : applyBps(subtotal, p.value);
  return Math.min(raw, p.maxDiscountCents ?? raw, subtotal);
}
