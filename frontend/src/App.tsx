import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Role } from "./api/types";
import { AuthProvider } from "./auth/AuthContext";
import { RequireRole } from "./auth/RequireRole";
import { ROLE_NAV } from "./auth/roles";
import { ToastProvider } from "./components/ui/Toast";
import { AppLayout } from "./layouts/AppLayout";
import { PublicLayout } from "./layouts/PublicLayout";
import { LoginPage, RegisterPage } from "./pages/auth/AuthPages";
import { SectionPlaceholder } from "./pages/cabinet/SectionPlaceholder";
import { LandingPage } from "./pages/landing/LandingPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { createQueryClient } from "./lib/queryClient";
import { ROUTER_FUTURE } from "./lib/router";

const ROLES: Role[] = ["CLIENT", "EXPERT", "COURIER", "ADMIN"];

/** Прокрутка: к якорю (`/#faq`) или в начало при смене страницы. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView();
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
      </Route>
      {ROLES.map((role) => (
        <Route
          key={role}
          path={role.toLowerCase()}
          element={
            <RequireRole role={role}>
              <AppLayout />
            </RequireRole>
          }
        >
          {ROLE_NAV[role].map((item) => {
            const sub = item.to.split("/").slice(2).join("/");
            return sub ? (
              <Route key={item.to} path={sub} element={<SectionPlaceholder />} />
            ) : (
              <Route key={item.to} index element={<SectionPlaceholder />} />
            );
          })}
          <Route path="*" element={<SectionPlaceholder />} />
        </Route>
      ))}
      <Route element={<PublicLayout />}>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function Providers({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <Providers client={queryClient}>
      <BrowserRouter future={ROUTER_FUTURE}>
        <ScrollManager />
        <AppRoutes />
      </BrowserRouter>
    </Providers>
  );
}
