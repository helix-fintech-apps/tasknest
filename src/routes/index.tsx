import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { publicRoutes } from "./public";
import { clientRoutes } from "./client";
import { taskerRoutes } from "./tasker";
import { staffRoutes } from "./staff";
import { aliasRoutes } from "./aliases";
import { Spinner } from "../components/ui";

const NotFound = lazy(() => import("../pages/NotFound"));

/**
 * The route table, composed from one file per audience. Aliases come first so they win over the
 * (older) `/points` route in client.tsx. Unknown paths render the 404 page, not a silent redirect.
 */
export function AppRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        {aliasRoutes}
        {publicRoutes}
        {clientRoutes}
        {taskerRoutes}
        {staffRoutes}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
