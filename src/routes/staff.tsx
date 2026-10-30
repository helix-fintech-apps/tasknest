import { Route } from "react-router-dom";
import { RequireRole } from "./RequireRole";
import Console from "../pages/Console";

export const staffRoutes = (
  <Route
    path="/console"
    element={
      <RequireRole roles={["admin", "support_agent"]}>
        <Console />
      </RequireRole>
    }
  />
);
