import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../api/client";
import { adminApi } from "../../api/endpoints";
import type { Role, User } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { ROLE_LABEL } from "../../auth/roles";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Alert, Badge, PageLoader } from "../../components/ui/Feedback";
import { Field, Input, Select } from "../../components/ui/Form";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { formatPhoneInput } from "../../lib/format";
import { useDebounced } from "../../lib/useDebounced";
import { formatDayKz } from "../../lib/time";
import styles from "./Admin.module.css";

const ROLES: Role[] = ["CLIENT", "EXPERT", "COURIER", "ADMIN"];

export function UsersPage() {
  const { user: me } = useAuth();
  const [role, setRole] = useState<Role | "">("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [creating, setCreating] = useState(false);
  const users = useQuery({
    queryKey: ["admin", "users", role, q],
    queryFn: () => adminApi.users(role, q),
    placeholderData: (prev) => prev,
  });
  const queryClient = useQueryClient();
  const toast = useToast();
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { role?: Role; is_active?: boolean } }) =>
      adminApi.updateUser(id, data),
    onSuccess: (u, { data }) => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.show({
        title:
          data.is_active === false
            ? `${u.full_name} заблокирован(а)`
            : data.is_active === true
              ? `${u.full_name} снова может входить`
              : `${u.full_name}: роль «${ROLE_LABEL[u.role]}»`,
      });
    },
    onError: (e) => toast.show({ title: "Не сохранено", text: e.message, tone: "danger" }),
  });

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1 className="t-h1">Пользователи</h1>
        <Button icon="plus" onClick={() => setCreating(true)}>
          Добавить сотрудника
        </Button>
      </header>
      <div className={styles.filters}>
        <Field label="Поиск">
          {(p) => (
            <Input
              {...p}
              type="search"
              placeholder="Имя или e-mail"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </Field>
        <Field label="Роль">
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
              <option value="">Все роли</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {users.isPending ? (
        <PageLoader />
      ) : users.isError ? (
        <Alert tone="danger" title="Не удалось загрузить пользователей">
          {users.error.message}
        </Alert>
      ) : users.data.length === 0 ? (
        <p className={styles.muted}>Никого не нашли — измените запрос или роль.</p>
      ) : (
        <Card pad="s" className={styles.tableCard}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Пользователь</th>
                  <th scope="col">Телефон и город</th>
                  <th scope="col">Роль</th>
                  <th scope="col">Статус</th>
                  <th scope="col">
                    <span className="visually-hidden">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    isMe={u.id === me?.id}
                    busy={update.isPending && update.variables?.id === u.id}
                    onChange={(data) => update.mutate({ id: u.id, data })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {creating && <StaffDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function UserRow({
  user: u,
  isMe,
  busy,
  onChange,
}: {
  user: User;
  isMe: boolean;
  busy: boolean;
  onChange: (data: { role?: Role; is_active?: boolean }) => void;
}) {
  return (
    <tr data-muted={!u.is_active || undefined}>
      <td>
        <strong>
          {u.full_name}
          {isMe && " (вы)"}
        </strong>
        <span className={styles.cellSub}>
          {u.email}, с {formatDayKz(u.created_at)}
        </span>
      </td>
      <td>
        {u.phone_display ?? "—"}
        <span className={styles.cellSub}>{u.city ?? "Город не указан"}</span>
      </td>
      <td className={styles.roleCell}>
        <Select
          aria-label={`Роль: ${u.full_name}`}
          value={u.role}
          disabled={isMe || busy}
          onChange={(e) => onChange({ role: e.target.value as Role })}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </td>
      <td>
        <Badge tone={u.is_active ? "success" : "danger"}>
          {u.is_active ? "Активен" : "Заблокирован"}
        </Badge>
      </td>
      <td className={styles.rowAction}>
        {!isMe && (
          <Button
            variant={u.is_active ? "ghost" : "secondary"}
            size="s"
            loading={busy}
            onClick={() => onChange({ is_active: !u.is_active })}
            aria-label={`${u.is_active ? "Заблокировать" : "Разблокировать"}: ${u.full_name}`}
          >
            {u.is_active ? "Заблокировать" : "Разблокировать"}
          </Button>
        )}
      </td>
    </tr>
  );
}

interface StaffDraft {
  full_name: string;
  email: string;
  phone: string;
  city: string;
  role: Role;
  password: string;
}

function StaffDialog({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<StaffDraft>({
    full_name: "",
    email: "",
    phone: "",
    city: "Алматы",
    role: "EXPERT",
    password: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof StaffDraft, string>>>({});
  const queryClient = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () =>
      adminApi.createUser({
        ...d,
        full_name: d.full_name.trim(),
        email: d.email.trim(),
        phone: d.phone || null,
        city: d.city.trim() || null,
      }),
    onSuccess: (u) => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.show({
        title: `${u.full_name} добавлен(а)`,
        text: `Вход: ${u.email}, роль «${ROLE_LABEL[u.role]}»`,
      });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError)
        setErrors({
          full_name: e.fieldMessage("full_name"),
          email: e.fieldMessage("email"),
          phone: e.fieldMessage("phone"),
          city: e.fieldMessage("city"),
          password: e.fieldMessage("password"),
        });
    },
  });
  const set = <K extends keyof StaffDraft>(k: K, v: StaffDraft[K]) => {
    setD((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => ({ ...prev, [k]: undefined }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p: typeof errors = {};
    if (d.full_name.trim().length < 2) p.full_name = "Укажите имя и фамилию";
    if (!/^\S+@\S+\.\S+$/.test(d.email.trim())) p.email = "Например, name@lombard.kz";
    if (d.role === "COURIER" && !d.city.trim()) p.city = "Для курьера укажите город обслуживания";
    if (d.password.length < 8 || !/\d/.test(d.password) || !/\p{L}/u.test(d.password))
      p.password = "Не короче 8 символов, хотя бы одна буква и одна цифра";
    setErrors(p);
    if (Object.keys(p).length === 0) create.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Новый сотрудник"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="staff-form" loading={create.isPending}>
            Добавить сотрудника
          </Button>
        </>
      }
    >
      <form id="staff-form" onSubmit={submit} noValidate className={styles.modalForm}>
        <Field label="Роль">
          {(p) => (
            <Select {...p} value={d.role} onChange={(e) => set("role", e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Имя и фамилия" error={errors.full_name}>
          {(p) => (
            <Input {...p} value={d.full_name} onChange={(e) => set("full_name", e.target.value)} />
          )}
        </Field>
        <Field label="E-mail для входа" error={errors.email}>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="off"
              value={d.email}
              onChange={(e) => set("email", e.target.value)}
            />
          )}
        </Field>
        <div className={styles.row2}>
          <Field label="Телефон" error={errors.phone}>
            {(p) => (
              <Input
                {...p}
                type="tel"
                placeholder="+7 7XX XXX-XX-XX"
                value={d.phone}
                onChange={(e) => set("phone", formatPhoneInput(e.target.value))}
              />
            )}
          </Field>
          <Field
            label="Город"
            hint={d.role === "COURIER" ? "Курьер получает выезды по этому городу" : undefined}
            error={errors.city}
          >
            {(p) => <Input {...p} value={d.city} onChange={(e) => set("city", e.target.value)} />}
          </Field>
        </div>
        <Field
          label="Временный пароль"
          hint="Передайте его сотруднику лично"
          error={errors.password}
        >
          {(p) => (
            <Input
              {...p}
              type="text"
              autoComplete="new-password"
              value={d.password}
              onChange={(e) => set("password", e.target.value)}
            />
          )}
        </Field>
        {create.isError && (
          <Alert tone="danger" title="Сотрудник не добавлен">
            {create.error.message}
          </Alert>
        )}
      </form>
    </Modal>
  );
}
