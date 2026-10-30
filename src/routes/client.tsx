import { Route } from "react-router-dom";
import { RequireRole } from "./RequireRole";
import Taskers from "../pages/Taskers";
import TaskerProfile from "../pages/TaskerProfile";
import MyBookings from "../pages/MyBookings";
import Points from "../pages/Points";

export const clientRoutes = (
  <>
    <Route
      path="/taskers"
      element={
        <RequireRole roles={["client", "admin", "support_agent"]}>
          <Taskers />
        </RequireRole>
      }
    />
    <Route
      path="/taskers/:id"
      element={
        <RequireRole roles={["client", "admin", "support_agent"]}>
          <TaskerProfile />
        </RequireRole>
      }
    />
    <Route
      path="/bookings"
      element={
        <RequireRole roles={["client"]}>
          <MyBookings />
        </RequireRole>
      }
    />
    <Route
      path="/points"
      element={
        <RequireRole roles={["client"]}>
          <Points />
        </RequireRole>
      }
    />
  </>
);
