import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Role } from "../api/types";
import { PageLoader } from "../components/ui/Feedback";
import { useAuth } from "./AuthContext";
import { homePath } from "./roles";

/** Пускает только вошедших пользователей нужной роли; гостей отправляет на вход. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === "loading") return <PageLoader />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (user.role !== role) return <Navigate to={homePath(user.role)} replace />;
  return <>{children}</>;
}
