// Extension point for the mock backend (e2e/mock-backend.ts). Each workstream adds handlers for its
// own `api` endpoints in its own file in this folder, so nobody edits mock-backend.ts for them.
// `extraHandlers` is consulted for every `api` call after explicit `onApi` overrides and before the
// built-in handlers and the default response. A handler returns `undefined` to pass.

import type { ApiCall } from "../mock-backend";
import { discoveryHandlers } from "./discovery";
import { bookingsHandlers } from "./bookings";
import { paymentsHandlers } from "./payments";
import { taskerHandlers } from "./tasker";
import { consoleHandlers } from "./console";

type Row = Record<string, unknown>;

export interface MockContext {
  /** The mock database (same object as `MockBackend.db`). */
  db: Record<string, Row[]>;
  /** The signed-in mock user's profile row, or null. */
  currentUser: Row | null;
}

export interface MockResponse {
  status?: number;
  body: unknown;
}

export type ExtraHandler = (call: ApiCall, ctx: MockContext) => MockResponse | undefined;

/** GET /health: the simulated provider and no feature flags, like a fresh local stack. */
const healthHandler: ExtraHandler = (call) =>
  call.method === "GET" && (call.path === "/health" || call.path === "/")
    ? {
        body: { ok: true, service: "tasknest-api", build: "mock", provider: "fake", features: {} },
      }
    : undefined;

export const extraHandlers: ExtraHandler[] = [
  healthHandler,
  ...discoveryHandlers,
  ...bookingsHandlers,
  ...paymentsHandlers,
  ...taskerHandlers,
  ...consoleHandlers,
];

/** First extra handler that answers the call, or undefined. */
export function handleExtra(call: ApiCall, ctx: MockContext): MockResponse | undefined {
  for (const h of extraHandlers) {
    const r = h(call, ctx);
    if (r) return r;
  }
  return undefined;
}
