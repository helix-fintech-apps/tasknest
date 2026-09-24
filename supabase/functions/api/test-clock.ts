// Test clock (fake payments provider only).
//
// Tests need to act "at" an exact time (e.g. exactly 48h before a booking starts). A request may carry
// `x-test-now: <ISO time>`, but only together with `x-test-clock: <token>`, a short-lived token an ADMIN
// mints for one user via POST /admin/test-clock. Without it, a client could simply claim a different time
// and dodge cancellation fees, so a bare `x-test-now` is rejected. With a Stripe key the clock is disabled.
//
// Token: "<userId>.<expiresAtUnixSeconds>.<hex HMAC-SHA256>", keyed with TEST_CLOCK_SECRET or, when that is
// unset, the function's SUPABASE_SERVICE_ROLE_KEY (never leaves the server).

import { env } from "../_shared/db.ts";
import { HttpError } from "../_shared/http.ts";
import { hmacSha256Hex } from "../_shared/provider/index.ts";

function secret(): string {
  const s = env("TEST_CLOCK_SECRET") ?? env("SUPABASE_SERVICE_ROLE_KEY");
  if (!s) throw new HttpError(500, "misconfigured", "no secret available for test clock tokens");
  return s;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function mintTestClockToken(userId: string, expiresAtSec: number): Promise<string> {
  const payload = `${userId}.${expiresAtSec}`;
  return `${payload}.${await hmacSha256Hex(secret(), `tasknest-test-clock:${payload}`)}`;
}

export async function verifyTestClockToken(
  token: string,
  userId: string,
  nowSec: number,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [uid, exp, sig] = parts;
  const expSec = Number(exp);
  if (uid !== userId || !Number.isSafeInteger(expSec) || expSec < nowSec) return false;
  const expected = await hmacSha256Hex(secret(), `tasknest-test-clock:${uid}.${exp}`);
  return constantTimeEqual(expected, sig);
}
