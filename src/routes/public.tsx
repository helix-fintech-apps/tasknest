import { Route } from "react-router-dom";
import { Home } from "./Home";
import SignIn from "../pages/SignIn";
import Pricing from "../pages/Pricing";

/** Routes anyone can open. Each file in this folder exports `<Route>` elements. */
export const publicRoutes = (
  <>
    <Route path="/" element={<Home />} />
    <Route path="/signin" element={<SignIn />} />
    <Route path="/pricing" element={<Pricing />} />
  </>
);
