import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { homePath } from "../auth/roles";
import { Logo } from "../components/ui/Brand";
import { ButtonLink } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { SkipLink } from "../components/ui/SkipLink";
import styles from "./PublicLayout.module.css";

const NAV = [
  { href: "/#how", label: "Как это работает" },
  { href: "/#calculator", label: "Калькулятор" },
  { href: "/#accepted", label: "Что принимаем" },
  { href: "/#faq", label: "Вопросы" },
];

export const SUPPORT_PHONE = "+7 727 355-08-08";
export const SUPPORT_PHONE_HREF = "tel:+77273550808";

function HeaderActions({ onNavigate }: { onNavigate?: () => void }) {
  const { user, status } = useAuth();
  if (status === "loading") return null;
  if (user) {
    return (
      <ButtonLink to={homePath(user.role)} size="s" onClick={onNavigate}>
        Личный кабинет
      </ButtonLink>
    );
  }
  return (
    <>
      <Link to="/login" className={styles.login} onClick={onNavigate}>
        Войти
      </Link>
      <ButtonLink to="/register" size="s" onClick={onNavigate}>
        Оценить изделие
      </ButtonLink>
    </>
  );
}

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.hash]);

  return (
    <header className={styles.header}>
      <div className={`container ${styles.bar}`}>
        <Logo />
        <nav className={styles.nav} aria-label="Разделы страницы">
          {NAV.map((n) => (
            <Link key={n.href} to={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className={styles.actions}>
          <HeaderActions />
        </div>
        <button
          type="button"
          className={styles.burger}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "close" : "menu"} size={24} />
        </button>
      </div>
      {open && (
        <div id="mobile-menu" className={styles.mobileMenu}>
          <nav aria-label="Разделы страницы">
            {NAV.map((n) => (
              <Link key={n.href} to={n.href} onClick={() => setOpen(false)}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className={styles.mobileActions}>
            <HeaderActions onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerGrid}`}>
        <div className={styles.footerBrand}>
          <Logo />
          <p>Онлайн-ломбард: оценка по фото, курьер и деньги на карту.</p>
        </div>
        <nav aria-label="Клиентам" className={styles.footerCol}>
          <h2>Клиентам</h2>
          {NAV.map((n) => (
            <Link key={n.href} to={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className={styles.footerCol}>
          <h2>Кабинет</h2>
          <Link to="/login">Вход</Link>
          <Link to="/register">Регистрация</Link>
        </div>
        <address className={styles.footerCol}>
          <h2>Связаться</h2>
          <a href={SUPPORT_PHONE_HREF}>{SUPPORT_PHONE}</a>
          <a href="mailto:help@lombard.example">help@lombard.example</a>
          <span>Алматы, пр. Абая, 52</span>
        </address>
      </div>
      <div className={`container ${styles.legal}`}>
        <span>Учебный проект. Не является публичной офертой.</span>
        <span>2026</span>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  return (
    <div className={styles.shell}>
      <SkipLink />
      <PublicHeader />
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
