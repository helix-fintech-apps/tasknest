import { Db, BookingRow } from "../_shared/db.ts";
import { PaymentsProvider } from "../_shared/provider/index.ts";
import { HttpError } from "../_shared/http.ts";
import { BookingStatus, canTransition } from "../_shared/domain/index.ts";
export { bookingFigures } from "../_shared/figures.ts";

export type Role = "client" | "tasker" | "admin" | "support_agent";

export interface Caller {
  id: string;
  email: string;
  role: Role;
  emailConfirmed: boolean;
  /** A scheduled job authenticated with the service-role key (only /payouts/run). */
  system?: boolean;
}

export interface Ctx {
  db: Db;
  provider: PaymentsProvider;
  now: Date;
  user: Caller;
  /** Idempotency-Key header (scoped to the caller). */
  idemKey?: string;
  /** Unique per request; used to derive provider idempotency keys and ledger txn keys. */
  opKey: string;
  body: Record<string, unknown>;
  params: Record<string, string>;
}

export function requireRole(ctx: Ctx, ...roles: Role[]): void {
  if (!roles.includes(ctx.user.role)) {
    throw new HttpError(403, "forbidden", `requires role ${roles.join(" or ")}`);
  }
}

export const isStaff = (ctx: Ctx) => ctx.user.role === "admin" || ctx.user.role === "support_agent";

export function requireParty(
  ctx: Ctx,
  b: BookingRow,
  ...who: ("client" | "tasker" | "staff" | "admin")[]
): "client" | "tasker" | "staff" | "admin" {
  if (who.includes("client") && b.client_id === ctx.user.id) return "client";
  if (who.includes("tasker") && b.tasker_id === ctx.user.id) return "tasker";
  if (who.includes("admin") && ctx.user.role === "admin") return "admin";
  if (who.includes("staff") && isStaff(ctx)) return "staff";
  // Hide bookings from non-parties.
  throw new HttpError(404, "not_found", "booking not found");
}

/** Booking state machine check (domain canTransition) as a 409. */
export function transition(b: BookingRow, to: BookingStatus): void {
  if (!canTransition(b.status as BookingStatus, to)) {
    throw new HttpError(409, "illegal_state", `cannot move a ${b.status} booking to ${to}`);
  }
}
