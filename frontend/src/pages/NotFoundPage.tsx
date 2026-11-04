import { ButtonLink } from "../components/ui/Button";
import styles from "./cabinet/Cabinet.module.css";

export function NotFoundPage() {
  return (
    <div className={`container ${styles.notFound}`}>
      <h1 className="t-h1">Такой страницы нет</h1>
      <p>Возможно, ссылка устарела или в адресе опечатка. Начните с главной страницы.</p>
      <ButtonLink to="/">На главную</ButtonLink>
    </div>
  );
}
