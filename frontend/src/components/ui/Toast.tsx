import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import styles from "./Toast.module.css";
import { Icon } from "./Icon";

type ToastTone = "success" | "info" | "danger";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  text?: string;
}

interface ToastApi {
  show: (toast: { title: string; text?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const ICON = { success: "check", info: "info", danger: "alert" } as const;
const LIFETIME_MS = 5000;

/** Короткие уведомления о результате действия («Курьер вызван»). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi["show"]>(({ title, text, tone = "success" }) => {
    seq.current += 1;
    const id = seq.current;
    setItems((list) => [...list.slice(-2), { id, title, text, tone }]);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <ToastView key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismiss(item.id), LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [item.id, onDismiss, paused]);

  return (
    <div
      className={styles.toast}
      data-tone={item.tone}
      role={item.tone === "danger" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={ICON[item.tone]} size={22} strokeWidth={2} className={styles.icon} />
      <div className={styles.body}>
        <p className={styles.title}>{item.title}</p>
        {item.text && <p className={styles.text}>{item.text}</p>}
      </div>
      <button
        type="button"
        className={styles.close}
        aria-label="Скрыть уведомление"
        onClick={() => onDismiss(item.id)}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast вне ToastProvider");
  return ctx;
}
