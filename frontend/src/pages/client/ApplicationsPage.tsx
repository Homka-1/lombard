import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { applicationsApi } from "../../api/endpoints";
import type { ApplicationListItem } from "../../api/types";
import { ItemArt } from "../../components/ItemArt";
import { ButtonLink } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Alert, PageLoader, StatusBadge } from "../../components/ui/Feedback";
import { Segmented } from "../../components/ui/Form";
import { Icon } from "../../components/ui/Icon";
import { formatTengeRange } from "../../lib/format";
import { formatDayKz, isActiveStatus, itemKind, NEEDS_CLIENT } from "./clientLib";
import styles from "./Client.module.css";

type Filter = "active" | "closed" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "active", label: "В работе" },
  { value: "closed", label: "Завершённые" },
  { value: "all", label: "Все" },
];

export function ApplicationsPage() {
  const list = useQuery({ queryKey: ["applications"], queryFn: applicationsApi.list });
  const [filter, setFilter] = useState<Filter>("active");

  const shown = useMemo(() => {
    const items = list.data ?? [];
    if (filter === "all") return items;
    return items.filter((a) => isActiveStatus(a.status) === (filter === "active"));
  }, [list.data, filter]);

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1 className="t-h1">Мои заявки</h1>
        <ButtonLink to="/client/new" icon="camera">
          Новая заявка
        </ButtonLink>
      </header>

      {list.isPending ? (
        <PageLoader />
      ) : list.isError ? (
        <Alert tone="danger" title="Не удалось загрузить заявки">
          {list.error.message}
        </Alert>
      ) : list.data.length === 0 ? (
        <EmptyList />
      ) : (
        <>
          <Segmented
            label="Какие заявки показать"
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            className={styles.filter}
          />
          {shown.length === 0 ? (
            <p className={styles.muted}>
              {filter === "active" ? "Нет заявок в работе." : "Завершённых заявок пока нет."}
            </p>
          ) : (
            <ul className={styles.appList} role="list">
              {shown.map((a) => (
                <ApplicationRow key={a.id} app={a} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ApplicationRow({ app }: { app: ApplicationListItem }) {
  const needsYou = NEEDS_CLIENT.includes(app.status);
  return (
    <li>
      <Link to={`/client/applications/${app.id}`} className={styles.appRow}>
        <span className={styles.appThumb}>
          {app.cover_thumb_url ? (
            <img src={app.cover_thumb_url} alt="" />
          ) : (
            <ItemArt kind={itemKind(app.category.code)} square />
          )}
        </span>
        <span className={styles.appMain}>
          <span className={styles.appTitle}>{app.title}</span>
          <span className={styles.appMeta}>
            № {app.number}, {app.category.name.toLowerCase()}, {formatDayKz(app.created_at)}
          </span>
        </span>
        <span className={styles.appStatus}>
          <StatusBadge status={app.status} />
          {needsYou && <span className={styles.needsYou}>Нужно ваше действие</span>}
        </span>
        <span className={styles.appAmount}>
          {app.pre_estimate_min !== null && app.pre_estimate_max !== null ? (
            <>
              <span className={styles.amountLabel}>Предоценка</span>
              {formatTengeRange(app.pre_estimate_min, app.pre_estimate_max)}
            </>
          ) : (
            <span className={styles.amountLabel}>Без оценки</span>
          )}
        </span>
        <Icon name="chevronRight" size={20} className={styles.appChevron} />
      </Link>
    </li>
  );
}

function EmptyList() {
  return (
    <Card pad="l" className={styles.empty}>
      <ItemArt kind="ring" square className={styles.emptyArt} />
      <h2 className="t-h3">Заявок пока нет</h2>
      <p className={styles.emptyText}>
        Сфотографируйте изделие и укажите пробу и вес — предварительная оценка придёт сразу, а
        предложение эксперта — в течение часа.
      </p>
      <ButtonLink to="/client/new" icon="camera">
        Оценить изделие
      </ButtonLink>
    </Card>
  );
}
