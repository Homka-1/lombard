import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../api/client";
import styles from "./StubPage.module.css";

function ApiStatus() {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: false,
  });

  if (isPending) {
    return (
      <p className={styles.status} data-tone="neutral" role="status">
        Проверяем связь с сервером…
      </p>
    );
  }

  if (isError) {
    return (
      <div className={styles.statusRow}>
        <p className={styles.status} data-tone="danger" role="alert">
          Сервер не отвечает. Запустите backend: <code>uvicorn app.main:app --reload</code>
        </p>
        <button className={styles.retry} onClick={() => refetch()} disabled={isFetching}>
          Проверить снова
        </button>
      </div>
    );
  }

  return (
    <p className={styles.status} data-tone="success" role="status">
      Сервер на связи: {data.app}, версия {data.version}
    </p>
  );
}

export function StubPage() {
  return (
    <main className={styles.page}>
      <article className={styles.ticket} aria-labelledby="stub-title">
        <header className={styles.head}>
          <span className={styles.hallmark} aria-hidden="true">
            585
          </span>
          <span className={styles.brand}>Ломбард онлайн</span>
        </header>
        <h1 id="stub-title" className={styles.title}>
          Оценим изделие по фото и привезём деньги
        </h1>
        <p className={styles.lead}>
          Сервис в разработке. Здесь появятся заявка на оценку, оферта эксперта, вызов курьера и
          займ в тенге.
        </p>
        <div className={styles.tear} aria-hidden="true" />
        <ApiStatus />
      </article>
    </main>
  );
}
