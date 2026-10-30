import { Route } from "react-router-dom";
import { RequireRole } from "./RequireRole";
import TaskerDashboard from "../pages/TaskerDashboard";

export const taskerRoutes = (
  <Route
    path="/tasker"
    element={
      <RequireRole roles={["tasker"]}>
        <TaskerDashboard />
      </RequireRole>
    }
  />
);
