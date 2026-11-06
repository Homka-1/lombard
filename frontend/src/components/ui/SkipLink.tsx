import type { MouseEvent } from "react";

/**
 * «К содержанию» для клавиатуры. Фокус переводится скриптом, а не переходом по `#main`:
 * в демо-версии адрес страницы после `#` занят маршрутом (HashRouter).
 */
export function SkipLink({ target = "main" }: { target?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById(target);
    if (!el) return;
    e.preventDefault();
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus();
    el.scrollIntoView();
  };
  return (
    <a className="skip-link" href={`#${target}`} onClick={onClick}>
      К содержанию
    </a>
  );
}
