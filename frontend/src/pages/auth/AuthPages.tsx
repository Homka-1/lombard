import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import type { Role, User } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { ROLE_LABEL, canVisit, homePath } from "../../auth/roles";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Alert } from "../../components/ui/Feedback";
import { Field, Input } from "../../components/ui/Form";
import { useToast } from "../../components/ui/Toast";
import { formatPhoneInput, phoneDigits } from "../../lib/format";
import styles from "./Auth.module.css";

/** Демо-аккаунты из `python -m app.seed` (пароль у всех один). */
const DEMO_PASSWORD = "demo1234";
const DEMO_ACCOUNTS: { email: string; role: Role }[] = [
  { email: "client@lombard.kz", role: "CLIENT" },
  { email: "expert@lombard.kz", role: "EXPERT" },
  { email: "courier@lombard.kz", role: "COURIER" },
  { email: "admin@lombard.kz", role: "ADMIN" },
];

function useAfterAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return (user: User) => {
    navigate(from && canVisit(user.role, from) ? from : homePath(user.role), { replace: true });
  };
}

function AuthShell({
  title,
  lead,
  children,
  aside,
}: {
  title: string;
  lead: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.column}>
        <h1 className="t-h1">{title}</h1>
        <p className={styles.lead}>{lead}</p>
        <Card pad="l" className={styles.card}>
          {children}
        </Card>
        {aside}
      </div>
    </div>
  );
}

type Errors = Partial<Record<string, string>>;

function errorsFrom(err: unknown): { form?: string; fields: Errors } {
  if (err instanceof ApiError) {
    const fields: Errors = {};
    for (const f of err.fields) fields[f.field] ??= f.message;
    return { form: err.fields.length ? undefined : err.message, fields };
  }
  return { form: "Что-то пошло не так. Попробуйте ещё раз.", fields: {} };
}

export function LoginPage() {
  const { login, user } = useAuth();
  const after = useAfterAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [errors, setErrors] = useState<Errors>({});

  if (user) return <Navigate to={homePath(user.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Errors = {};
    if (!email.trim()) local.email = "Введите e-mail";
    if (!password) local.password = "Введите пароль";
    setErrors(local);
    setFormError(undefined);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const me = await login(email.trim(), password);
      toast.show({
        title: `Здравствуйте, ${me.full_name.split(" ")[0]}`,
        text: "Вы вошли в кабинет",
      });
      after(me);
    } catch (err) {
      const parsed = errorsFrom(err);
      setFormError(parsed.form);
      setErrors(parsed.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Вход"
      lead={
        <>
          Нет аккаунта? <Link to="/register">Зарегистрируйтесь</Link> — это займёт минуту.
        </>
      }
      aside={
        <section className={styles.demo} aria-labelledby="demo-title">
          <h2 id="demo-title" className={styles.demoTitle}>
            Демо-доступ
          </h2>
          <p className={styles.demoText}>
            Пароль у всех аккаунтов — <code>{DEMO_PASSWORD}</code>. Нажмите, чтобы подставить.
          </p>
          <ul className={styles.demoList} role="list">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className={styles.demoButton}
                  onClick={() => {
                    setEmail(a.email);
                    setPassword(DEMO_PASSWORD);
                    setErrors({});
                    setFormError(undefined);
                  }}
                >
                  <span>{ROLE_LABEL[a.role]}</span>
                  <span className={styles.demoEmail}>{a.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        {formError && <Alert tone="danger" title={formError} />}
        <Field label="E-mail" error={errors.email}>
          {(f) => (
            <Input
              {...f}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Пароль" error={errors.password}>
          {(f) => (
            <Input
              {...f}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="l" block loading={busy}>
          Войти
        </Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register, user } = useAuth();
  const after = useAfterAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    city: "Алматы",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [errors, setErrors] = useState<Errors>({});

  if (user) return <Navigate to={homePath(user.role)} replace />;

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Errors = {};
    if (form.full_name.trim().length < 2) local.full_name = "Укажите имя и фамилию";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim()))
      local.email = "Введите e-mail, например aigerim@mail.kz";
    const digits = phoneDigits(form.phone);
    if (digits && digits.length !== 10) local.phone = "Номер неполный: нужно 10 цифр после +7";
    if (form.password.length < 8) local.password = "Минимум 8 символов";
    else if (!/\d/.test(form.password) || !/\p{L}/u.test(form.password))
      local.password = "Нужны хотя бы одна буква и одна цифра";
    setErrors(local);
    setFormError(undefined);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const me = await register({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: digits ? `+7${digits}` : null,
        city: form.city.trim() || null,
        password: form.password,
      });
      toast.show({ title: "Аккаунт создан", text: "Теперь можно отправить изделие на оценку" });
      after(me);
    } catch (err) {
      const parsed = errorsFrom(err);
      setFormError(parsed.form);
      setErrors(parsed.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Регистрация"
      lead={
        <>
          Уже есть аккаунт? <Link to="/login">Войдите</Link>.
        </>
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        {formError && <Alert tone="danger" title={formError} />}
        <Field label="Имя и фамилия" error={errors.full_name}>
          {(f) => (
            <Input
              {...f}
              autoComplete="name"
              value={form.full_name}
              onChange={(e) => set("full_name")(e.target.value)}
            />
          )}
        </Field>
        <Field label="E-mail" error={errors.email}>
          {(f) => (
            <Input
              {...f}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => set("email")(e.target.value)}
            />
          )}
        </Field>
        <div className={styles.row}>
          <Field label="Телефон" hint="Для связи с курьером" error={errors.phone}>
            {(f) => (
              <Input
                {...f}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+7 701 123-45-67"
                value={form.phone}
                onChange={(e) => set("phone")(formatPhoneInput(e.target.value))}
              />
            )}
          </Field>
          <Field label="Город" error={errors.city}>
            {(f) => (
              <Input
                {...f}
                autoComplete="address-level2"
                value={form.city}
                onChange={(e) => set("city")(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Пароль" hint="Не короче 8 символов, буквы и цифры" error={errors.password}>
          {(f) => (
            <Input
              {...f}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set("password")(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="l" block loading={busy}>
          Создать аккаунт
        </Button>
        <p className={styles.terms}>
          Регистрируясь, вы соглашаетесь на обработку персональных данных для оценки изделия и
          оформления займа.
        </p>
      </form>
    </AuthShell>
  );
}
