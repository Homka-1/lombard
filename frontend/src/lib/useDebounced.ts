import { useEffect, useState } from "react";

/** Значение, которое обновляется не чаще, чем раз в `delay` мс (для живых расчётов). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
