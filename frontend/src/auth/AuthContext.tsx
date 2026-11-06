import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getTokens, setTokens, subscribeTokens } from "../api/client";
import { authApi } from "../api/endpoints";
import type { AuthResponse, RegisterInput, User } from "../api/types";

type AuthStatus = "loading" | "guest" | "authenticated";

interface AuthValue {
  status: AuthStatus;
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  register: (data: RegisterInput) => Promise<User>;
  logout: () => void;
  /** Принять готовую сессию (ответ входа) — переключатель ролей демо-версии. */
  adopt: (resp: AuthResponse) => User;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() => (getTokens() ? "loading" : "guest"));

  // Сессия истекла (refresh не прошёл) — сбрасываем пользователя.
  useEffect(() => {
    subscribeTokens((t) => {
      if (!t) {
        setUser(null);
        setStatus("guest");
      }
    });
    return () => subscribeTokens(null);
  }, []);

  // Восстановление сессии после перезагрузки страницы.
  useEffect(() => {
    if (!getTokens()) return;
    let cancelled = false;
    authApi
      .me()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setTokens(null);
        setStatus("guest");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = useCallback((resp: AuthResponse) => {
    setTokens({ access: resp.access_token, refresh: resp.refresh_token });
    setUser(resp.user);
    setStatus("authenticated");
    return resp.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => accept(await authApi.login(email, password)),
    [accept],
  );
  const register = useCallback(
    async (data: RegisterInput) => accept(await authApi.register(data)),
    [accept],
  );
  const logout = useCallback(() => {
    setTokens(null);
    setUser(null);
    setStatus("guest");
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "catalog" });
  }, [queryClient]);

  const value = useMemo(
    () => ({ status, user, login, register, logout, adopt: accept }),
    [status, user, login, register, logout, accept],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth вне AuthProvider");
  return ctx;
}
