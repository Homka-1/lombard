import { useQuery } from "@tanstack/react-query";
import { startTransition, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { notificationsApi } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABEL, ROLE_NAV, homePath } from "../auth/roles";
import { Logo } from "../components/ui/Brand";
import { Icon } from "../components/ui/Icon";
import { SkipLink } from "../components/ui/SkipLink";
import { useToast } from "../components/ui/Toast";
import { initials } from "../lib/format";
import styles from "./AppLayout.module.css";

function Bell() {
  const { data } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 60_000,
    retry: false,
  });
  const unread = data?.unread ?? 0;
  return (
    <span
      className={styles.bell}
      role="img"
      aria-label={unread ? `Непрочитанных уведомлений: ${unread}` : "Новых уведомлений нет"}
    >
      <Icon name="bell" size={24} />
      {unread > 0 && <span className={styles.bellCount}>{unread > 9 ? "9+" : unread}</span>}
    </span>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div className={styles.userMenu} ref={ref}>
      <button
        type="button"
        className={styles.userButton}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initials(user.full_name)}
        </span>
        <span className={styles.userText}>
          <span className={styles.userName}>{user.full_name}</span>
          <span className={styles.userRole}>{ROLE_LABEL[user.role]}</span>
        </span>
        <Icon name="chevronDown" size={18} className={styles.userChevron} />
      </button>
      {open && (
        <div className={styles.dropdown}>
          <p className={styles.dropdownEmail}>{user.email}</p>
          <button
            type="button"
            className={styles.dropdownItem}
            onClick={() => {
              // Переход и выход — в одном переходе React: иначе RequireRole успеет
              // увидеть гостя на странице кабинета и отправит его на вход.
              startTransition(() => {
                navigate("/");
                logout();
              });
              toast.show({ title: "Вы вышли из кабинета", tone: "info" });
            }}
          >
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}

/** Кабинет: шапка с разделами текущей роли, уведомлениями и меню пользователя. */
export function AppLayout() {
  const { user } = useAuth();
  if (!user) return null;
  const nav = ROLE_NAV[user.role];
  return (
    <div className={styles.shell}>
      <SkipLink />
      <header className={styles.header}>
        <div className={`container ${styles.bar}`}>
          <Logo to={homePath(user.role)} />
          <nav className={styles.nav} aria-label="Разделы кабинета">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) => (isActive ? styles.active : undefined)}
              >
                <Icon name={item.icon} size={18} className={styles.navIcon} />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className={styles.tools}>
            <Bell />
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="main" className={`container ${styles.main}`}>
        <Outlet />
      </main>
    </div>
  );
}
