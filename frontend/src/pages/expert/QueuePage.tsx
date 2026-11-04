import { useState } from "react";
import { Link } from "react-router-dom";
import type { QueueItem } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { ItemArt } from "../../components/ItemArt";
import { Card } from "../../components/ui/Card";
import { Alert, PageLoader, StatusBadge } from "../../components/ui/Feedback";
import { Segmented } from "../../components/ui/Form";
import { Icon } from "../../components/ui/Icon";
import { formatTenge, formatTengeRange, NBSP } from "../../lib/format";
import { formatDateTimeKz, formatWait } from "../../lib/time";
import { itemKind } from "../client/clientLib";
import { shortName, slaOf, useQueue } from "./expertLib";
import styles from "./Expert.module.css";

type Tab = "new" | "mine" | "all";

export function QueuePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("new");
  const fresh = useQueue("new");
  const mine = useQueue("mine");
  const all = useQueue("all");
  const current = { new: fresh, mine, all }[tab];

  const count = (q: typeof fresh) => (q.data ? `, ${q.data.length}` : "");
  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          {user && <p className={styles.greeting}>{user.full_name}, эксперт-оценщик</p>}
          <h1 className="t-h1">Очередь</h1>
        </div>
        <Segmented
          label="Какие заявки показать"
          options={[
            { value: "new", label: `Ждут эксперта${count(fresh)}` },
            { value: "mine", label: `Мои в работе${count(mine)}` },
            { value: "all", label: "Все" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </header>
      <QueueList
        query={current}
        empty={
          tab === "new"
            ? "Новых заявок нет. Очередь обновляется сама каждые полминуты."
            : tab === "mine"
              ? "У вас нет заявок в работе. Возьмите заявку из вкладки «Ждут эксперта»."
              : "Заявок на оценке нет."
        }
        showSla={tab === "new"}
      />
    </div>
  );
}

export function InspectionsPage() {
  const q = useQueue("inspection");
  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1 className="t-h1">Осмотр</h1>
          <p className={styles.lead}>
            Изделия, которые курьер доставил в ломбард. Сверьте пробу и вес с заявкой и подтвердите
            сумму — после этого клиент получит деньги.
          </p>
        </div>
      </header>
      <QueueList query={q} empty="Доставленных изделий нет — осматривать нечего." />
    </div>
  );
}

function QueueList({
  query,
  empty,
  showSla,
}: {
  query: ReturnType<typeof useQueue>;
  empty: string;
  showSla?: boolean;
}) {
  if (query.isPending) return <PageLoader />;
  if (query.isError)
    return (
      <Alert tone="danger" title="Не удалось загрузить очередь">
        {query.error.message}
      </Alert>
    );
  if (query.data.length === 0)
    return (
      <Card pad="l" className={styles.empty}>
        <Icon name="check" size={28} className={styles.emptyIcon} />
        <p>{empty}</p>
      </Card>
    );
  return (
    <ul className={styles.queue} role="list">
      {query.data.map((item) => (
        <QueueRow key={item.id} item={item} showSla={showSla} />
      ))}
    </ul>
  );
}

function QueueRow({ item, showSla }: { item: QueueItem; showSla?: boolean }) {
  const since = item.submitted_at ?? item.created_at;
  const sla = slaOf(since);
  return (
    <li>
      <Link to={`/expert/applications/${item.id}`} className={styles.queueRow}>
        <span className={styles.thumb}>
          {item.cover_thumb_url ? (
            <img src={item.cover_thumb_url} alt="" />
          ) : (
            <ItemArt kind={itemKind(item.category.code)} square />
          )}
        </span>
        <span className={styles.rowMain}>
          <span className={styles.rowTitle}>
            № {item.number}, {item.title}
          </span>
          <span className={styles.rowMeta}>
            {item.category.name}, {shortName(item.client.full_name)}, {item.photo_count}
            {NBSP}фото
            {item.expert && !showSla ? `, ведёт ${shortName(item.expert.full_name)}` : ""}
          </span>
        </span>
        <span className={styles.rowStatus}>
          <StatusBadge status={item.status} />
        </span>
        <span className={styles.rowAmount}>
          <span className={styles.rowCaption}>
            {item.requested_amount ? `Просит ${formatTenge(item.requested_amount)}` : "Авто-оценка"}
          </span>
          {item.pre_estimate_min !== null && item.pre_estimate_max !== null
            ? formatTengeRange(item.pre_estimate_min, item.pre_estimate_max)
            : "—"}
        </span>
        <span className={styles.rowWait} data-late={(showSla && sla.late) || undefined}>
          {showSla ? (
            <>
              <span className={styles.rowCaption}>Ждёт</span>
              {formatWait(sla.waited)}
            </>
          ) : (
            <>
              <span className={styles.rowCaption}>Обновлена</span>
              {formatDateTimeKz(item.updated_at)}
            </>
          )}
        </span>
        <Icon name="chevronRight" size={20} className={styles.chevron} />
      </Link>
    </li>
  );
}
