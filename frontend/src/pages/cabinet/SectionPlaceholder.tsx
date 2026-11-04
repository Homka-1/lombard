import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { ROLE_LABEL, ROLE_NAV } from "../../auth/roles";
import { ButtonLink } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Icon } from "../../components/ui/Icon";
import styles from "./Cabinet.module.css";

/** Что появится в разделе (экраны кабинетов — этапы 10–11). */
const PLANNED: Record<string, string> = {
  "/expert": "Очередь заявок на оценку: фото, параметры и форма предложения.",
  "/expert/inspections": "Изделия, доставленные в ломбард, — подтверждение при осмотре.",
  "/courier": "Выезды на сегодня: адреса, интервалы и смена статусов.",
  "/admin": "Статистика: воронка заявок, портфель займов, загрузка курьеров.",
  "/admin/catalog": "Категории залога, ставки, LTV и цены металлов.",
  "/admin/users": "Пользователи и роли сотрудников.",
  "/admin/couriers": "Назначение курьеров на выезды.",
};

export function SectionPlaceholder() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return null;
  const item = ROLE_NAV[user.role].find((n) => n.to === pathname) ?? ROLE_NAV[user.role][0]!;
  const isHome = item.to === ROLE_NAV[user.role][0]!.to;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        {isHome && (
          <p className={styles.greeting}>
            {user.full_name}, {ROLE_LABEL[user.role].toLowerCase()}
          </p>
        )}
        <h1 className="t-h1">{item.label}</h1>
      </header>
      <Card pad="l" className={styles.empty}>
        <Icon name={item.icon} size={32} className={styles.emptyIcon} />
        <h2 className="t-h3">Раздел в разработке</h2>
        <p className={styles.emptyText}>{PLANNED[item.to] ?? "Скоро здесь появятся данные."}</p>
        <ButtonLink to="/#calculator" variant="secondary">
          Открыть калькулятор займа
        </ButtonLink>
      </Card>
    </div>
  );
}
