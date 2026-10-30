import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ui/Toast";
import { AppHeader } from "./components/shell/AppHeader";
import { Footer } from "./components/shell/Footer";
import { RouteAnnouncer } from "./components/shell/RouteAnnouncer";
import { SkipLink } from "./components/shell/SkipLink";
import { StaffSidebar } from "./components/shell/StaffSidebar";
import { useIsDesktop } from "./components/shell/useMediaQuery";
import { HealthProvider } from "./lib/health";
import { AppRoutes } from "./routes";

function Shell({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const desktop = useIsDesktop();
  const staff = profile?.role === "admin" || profile?.role === "support_agent";
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <AppHeader />
      <div className="mx-auto flex w-full max-w-[1200px] flex-1 gap-8 px-4 py-6 md:px-6 md:py-8">
        {staff && desktop && <StaffSidebar role={profile!.role} />}
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 pb-20 focus:outline-none md:pb-0"
          data-testid="main"
        >
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
      <Footer />
      <RouteAnnouncer />
    </div>
  );
}

export default function App() {
  return (
    <HealthProvider>
      <ToastProvider>
        <Shell>
          <AppRoutes />
        </Shell>
      </ToastProvider>
    </HealthProvider>
  );
}
