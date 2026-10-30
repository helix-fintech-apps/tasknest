// Route table types and helpers shared by api/routes.ts and api/routes/*.ts.

import { Ctx } from "./context.ts";

export type Handler = (ctx: Ctx) => Promise<unknown>;

export interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  pattern: RegExp;
  handler: Handler;
  /** Stores the response under the caller's Idempotency-Key (mutations). */
  idempotent: boolean;
  /** Open to signed-out visitors (the anon key, or no token). Read-only discovery routes only. */
  public?: boolean;
  /**
   * Names of the pattern's capture groups, in order (default `["id"]`). Values are exposed as
   * `ctx.params[name]`. A name that is `id` or ends in `Id` must be a uuid (400 otherwise) and is lowercased.
   */
  params?: string[];
}

/** A uuid capture group. */
export const ID = "([0-9a-fA-F-]{36})";

/** `/bookings/:id/<action>` */
export const booking = (action: string) => new RegExp(`^/bookings/${ID}/${action}$`);
