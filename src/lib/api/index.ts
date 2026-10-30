// Typed client for the `api` Edge Function (see docs/API.md), composed from per-area modules.
// `api` keeps every method name it had before the split.

import { adminApi } from "./admin";
import { bookingApi } from "./booking";
import { bookingActionsApi } from "./bookingActions";
import { connectApi } from "./connect";
import { paymentsApi } from "./payments";
import { supportApi } from "./support";
import { taskerApi } from "./tasker";

export * from "./core";
export * from "./booking";
export * from "./bookingActions";
export * from "./tasker";

export const api = {
  ...bookingApi,
  ...taskerApi,
  ...bookingActionsApi,
  ...adminApi,
  ...paymentsApi,
  ...connectApi,
  ...supportApi,
};
