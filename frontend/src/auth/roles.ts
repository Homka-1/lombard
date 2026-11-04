import type { IconName } from "../components/icons.gen";
import type { Role } from "../api/types";

export const ROLE_LABEL: Record<Role, string> = {
  CLIENT: "Клиент",
  EXPERT: "Эксперт",
  COURIER: "Курьер",
  ADMIN: "Администратор",
};

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

/** Разделы кабинета по ролям (пункты меню в шапке). */
export const ROLE_NAV: Record<Role, NavItem[]> = {
  CLIENT: [
    { to: "/client", label: "Мои заявки", icon: "list" },
    { to: "/client/new", label: "Новая заявка", icon: "camera" },
    { to: "/client/loans", label: "Займы", icon: "card" },
  ],
  EXPERT: [
    { to: "/expert", label: "Очередь", icon: "list" },
    { to: "/expert/inspections", label: "Осмотр", icon: "zoom" },
  ],
  COURIER: [{ to: "/courier", label: "Выезды", icon: "truck" }],
  ADMIN: [
    { to: "/admin", label: "Дашборд", icon: "chart" },
    { to: "/admin/catalog", label: "Справочники", icon: "tag" },
    { to: "/admin/users", label: "Пользователи", icon: "users" },
    { to: "/admin/couriers", label: "Курьеры", icon: "route" },
  ],
};

export const homePath = (role: Role) => ROLE_NAV[role][0]!.to;

/** Можно ли вернуть пользователя на страницу, с которой его отправили на вход. */
export function canVisit(role: Role, path: string): boolean {
  const prefix = `/${role.toLowerCase()}`;
  return path === prefix || path.startsWith(`${prefix}/`);
}
