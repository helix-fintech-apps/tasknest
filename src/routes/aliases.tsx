import { Navigate, Route } from "react-router-dom";
import { RequireRole } from "./RequireRole";
import Points from "../pages/Points";
import DesignSystem from "../pages/DesignSystem";

/**
 * Routes owned by the shell: the `/rewards` alias and the `/design-system` style guide.
 *
 * The alias: The client nav says "Rewards" (`/rewards`); the page that exists
 * today is Points at `/points`. Until the account/rewards work (WS3) mounts `/rewards` itself in
 * `client.tsx`, `/rewards` shows the Points page and `/points` forwards to it.
 * WS3: delete this file (and its use in routes/index.tsx) when `/rewards` is mounted in client.tsx.
 */
export const aliasRoutes = (
  <>
    <Route
      path="/rewards"
      element={
        <RequireRole roles={["client"]}>
          <Points />
        </RequireRole>
      }
    />
    <Route path="/points" element={<Navigate to="/rewards" replace />} />
    {/* The living style guide: every kit component in every state (axe checks it too). */}
    <Route path="/design-system" element={<DesignSystem />} />
  </>
);
