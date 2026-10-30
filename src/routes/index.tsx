import { Navigate, Route, Routes } from "react-router-dom";
import { publicRoutes } from "./public";
import { clientRoutes } from "./client";
import { taskerRoutes } from "./tasker";
import { staffRoutes } from "./staff";

/** The route table, composed from one file per audience. Unknown paths go home (WS1 adds a 404 later). */
export function AppRoutes() {
  return (
    <Routes>
      {publicRoutes}
      {clientRoutes}
      {taskerRoutes}
      {staffRoutes}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
