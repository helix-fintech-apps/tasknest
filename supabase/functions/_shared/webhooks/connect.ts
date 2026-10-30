// Webhook handlers for account.*, transfer.* and payout.* events. Owned by WS5. Empty in Wave 0: register an event type by adding it to `handlers`.

import type { EventHandler } from "./index.ts";

export const handlers: Record<string, EventHandler> = {};
