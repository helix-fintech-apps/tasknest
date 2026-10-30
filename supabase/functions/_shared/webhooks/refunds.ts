// Webhook handlers for refund.* and charge.refund.* events. Owned by WS7. Empty in Wave 0: register an event type by adding it to `handlers`.

import type { EventHandler } from "./index.ts";

export const handlers: Record<string, EventHandler> = {};
