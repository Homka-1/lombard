import { useAuth } from "../../auth/AuthContext";
import { homePath } from "../../auth/roles";
import { ButtonLink } from "../../components/ui/Button";
import styles from "./Cabinet.module.css";

/** Неизвестный адрес внутри кабинета: ведём на главный экран роли. */
export function CabinetNotFound() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className={styles.notFound}>
      <h1 className="t-h1">Такой страницы в кабинете нет</h1>
      <p>Возможно, ссылка устарела или в адресе опечатка.</p>
      <ButtonLink to={homePath(user.role)}>В кабинет</ButtonLink>
    </div>
  );
}
