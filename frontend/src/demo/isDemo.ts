/**
 * Демо-сборка (`npm run build:demo`, этап 13): статический `demo/index.html` с мок-API
 * в браузере. Значение подставляется при сборке, поэтому в обычной сборке демо-код
 * отбрасывается.
 */
export const IS_DEMO = import.meta.env.MODE === "demo";
