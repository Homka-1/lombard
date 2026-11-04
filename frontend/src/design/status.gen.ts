// Сгенерировано scripts/build-design.mjs из design/tokens.json — не править вручную.
export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "gold";

export const STATUS = {
  DRAFT: { label: "Черновик", tone: "neutral" },
  SUBMITTED: { label: "Отправлена", tone: "info" },
  PRE_ESTIMATED: { label: "Предоценка готова", tone: "info" },
  UNDER_REVIEW: { label: "У эксперта", tone: "info" },
  NEED_INFO: { label: "Нужны фото", tone: "warning" },
  OFFER_SENT: { label: "Предложение", tone: "gold" },
  OFFER_ACCEPTED: { label: "Предложение принято", tone: "success" },
  OFFER_DECLINED: { label: "Отказ клиента", tone: "neutral" },
  REJECTED: { label: "Отклонена", tone: "danger" },
  COURIER_SCHEDULED: { label: "Курьер назначен", tone: "info" },
  COURIER_EN_ROUTE: { label: "Курьер в пути", tone: "info" },
  ITEM_PICKED_UP: { label: "Изделие у курьера", tone: "info" },
  ITEM_DELIVERED: { label: "В ломбарде", tone: "info" },
  INSPECTED: { label: "Осмотрено", tone: "success" },
  FUNDS_ISSUED: { label: "Деньги выданы", tone: "success" },
  LOAN_ACTIVE: { label: "Займ действует", tone: "success" },
  EXTENDED: { label: "Продлён", tone: "success" },
  OVERDUE: { label: "Просрочка", tone: "danger" },
  REPAID: { label: "Погашен", tone: "neutral" },
  ITEM_RETURNED: { label: "Изделие возвращено", tone: "neutral" },
  FORFEITED: { label: "Перешло ломбарду", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export type ApplicationStatus = keyof typeof STATUS;
