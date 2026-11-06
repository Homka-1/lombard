import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startTransition, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiGet, apiPost, setTokens } from "../api/client";
import type { AuthResponse, ClockState, Role } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { homePath } from "../auth/roles";
import { Icon } from "../components/ui/Icon";
import { useToast } from "../components/ui/Toast";
import { days } from "../lib/format";
import { formatRelativeDay } from "../lib/time";
import styles from "./DemoBar.module.css";

/** Состояние демо (мок-API, `demo-src/mock-api.js`): часы и аккаунты для каждой роли. */
interface DemoState extends ClockState {
  today: string;
  accounts: Record<Role, { full_name: string; email: string } | null>;
}

const demoApi = {
  state: () => apiGet<DemoState>("/demo/state", { anonymous: true }),
  switchRole: (role: Role) => apiPost<AuthResponse>("/demo/switch", { role }, { anonymous: true }),
  advance: (n: number) => apiPost<DemoState>("/demo/clock", { days: n }, { anonymous: true }),
  resetClock: () => api<DemoState>("/demo/clock", { method: "DELETE", anonymous: true }),
  reset: () => apiPost<void>("/demo/reset", undefined, { anonymous: true }),
};

const ROLE_BUTTONS: { role: Role; label: string; who: string }[] = [
  { role: "CLIENT", label: "Клиент", who: "клиент" },
  { role: "EXPERT", label: "Эксперт", who: "эксперт" },
  { role: "COURIER", label: "Курьер", who: "курьер" },
  { role: "ADMIN", label: "Админ", who: "администратор" },
];

/**
 * Панель демо-версии над страницей: вход одной кнопкой за любую роль, перемотка времени
 * (продление, просрочка) и сброс к исходным данным. Есть только в демо-сборке.
 */
export function DemoBar() {
  const { user, adopt } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const state = useQuery({ queryKey: ["demo", "state"], queryFn: demoApi.state });

  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  const refreshAll = () => queryClient.invalidateQueries();

  const switchRole = useMutation({
    mutationFn: demoApi.switchRole,
    onSuccess: (resp) => {
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[0] !== "catalog" && q.queryKey[0] !== "demo",
      });
      // Смена пользователя и переход — одним переходом React, как при выходе из кабинета.
      startTransition(() => {
        adopt(resp);
        navigate(homePath(resp.user.role));
      });
      void queryClient.invalidateQueries({ queryKey: ["demo"] });
    },
    onError: (err) =>
      toast.show({ title: "Не удалось сменить роль", text: err.message, tone: "danger" }),
  });

  const travel = useMutation({
    mutationFn: (n: number) => (n > 0 ? demoApi.advance(n) : demoApi.resetClock()),
    onSuccess: (next, n) => {
      queryClient.setQueryData(["demo", "state"], next);
      void refreshAll();
      toast.show({
        title: n > 0 ? `Время перемотано на ${days(n)} вперёд` : "Вернули сегодняшний день",
        text: `В демо сейчас: ${formatRelativeDay(next.today).toLowerCase()}`,
        tone: "info",
      });
    },
    onError: (err) =>
      toast.show({ title: "Не удалось перемотать время", text: err.message, tone: "danger" }),
  });

  const reset = useMutation({
    mutationFn: demoApi.reset,
    onSuccess: () => {
      setConfirmReset(false);
      setTokens(null);
      queryClient.clear();
      // Чистый старт: заново загрузить приложение с исходными данными, с главной.
      window.location.replace(`${window.location.href.split("#")[0]}#/`);
      window.location.reload();
    },
    onError: (err) =>
      toast.show({ title: "Не удалось сбросить демо", text: err.message, tone: "danger" }),
  });

  const data = state.data;
  const offset = data ? Math.round(data.offset_days) : 0;
  const busy = switchRole.isPending || travel.isPending || reset.isPending;

  return (
    <section className={styles.bar} aria-label="Демо-режим">
      <div className={`container ${styles.inner}`}>
        <p className={styles.badge}>
          <span className={styles.mark}>Демо</span>
          <span className={styles.note}>Без сервера: данные хранятся в этом браузере</span>
        </p>

        <button
          type="button"
          className={styles.toggle}
          aria-expanded={toolsOpen}
          aria-controls="demo-tools"
          onClick={() => setToolsOpen((v) => !v)}
        >
          Демо<span className="visually-hidden">: время и сброс</span>
          <Icon name="chevronDown" size={16} className={styles.chevron} />
        </button>

        <div className={styles.roles} role="group" aria-label="Войти как">
          {ROLE_BUTTONS.map((b) => {
            const account = data?.accounts[b.role];
            const current = user?.role === b.role;
            return (
              <button
                key={b.role}
                type="button"
                className={styles.role}
                aria-pressed={current}
                disabled={busy}
                title={account ? `${account.full_name}, ${b.who}` : undefined}
                onClick={() => (current ? navigate(homePath(b.role)) : switchRole.mutate(b.role))}
              >
                {b.label}
              </button>
            );
          })}
        </div>

        <div id="demo-tools" className={styles.tools} data-open={toolsOpen}>
          <p className={styles.date} aria-live="polite">
            {data ? (
              <>
                <span className={styles.dateLabel}>В демо</span>{" "}
                {offset > 0
                  ? `${formatRelativeDay(data.today).toLowerCase()}, +${days(offset)}`
                  : "сегодня"}
              </>
            ) : (
              " "
            )}
          </p>
          <div className={styles.timeButtons} role="group" aria-label="Перемотать время">
            <button
              type="button"
              className={styles.tool}
              disabled={busy}
              aria-label="Перемотать на 1 день вперёд"
              onClick={() => travel.mutate(1)}
            >
              +1 день
            </button>
            <button
              type="button"
              className={styles.tool}
              disabled={busy}
              aria-label="Перемотать на 7 дней вперёд"
              onClick={() => travel.mutate(7)}
            >
              +7 дней
            </button>
            {offset > 0 && (
              <button
                type="button"
                className={styles.tool}
                disabled={busy}
                onClick={() => travel.mutate(0)}
              >
                Вернуть сегодня
              </button>
            )}
          </div>
          <button
            type="button"
            className={styles.reset}
            data-confirm={confirmReset}
            disabled={busy}
            onClick={() => (confirmReset ? reset.mutate() : setConfirmReset(true))}
          >
            {confirmReset ? "Точно сбросить? Все изменения пропадут" : "Сбросить демо"}
          </button>
        </div>
      </div>
    </section>
  );
}
