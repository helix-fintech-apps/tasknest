// Discovery: price estimates and tasker availability. Owner: WS7. Public (signed-out visitors may call these).

import * as discovery from "../handlers/discovery.ts";
import { ID, Route } from "../route.ts";

export const routes: Route[] = [
  {
    method: "POST",
    pattern: /^\/quote\/estimate$/,
    handler: discovery.quoteEstimate,
    idempotent: false,
    public: true,
  },
  {
    method: "GET",
    pattern: /^\/taskers\/availability$/,
    handler: discovery.availabilityByCategory,
    idempotent: false,
    public: true,
  },
  {
    method: "GET",
    pattern: new RegExp(`^/taskers/${ID}/availability$`),
    handler: discovery.taskerAvailability,
    idempotent: false,
    public: true,
  },
];
