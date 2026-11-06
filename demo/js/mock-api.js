/*
 * Ломбард онлайн — мок-бэкенд демо-версии (этап 13).
 *
 * Повторяет контракт реального API (`backend/app/api`) прямо в браузере: перехватывает
 * `fetch("/api/...")`, хранит данные в localStorage и отвечает теми же JSON-структурами,
 * кодами ответов и текстами ошибок. Бизнес-правила перенесены из `backend/app/domain`
 * и `backend/app/services` один к одному: машина состояний заявки, предоценка по формуле,
 * анализ фото (эвристика на canvas вместо Pillow), калькулятор займа, курьерские слоты,
 * займ, продление, просрочка и изъятие, мок-банк, уведомления, статистика, перемотка времени.
 *
 * Обычный скрипт без модулей и зависимостей — работает из file://.
 * Суммы — в тиынах (1 ₸ = 100 тиын), даты займа и слоты — по времени Казахстана (UTC+5).
 *
 * Дополнительно (только демо): `/api/demo/*` — переключение роли, перемотка времени и сброс,
 * которыми пользуется панель демо-режима. Тот же набор доступен как `window.LombardDemo`.
 */
(function (global) {
  "use strict";

  // ------------------------------------------------------------------------------------
  // Настройки (как `backend/app/core/config.py` по умолчанию)
  // ------------------------------------------------------------------------------------

  var DB_KEY = "lombard.demo.db";
  var PHOTO_KEY = "lombard.demo.photo.";
  var DB_VERSION = 1;
  var SETTINGS = {
    maxPhotos: 6,
    maxPhotoMb: 10,
    offerTtlHours: 72,
    slot: { dayStart: 10, dayEnd: 20, hours: 2, lead: 2, horizon: 7 },
    graceDays: 30,
    maxExtensions: 5,
    accessTtlMin: 30,
    refreshTtlDays: 14,
  };
  // Фото в демо хранятся в localStorage (≈5 МБ на сайт) — уменьшаем сильнее, чем backend.
  var PHOTO_FULL_SIDE = 1280;
  var PHOTO_THUMB_SIDE = 480;
  var PHOTO_MIN_SIDE = 200;
  var BACKEND_FULL_SIDE = 2560;
  var DEMO_PASSWORD = "demo1234";
  var LATENCY_MS = 60;

  var NBSP = " ";
  var HOUR = 3600 * 1000;
  var DAY = 24 * HOUR;
  var KZ_OFFSET = 5 * HOUR;

  // ------------------------------------------------------------------------------------
  // Справочники домена (`backend/app/domain`)
  // ------------------------------------------------------------------------------------

  var STATUSES = [
    "DRAFT",
    "SUBMITTED",
    "PRE_ESTIMATED",
    "UNDER_REVIEW",
    "NEED_INFO",
    "OFFER_SENT",
    "OFFER_ACCEPTED",
    "OFFER_DECLINED",
    "REJECTED",
    "COURIER_SCHEDULED",
    "COURIER_EN_ROUTE",
    "ITEM_PICKED_UP",
    "ITEM_DELIVERED",
    "INSPECTED",
    "FUNDS_ISSUED",
    "LOAN_ACTIVE",
    "EXTENDED",
    "OVERDUE",
    "REPAID",
    "ITEM_RETURNED",
    "FORFEITED",
  ];

  var STATUS_LABELS = {
    DRAFT: "Черновик",
    SUBMITTED: "Отправлена",
    PRE_ESTIMATED: "Предоценка готова",
    UNDER_REVIEW: "У эксперта",
    NEED_INFO: "Нужны фото",
    OFFER_SENT: "Предложение",
    OFFER_ACCEPTED: "Предложение принято",
    OFFER_DECLINED: "Отказ клиента",
    REJECTED: "Отклонена",
    COURIER_SCHEDULED: "Курьер назначен",
    COURIER_EN_ROUTE: "Курьер в пути",
    ITEM_PICKED_UP: "Изделие у курьера",
    ITEM_DELIVERED: "В ломбарде",
    INSPECTED: "Осмотрено",
    FUNDS_ISSUED: "Деньги выданы",
    LOAN_ACTIVE: "Займ действует",
    EXTENDED: "Продлён",
    OVERDUE: "Просрочка",
    REPAID: "Погашен",
    ITEM_RETURNED: "Изделие возвращено",
    FORFEITED: "Перешло ломбарду",
  };

  // (из, в) → кто может выполнить переход (`state_machine.py`).
  var TRANSITIONS = {
    "DRAFT>SUBMITTED": ["CLIENT"],
    "SUBMITTED>PRE_ESTIMATED": ["SYSTEM"],
    "PRE_ESTIMATED>UNDER_REVIEW": ["EXPERT"],
    "UNDER_REVIEW>OFFER_SENT": ["EXPERT"],
    "UNDER_REVIEW>REJECTED": ["EXPERT"],
    "UNDER_REVIEW>NEED_INFO": ["EXPERT"],
    "NEED_INFO>SUBMITTED": ["CLIENT"],
    "OFFER_SENT>OFFER_ACCEPTED": ["CLIENT"],
    "OFFER_SENT>OFFER_DECLINED": ["CLIENT", "SYSTEM"],
    "OFFER_ACCEPTED>COURIER_SCHEDULED": ["CLIENT", "ADMIN"],
    "COURIER_SCHEDULED>COURIER_EN_ROUTE": ["COURIER"],
    "COURIER_EN_ROUTE>ITEM_PICKED_UP": ["COURIER"],
    "ITEM_PICKED_UP>ITEM_DELIVERED": ["COURIER"],
    "ITEM_DELIVERED>INSPECTED": ["EXPERT"],
    "INSPECTED>FUNDS_ISSUED": ["SYSTEM", "ADMIN"],
    "FUNDS_ISSUED>LOAN_ACTIVE": ["SYSTEM"],
    "LOAN_ACTIVE>REPAID": ["CLIENT", "SYSTEM"],
    "LOAN_ACTIVE>EXTENDED": ["CLIENT"],
    "EXTENDED>LOAN_ACTIVE": ["SYSTEM"],
    "LOAN_ACTIVE>OVERDUE": ["SYSTEM", "ADMIN"],
    "OVERDUE>REPAID": ["CLIENT", "SYSTEM"],
    "OVERDUE>EXTENDED": ["CLIENT"],
    "OVERDUE>FORFEITED": ["SYSTEM", "ADMIN"],
    "REPAID>ITEM_RETURNED": ["COURIER"],
  };

  var ROLES = ["CLIENT", "EXPERT", "COURIER", "ADMIN"];
  var METALS = ["GOLD", "SILVER", "PLATINUM", "PALLADIUM"];
  var CONDITIONS = ["NEW", "EXCELLENT", "GOOD", "FAIR", "POOR"];

  var METAL_LABELS = {
    GOLD: "Золото",
    SILVER: "Серебро",
    PLATINUM: "Платина",
    PALLADIUM: "Палладий",
  };
  var CONDITION_LABELS = {
    NEW: "Новое",
    EXCELLENT: "Отличное",
    GOOD: "Хорошее",
    FAIR: "Удовлетворительное",
    POOR: "Плохое",
  };
  var FINENESS_BY_METAL = {
    GOLD: [375, 500, 583, 585, 750, 850, 875, 900, 916, 958, 999],
    SILVER: [800, 830, 875, 900, 916, 925, 960, 999],
    PLATINUM: [585, 850, 900, 950, 999],
    PALLADIUM: [500, 850, 950, 999],
  };
  var CATEGORY_METALS = {
    gold: ["GOLD"],
    silver: ["SILVER"],
    platinum: ["PLATINUM", "PALLADIUM"],
  };
  var CONDITION_FACTORS = {
    metal: { NEW: 1.0, EXCELLENT: 1.0, GOOD: 0.97, FAIR: 0.93, POOR: 0.85 },
    watches: { NEW: 1.0, EXCELLENT: 0.85, GOOD: 0.7, FAIR: 0.5, POOR: 0.3 },
    electronics: { NEW: 1.0, EXCELLENT: 0.75, GOOD: 0.6, FAIR: 0.4, POOR: 0.2 },
    generic: { NEW: 1.0, EXCELLENT: 0.85, GOOD: 0.7, FAIR: 0.5, POOR: 0.3 },
  };

  function tier(code, label, baseTenge, brands, conf) {
    return { code: code, label: label, base: baseTenge * 100, brands: brands, conf: conf };
  }
  var BRAND_TIERS = {
    watches: [
      tier(
        "luxury",
        "Люкс",
        3500000,
        [
          "rolex",
          "patek philippe",
          "audemars piguet",
          "richard mille",
          "vacheron constantin",
          "a. lange & sohne",
          "breguet",
          "ролекс",
        ],
        55,
      ),
      tier(
        "premium",
        "Премиум",
        1500000,
        [
          "omega",
          "cartier",
          "breitling",
          "iwc",
          "jaeger-lecoultre",
          "panerai",
          "hublot",
          "zenith",
          "chopard",
          "омега",
          "картье",
        ],
        60,
      ),
      tier(
        "middle",
        "Средний сегмент",
        500000,
        [
          "tag heuer",
          "longines",
          "tudor",
          "rado",
          "oris",
          "maurice lacroix",
          "frederique constant",
          "baume & mercier",
          "лонжин",
        ],
        60,
      ),
      tier(
        "entry",
        "Массовый сегмент",
        120000,
        [
          "tissot",
          "seiko",
          "citizen",
          "orient",
          "casio",
          "g-shock",
          "swatch",
          "hamilton",
          "certina",
          "mido",
          "тиссо",
          "сейко",
          "касио",
        ],
        60,
      ),
    ],
    electronics: [
      tier(
        "flagship",
        "Флагманы",
        350000,
        ["apple", "iphone", "macbook", "ipad", "эппл", "айфон", "макбук"],
        55,
      ),
      tier(
        "upper",
        "Верхний сегмент",
        220000,
        ["samsung", "sony", "google", "microsoft", "dell", "lenovo", "asus", "hp", "самсунг"],
        50,
      ),
      tier(
        "middle",
        "Средний сегмент",
        110000,
        [
          "xiaomi",
          "huawei",
          "honor",
          "oneplus",
          "acer",
          "realme",
          "oppo",
          "vivo",
          "nothing",
          "сяоми",
          "хуавей",
        ],
        50,
      ),
    ],
  };
  var UNKNOWN_BRAND_VALUE = { watches: 4000000, electronics: 6000000, generic: 5000000 };
  var UNKNOWN_BRAND_CONFIDENCE = 25;
  var JEWELLERY_PREMIUMS = [
    [
      1.3,
      "ювелирный дом",
      [
        "cartier",
        "tiffany",
        "tiffany & co",
        "bvlgari",
        "bulgari",
        "van cleef & arpels",
        "chopard",
        "graff",
        "harry winston",
        "картье",
        "тиффани",
      ],
    ],
    [1.1, "известный бренд", ["pandora", "sokolov", "sunlight", "swarovski", "пандора", "соколов"]],
  ];
  var PARAMS_WEIGHT = 0.65;
  var PHOTOS_WEIGHT = 0.35;
  var METHOD_VERSION = "formula-v1";

  // Займ (`loan_calc.py`, `loans.py`).
  var BP_DENOMINATOR = 10000;
  var GRACE_DAYS = 30;
  var MIN_LOAN_AMOUNT = 100000; // 1 000 ₸
  var MAX_MARKET_VALUE = 10000000000; // 100 млн ₸
  var MAX_REQUESTED_AMOUNT = 10000000000;
  var LOAN_STEP = 10000; // 100 ₸
  var SCHEDULE_STEP_DAYS = 7;
  var DUE_SOON_DAYS = 3;
  var EXPERT_DEFAULT_CONFIDENCE = 90;

  var LOAN_STATUS_LABELS = {
    ACTIVE: "Действует",
    OVERDUE: "Просрочен",
    REPAID: "Погашен",
    FORFEITED: "Изделие перешло ломбарду",
  };
  var PAYMENT_KIND_LABELS = {
    DISBURSEMENT: "Выдача займа",
    REPAYMENT: "Погашение",
    EXTENSION: "Оплата процентов (продление)",
  };
  var PAYMENT_STATUS_LABELS = { PENDING: "В обработке", SUCCEEDED: "Проведён", FAILED: "Отклонён" };
  var OFFER_STATUS_LABELS = {
    SENT: "Ждёт решения клиента",
    ACCEPTED: "Принято",
    DECLINED: "Отклонено клиентом",
    EXPIRED: "Истёк срок",
    SUPERSEDED: "Заменено новым",
  };

  // Логистика (`logistics.py`).
  var TASK_STATUS_LABELS = {
    SCHEDULED: "Назначен",
    EN_ROUTE: "В пути",
    PICKED_UP: "Изделие у курьера",
    DELIVERED: "Доставлено",
    CANCELLED: "Отменён",
  };
  var TASK_KIND_LABELS = { PICKUP: "Забрать у клиента", RETURN: "Вернуть клиенту" };
  var STEP_LABELS = { start: "Выехал", pick_up: "Забрал изделие", deliver: "Доставил" };
  var OPEN_TASK_STATUSES = ["SCHEDULED", "EN_ROUTE", "PICKED_UP"];
  // kind:step → [статус выезда до, после, статус заявки после (null — не меняется)]
  var STEPS = {
    "PICKUP:start": ["SCHEDULED", "EN_ROUTE", "COURIER_EN_ROUTE"],
    "PICKUP:pick_up": ["EN_ROUTE", "PICKED_UP", "ITEM_PICKED_UP"],
    "PICKUP:deliver": ["PICKED_UP", "DELIVERED", "ITEM_DELIVERED"],
    "RETURN:deliver": ["EN_ROUTE", "DELIVERED", "ITEM_RETURNED"],
    "RETURN:start": ["SCHEDULED", "EN_ROUTE", null],
  };
  var STEP_NOTES = {
    "PICKUP:start": [
      "Курьер выехал",
      "Курьер {courier} уже в пути. Подготовьте изделие и документ, удостоверяющий личность.",
    ],
    "PICKUP:pick_up": [
      "Курьер забрал изделие",
      "Изделие опечатано и едет в ломбард. После доставки эксперт проведёт осмотр.",
    ],
    "PICKUP:deliver": [
      "Изделие в ломбарде",
      "Изделие доставлено. Эксперт осмотрит его и подтвердит сумму займа.",
    ],
    "RETURN:start": ["Курьер везёт изделие", "Курьер {courier} выехал, чтобы вернуть изделие."],
    "RETURN:deliver": [
      "Изделие возвращено",
      "Курьер передал вам изделие. Спасибо, что воспользовались ломбардом!",
    ],
  };

  // Мок-банк (`payments.py`).
  var DECLINED_CARD = "4000000000000002";
  var NO_FUNDS_CARD = "4000000000009995";

  // ------------------------------------------------------------------------------------
  // Ошибки → HTTP (как `backend/app/api/errors.py`)
  // ------------------------------------------------------------------------------------

  function HttpError(status, body, commit) {
    this.status = status;
    this.body = body;
    this.commit = Boolean(commit); // сохранить изменения, несмотря на ошибку
  }

  function problems(list, message) {
    return new HttpError(422, {
      detail: list.map(function (p) {
        return { loc: ["body", p[0]], msg: p[1], type: "business_rule" };
      }),
      message: message || "Проверьте данные заявки",
    });
  }
  function conflict(msg, commit) {
    return new HttpError(409, { detail: msg }, commit);
  }
  function notFound(msg) {
    return new HttpError(404, { detail: msg });
  }
  function forbidden(msg) {
    return new HttpError(403, { detail: msg || "Недостаточно прав для этого действия" });
  }
  function unauthorized(msg) {
    return new HttpError(401, { detail: msg || "Требуется вход в систему" });
  }

  /** Проверка тела запроса — аналог pydantic: собирает ошибки и отдаёт 422 `{detail}`. */
  function Validator(body, loc) {
    this.body = body && typeof body === "object" ? body : {};
    this.loc = loc || "body";
    this.errors = [];
    this.out = {};
  }
  Validator.prototype.fail = function (field, msg) {
    this.errors.push({ loc: [this.loc, field], msg: msg, type: "value_error" });
  };
  Validator.prototype.has = function (field) {
    return Object.prototype.hasOwnProperty.call(this.body, field);
  };
  Validator.prototype.str = function (field, opts) {
    opts = opts || {};
    var v = this.body[field];
    if (v === undefined || v === null) {
      if (opts.required) this.fail(field, "Обязательное поле");
      else if (this.has(field)) this.out[field] = null;
      return;
    }
    if (typeof v !== "string") return this.fail(field, "Ожидается строка");
    if (opts.min && v.length < opts.min)
      return this.fail(field, "Минимальная длина — " + opts.min + " симв.");
    if (opts.max && v.length > opts.max)
      return this.fail(field, "Максимальная длина — " + opts.max + " симв.");
    if (opts.pattern && !opts.pattern.test(v)) return this.fail(field, "Недопустимый формат");
    this.out[field] = v;
  };
  Validator.prototype.num = function (field, opts) {
    opts = opts || {};
    var v = this.body[field];
    if (v === undefined || v === null || v === "") {
      if (opts.required) this.fail(field, "Обязательное поле");
      else if (this.has(field)) this.out[field] = null;
      return;
    }
    var n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
    if (!isFinite(n))
      return this.fail(field, opts.decimal ? "Ожидается число" : "Ожидается целое число");
    if (!opts.decimal && Math.floor(n) !== n) return this.fail(field, "Ожидается целое число");
    if (opts.decimal && decimals(v) > opts.decimal) {
      return this.fail(field, "Не больше " + opts.decimal + " знаков после запятой");
    }
    if (opts.gt !== undefined && !(n > opts.gt))
      return this.fail(field, "Значение должно быть больше " + opts.gt);
    if (opts.ge !== undefined && !(n >= opts.ge))
      return this.fail(field, "Значение должно быть не меньше " + opts.ge);
    if (opts.le !== undefined && !(n <= opts.le))
      return this.fail(field, "Значение должно быть не больше " + opts.le);
    this.out[field] = n;
  };
  Validator.prototype.oneOf = function (field, values, required) {
    var v = this.body[field];
    if (v === undefined || v === null) {
      if (required) this.fail(field, "Обязательное поле");
      else if (this.has(field)) this.out[field] = null;
      return;
    }
    if (values.indexOf(v) < 0) {
      return this.fail(
        field,
        "Допустимые значения: " +
          values
            .map(function (x) {
              return "'" + x + "'";
            })
            .join(", "),
      );
    }
    this.out[field] = v;
  };
  Validator.prototype.bool = function (field) {
    var v = this.body[field];
    if (v === undefined || v === null) {
      if (this.has(field)) this.out[field] = null;
      return;
    }
    if (typeof v !== "boolean") return this.fail(field, "Ожидается логическое значение");
    this.out[field] = v;
  };
  Validator.prototype.phone = function (field) {
    var v = this.body[field];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      if (this.has(field)) this.out[field] = null;
      return;
    }
    try {
      this.out[field] = normalizeKzPhone(String(v));
    } catch (e) {
      this.fail(field, e.message);
    }
  };
  Validator.prototype.done = function () {
    if (this.errors.length) throw new HttpError(422, { detail: this.errors });
    return this.out;
  };

  function decimals(v) {
    var s = String(v);
    if (/e-/i.test(s)) return 99;
    var dot = s.search(/[.,]/);
    return dot < 0 ? 0 : s.length - dot - 1;
  }
  function squash(s) {
    return s.split(/\s+/).filter(Boolean).join(" ");
  }
  function squashOrNull(s) {
    if (s === null || s === undefined) return null;
    var v = squash(s);
    return v || null;
  }
  function stripOrNull(s) {
    if (s === null || s === undefined) return null;
    return s.trim() || null;
  }

  // ------------------------------------------------------------------------------------
  // Деньги, даты, телефоны
  // ------------------------------------------------------------------------------------

  /** Округление как в Python 3 (`round`): половина — к чётному. */
  function pyRound(x) {
    var r = Math.round(x);
    if (Math.abs(x % 1) === 0.5 && r % 2 !== 0) r -= 1;
    return r;
  }
  function roundTiyn(amount, stepTenge) {
    var step = (stepTenge || 100) * 100;
    return Math.floor((amount + step / 2) / step) * step;
  }
  function pad(n, w) {
    var s = String(n);
    while (s.length < (w || 2)) s = "0" + s;
    return s;
  }
  function formatKzt(amount) {
    var sign = amount < 0 ? "−" : "";
    var abs = Math.abs(amount);
    var whole = Math.floor(abs / 100);
    var frac = abs % 100;
    var groups = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return sign + groups + (frac ? "," + pad(frac) : "") + NBSP + "₸";
  }
  function formatRate(bp) {
    var whole = Math.floor(bp / 100);
    var frac = bp % 100;
    var tail = frac ? ("," + pad(frac)).replace(/0+$/, "") : "";
    return whole + tail + NBSP + "%" + " в" + NBSP + "день";
  }
  function fmtG(x) {
    return String(parseFloat(x.toPrecision(6)));
  }

  function iso(ms) {
    return ms === null || ms === undefined ? null : new Date(ms).toISOString();
  }
  /** Календарная дата по Казахстану «2026-11-06». */
  function kzDate(ms) {
    return new Date(ms + KZ_OFFSET).toISOString().slice(0, 10);
  }
  function addDays(isoDate, n) {
    var d = new Date(isoDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
  }
  /** «06.11.2026». */
  function fmtDate(isoDate) {
    var p = isoDate.split("-");
    return p[2] + "." + p[1] + "." + p[0];
  }
  /** «06.11.2026 14:40» по Казахстану. */
  function fmtDateTime(ms) {
    var d = new Date(ms + KZ_OFFSET);
    return (
      pad(d.getUTCDate()) +
      "." +
      pad(d.getUTCMonth() + 1) +
      "." +
      d.getUTCFullYear() +
      " " +
      pad(d.getUTCHours()) +
      ":" +
      pad(d.getUTCMinutes())
    );
  }
  /** Конец местного дня срока (23:59:59 UTC+5), в мс UTC. */
  function dueAtFor(isoDate) {
    return Date.parse(isoDate + "T23:59:59Z") - KZ_OFFSET;
  }

  function normalizeKzPhone(raw) {
    var text = raw.trim();
    if (!/^[\d\s()+\-.]+$/.test(text)) {
      throw new Error("Телефон может содержать только цифры, пробелы, скобки и дефисы");
    }
    var digits = text.replace(/\D/g, "");
    if (text.charAt(0) === "+" && !(digits.length === 11 && digits.charAt(0) === "7")) {
      throw new Error("Введите номер в формате +7 7XX XXX-XX-XX");
    }
    if (digits.length === 11 && (digits.charAt(0) === "7" || digits.charAt(0) === "8")) {
      digits = "7" + digits.slice(1);
    } else if (digits.length === 10) {
      digits = "7" + digits;
    } else {
      throw new Error("Введите номер в формате +7 7XX XXX-XX-XX");
    }
    if (digits.charAt(1) !== "7") throw new Error("Номер Казахстана должен начинаться с +7 7…");
    return "+" + digits;
  }
  function formatKzPhone(e164) {
    var d = e164.replace(/^\+/, "");
    if (d.length !== 11) return e164;
    return (
      "+" +
      d[0] +
      " " +
      d.slice(1, 4) +
      " " +
      d.slice(4, 7) +
      "-" +
      d.slice(7, 9) +
      "-" +
      d.slice(9, 11)
    );
  }

  // ------------------------------------------------------------------------------------
  // Предоценка (`pricing.py`)
  // ------------------------------------------------------------------------------------

  function normalizeBrand(brand) {
    if (!brand) return "";
    var s = brand.toLowerCase().replace(/ё/g, "е").replace(/ö/g, "o").replace(/é/g, "e");
    s = s.replace(/\band\b/g, "&");
    s = s.replace(/[\s\-_.]+/g, " ");
    return s.trim();
  }
  function brandMatches(normalized, candidates) {
    var padded = " " + normalized + " ";
    return candidates.some(function (c) {
      return padded.indexOf(" " + normalizeBrand(c) + " ") >= 0;
    });
  }
  function findBrandTier(categoryCode, brand) {
    var normalized = normalizeBrand(brand);
    if (!normalized) return null;
    var tiers = BRAND_TIERS[categoryCode] || [];
    for (var i = 0; i < tiers.length; i++) {
      if (brandMatches(normalized, tiers[i].brands)) return tiers[i];
    }
    return null;
  }
  function jewelleryPremium(brand) {
    var normalized = normalizeBrand(brand);
    if (normalized) {
      for (var i = 0; i < JEWELLERY_PREMIUMS.length; i++) {
        if (brandMatches(normalized, JEWELLERY_PREMIUMS[i][2])) {
          return [JEWELLERY_PREMIUMS[i][0], JEWELLERY_PREMIUMS[i][1]];
        }
      }
    }
    return [1.0, null];
  }
  function meltValue(weightMg, fineness, pricePerGram) {
    return (((weightMg / 1000) * fineness) / 1000) * pricePerGram;
  }
  function confidenceLabel(c) {
    return c >= 75 ? "высокая" : c >= 45 ? "средняя" : "низкая";
  }
  function rangeHalfWidth(c) {
    return 0.04 + ((100 - c) / 100) * 0.4;
  }

  function EstimateError(message) {
    this.message = message;
  }

  function conditionStep(inp, table, steps) {
    var condition = inp.condition || "GOOD";
    var factor = CONDITION_FACTORS[table][condition];
    var note = inp.condition ? "" : " (не указано — принято «Хорошее»)";
    steps.push({ label: "Состояние: " + CONDITION_LABELS[condition] + note, factor: factor });
    return [factor, inp.condition ? 0 : 10];
  }

  function estimateMetal(inp, steps) {
    if (!inp.metal || inp.fineness == null || inp.weight_mg == null) {
      throw new EstimateError("Для оценки по металлу нужны металл, проба и вес");
    }
    if (!inp.metal_price_per_gram) {
      throw new EstimateError("Нет цены на металл «" + METAL_LABELS[inp.metal] + "»");
    }
    var melt = meltValue(inp.weight_mg, inp.fineness, inp.metal_price_per_gram);
    steps.push({
      label:
        METAL_LABELS[inp.metal] +
        " " +
        inp.fineness +
        " пробы, " +
        fmtG(inp.weight_mg / 1000) +
        " г × " +
        formatKzt(inp.metal_price_per_gram) +
        "/г (999)",
      amount: pyRound(melt),
    });
    var prem = jewelleryPremium(inp.brand);
    if (prem[0] !== 1.0)
      steps.push({ label: "Бренд «" + inp.brand + "» — " + prem[1], factor: prem[0] });
    var cond = conditionStep(inp, "metal", steps);
    return [melt * prem[0] * cond[0], 90 - cond[1]];
  }

  function estimateBrand(inp, steps, warnings) {
    var table =
      UNKNOWN_BRAND_VALUE[inp.category_code] !== undefined ? inp.category_code : "generic";
    var t = findBrandTier(inp.category_code, inp.brand);
    var base, paramsConf;
    if (t) {
      base = t.base;
      paramsConf = t.conf;
      steps.push({ label: inp.category_name + ": «" + inp.brand + "» — " + t.label, amount: base });
    } else {
      base = UNKNOWN_BRAND_VALUE[table];
      paramsConf = UNKNOWN_BRAND_CONFIDENCE;
      var what = inp.brand
        ? "бренд «" + inp.brand + "» не найден в справочнике"
        : "бренд не указан";
      steps.push({ label: inp.category_name + ": " + what, amount: base });
      warnings.push("Укажите бренд и модель — это заметно уточнит оценку");
    }
    var cond = conditionStep(inp, table, steps);
    var value = base * cond[0];
    paramsConf -= cond[1];
    if (inp.metal && inp.fineness && inp.weight_mg && inp.metal_price_per_gram) {
      var melt = meltValue(inp.weight_mg, inp.fineness, inp.metal_price_per_gram);
      paramsConf += 10;
      if (melt > value) {
        steps.push({
          label:
            "Стоимость металла (" +
            METAL_LABELS[inp.metal] +
            " " +
            inp.fineness +
            ", " +
            fmtG(inp.weight_mg / 1000) +
            " г) выше — берём её",
          amount: pyRound(melt),
        });
        value = melt;
      }
    }
    return [value, paramsConf];
  }

  function estimate(inp) {
    var steps = [];
    var warnings = [];
    var method, r;
    if (inp.requires_metal) {
      method = "metal";
      r = estimateMetal(inp, steps);
    } else {
      method = "brand";
      r = estimateBrand(inp, steps, warnings);
    }
    var raw = r[0];
    var paramsConf = Math.max(0, Math.min(100, r[1]));
    var confidence;
    if (inp.photo_confidence === null || inp.photo_confidence === undefined) {
      confidence = paramsConf * PARAMS_WEIGHT;
      warnings.push("Фото не анализировались");
    } else {
      confidence = paramsConf * PARAMS_WEIGHT + inp.photo_confidence * PHOTOS_WEIGHT;
    }
    var c = Math.max(5, Math.min(95, pyRound(confidence)));
    var value = Math.max(roundTiyn(raw), 10000);
    var half = rangeHalfWidth(c);
    var valueMin = Math.max(roundTiyn(raw * (1 - half)), 10000);
    var valueMax = Math.max(roundTiyn(raw * (1 + half)), value);
    valueMin = Math.min(valueMin, value);
    steps.push({
      label: "Диапазон ±" + pyRound(half * 100) + " % при уверенности " + c + " %",
      amount: value,
    });
    var loanMin = roundTiyn((valueMin * inp.ltv_percent) / 100);
    var loanMax = roundTiyn((value * inp.ltv_percent) / 100);
    return {
      value: value,
      value_min: valueMin,
      value_max: valueMax,
      confidence: c,
      method: method,
      params_confidence: paramsConf,
      photo_confidence: inp.photo_confidence === undefined ? null : inp.photo_confidence,
      loan_min: loanMin,
      loan_max: loanMax,
      steps: steps,
      warnings: warnings,
      summary:
        "Предварительная оценка " +
        formatKzt(valueMin) +
        " – " +
        formatKzt(valueMax) +
        ", уверенность " +
        confidenceLabel(c) +
        " (" +
        c +
        " %).",
    };
  }

  function validateMetalParams(categoryCode, requiresMetal, metal, fineness) {
    var errors = [];
    var allowed = CATEGORY_METALS[categoryCode];
    if (metal && requiresMetal && allowed && allowed.indexOf(metal) < 0) {
      var names = allowed
        .slice()
        .sort()
        .map(function (m) {
          return METAL_LABELS[m];
        })
        .join(", ");
      errors.push(["metal", "Для этой категории допустимы металлы: " + names]);
    }
    if (fineness !== null && fineness !== undefined) {
      if (!metal) errors.push(["fineness", "Проба указывается вместе с металлом"]);
      else if (FINENESS_BY_METAL[metal].indexOf(fineness) < 0) {
        errors.push([
          "fineness",
          "Проба " +
            fineness +
            " не используется для металла «" +
            METAL_LABELS[metal] +
            "». Допустимо: " +
            FINENESS_BY_METAL[metal].join(", "),
        ]);
      }
    }
    return errors;
  }

  // ------------------------------------------------------------------------------------
  // Калькулятор займа (`loan_calc.py`)
  // ------------------------------------------------------------------------------------

  function interestFor(principal, bp, days) {
    return Math.floor((principal * bp * days + BP_DENOMINATOR / 2) / BP_DENOMINATOR);
  }
  function maxLoanAmount(marketValue, ltv) {
    return Math.floor(Math.floor((marketValue * ltv) / 100) / LOAN_STEP) * LOAN_STEP;
  }
  function annualRate(bp) {
    return Math.round(((bp * 365) / 100) * 100) / 100;
  }
  function schedule(amount, bp, term, start) {
    var days = [1];
    for (var d = SCHEDULE_STEP_DAYS; d < term; d += SCHEDULE_STEP_DAYS) days.push(d);
    days.push(term);
    days = days
      .filter(function (x, i) {
        return days.indexOf(x) === i;
      })
      .sort(function (a, b) {
        return a - b;
      });
    return days.map(function (day) {
      var interest = interestFor(amount, bp, day);
      return {
        day: day,
        date: addDays(start, day),
        interest: interest,
        total: amount + interest,
        is_due_date: day === term,
      };
    });
  }
  function quote(amount, bp, term, start) {
    var interest = interestFor(amount, bp, term);
    var due = addDays(start, term);
    return {
      loan_amount: amount,
      daily_rate_bp: bp,
      rate_label: formatRate(bp),
      annual_rate_percent: annualRate(bp),
      term_days: term,
      interest: interest,
      total_to_repay: amount + interest,
      start_date: start,
      due_date: due,
      grace_until: addDays(due, GRACE_DAYS),
      schedule: schedule(amount, bp, term, start),
    };
  }
  function quoteSummary(q) {
    return (
      formatKzt(q.loan_amount) +
      " на " +
      q.term_days +
      " дн. под " +
      formatRate(q.daily_rate_bp) +
      ": вернуть " +
      formatKzt(q.total_to_repay) +
      " до " +
      fmtDate(q.due_date)
    );
  }
  function validateTerms(cat, t) {
    var errors = [];
    if (t.market_value <= 0) errors.push(["market_value", "Стоимость должна быть больше нуля"]);
    else if (t.market_value > MAX_MARKET_VALUE)
      errors.push(["market_value", "Стоимость не больше " + formatKzt(MAX_MARKET_VALUE)]);
    if (!(t.ltv_percent >= 1 && t.ltv_percent <= cat.ltv_percent)) {
      errors.push(["ltv_percent", cat.name + ": доля от оценки от 1 до " + cat.ltv_percent + " %"]);
    }
    if (!(t.daily_rate_bp >= 1 && t.daily_rate_bp <= cat.daily_rate_bp)) {
      errors.push([
        "daily_rate_bp",
        cat.name + ": ставка от " + formatRate(1) + " до " + formatRate(cat.daily_rate_bp),
      ]);
    }
    if (!(t.term_days >= cat.min_term_days && t.term_days <= cat.max_term_days)) {
      errors.push([
        "term_days",
        cat.name + ": срок от " + cat.min_term_days + " до " + cat.max_term_days + " дней",
      ]);
    }
    if (errors.length) return errors;
    var limit = maxLoanAmount(t.market_value, t.ltv_percent);
    var hasAmount = t.loan_amount !== null && t.loan_amount !== undefined;
    var amount = hasAmount ? t.loan_amount : limit;
    var field = hasAmount ? "loan_amount" : "market_value";
    if (amount < MIN_LOAN_AMOUNT)
      errors.push([field, "Сумма займа не меньше " + formatKzt(MIN_LOAN_AMOUNT)]);
    else if (hasAmount && t.loan_amount > limit) {
      errors.push([
        "loan_amount",
        "Не больше " +
          formatKzt(limit) +
          " (" +
          t.ltv_percent +
          " % от " +
          formatKzt(t.market_value) +
          ")",
      ]);
    } else if (hasAmount && t.loan_amount % LOAN_STEP) {
      errors.push(["loan_amount", "Сумма займа кратна 100" + NBSP + "₸"]);
    }
    return errors;
  }

  // ------------------------------------------------------------------------------------
  // Займ (`domain/loans.py`)
  // ------------------------------------------------------------------------------------

  function figures(loan, now) {
    var interestFrom = loan.interest_from || loan.issued_at;
    var today = kzDate(now);
    var used = Math.max(1, daysBetween(kzDate(interestFrom), today));
    var interest = interestFor(loan.principal, loan.daily_rate_bp, used);
    var dueDate = kzDate(loan.due_at);
    var graceUntil = addDays(dueDate, GRACE_DAYS);
    var daysLeft = daysBetween(today, dueDate);
    var phase =
      now <= loan.due_at ? "ACTIVE" : now <= loan.due_at + GRACE_DAYS * DAY ? "OVERDUE" : "FORFEIT";
    return {
      days_used: used,
      interest: interest,
      total_to_repay: loan.principal + interest,
      due_date: dueDate,
      grace_until: graceUntil,
      days_left: daysLeft,
      overdue_days: Math.max(0, -daysLeft),
      grace_days_left: Math.max(0, daysBetween(today, graceUntil)),
      phase: phase,
      due_soon: phase === "ACTIVE" && daysLeft <= DUE_SOON_DAYS,
    };
  }
  function ticketNumber(appId, issuedAt) {
    return "ЗБ-" + kzDate(issuedAt).slice(0, 4) + "-" + pad(appId, 6);
  }
  function normalizeCard(n) {
    return n.replace(/[\s-]/g, "");
  }
  function luhnOk(digits) {
    if (!/^\d+$/.test(digits)) return false;
    var total = 0;
    for (var i = 0; i < digits.length; i++) {
      var d = Number(digits.charAt(digits.length - 1 - i));
      if (i % 2) d = d > 4 ? d * 2 - 9 : d * 2;
      total += d;
    }
    return total % 10 === 0;
  }
  function cardProblem(number) {
    var digits = normalizeCard(number);
    if (!/^\d+$/.test(digits) || digits.length < 16 || digits.length > 19)
      return "Номер карты — 16–19 цифр";
    if (!luhnOk(digits)) return "Проверьте номер карты: похоже, в нём опечатка";
    return null;
  }
  function maskCard(number) {
    var d = normalizeCard(number);
    var masked = d.slice(0, 6) + new Array(d.length - 10 + 1).join("*") + d.slice(-4);
    var parts = [];
    for (var i = 0; i < masked.length; i += 4) parts.push(masked.slice(i, i + 4));
    return parts.join(" ");
  }

  // ------------------------------------------------------------------------------------
  // Анализ фото (`photo_appraiser.py`): те же метрики, но на canvas вместо Pillow
  // ------------------------------------------------------------------------------------

  var ANALYSIS_SIDE = 512;
  var RECOMMENDED_PHOTOS = 3;
  var DUPLICATE_DISTANCE = 6;

  function scale(value, points) {
    if (value <= points[0][0]) return pyRound(points[0][1]);
    for (var i = 1; i < points.length; i++) {
      var x0 = points[i - 1][0],
        y0 = points[i - 1][1],
        x1 = points[i][0],
        y1 = points[i][1];
      if (value <= x1) return pyRound(y0 + ((y1 - y0) * (value - x0)) / (x1 - x0));
    }
    return pyRound(points[points.length - 1][1]);
  }

  /** Метрики одного снимка по полутоновому изображению (≤512 px) и размеру файла. */
  function measureGray(gray, w, h, width, height) {
    var n = w * h;
    var sum = 0,
      sum2 = 0,
      i;
    for (i = 0; i < n; i++) {
      sum += gray[i];
      sum2 += gray[i] * gray[i];
    }
    var brightness = sum / n;
    var contrast = Math.sqrt(Math.max(0, sum2 / n - brightness * brightness));
    // Лапласиан с отступом 128 и обрезкой 0–255, края — как у исходника (как ImageFilter.Kernel).
    var lsum = 0,
      lsum2 = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x;
        var v;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) v = gray[idx];
        else {
          v = gray[idx - w] + gray[idx + w] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx] + 128;
          v = v < 0 ? 0 : v > 255 ? 255 : v;
        }
        lsum += v;
        lsum2 += v * v;
      }
    }
    var lmean = lsum / n;
    var sharpness = Math.max(0, lsum2 / n - lmean * lmean);

    var short = Math.min(width, height);
    var resolution = scale(short, [
      [200, 20],
      [480, 55],
      [800, 85],
      [1200, 100],
    ]);
    var exposure =
      brightness < 90
        ? scale(brightness, [
            [20, 0],
            [50, 40],
            [90, 100],
          ])
        : scale(brightness, [
            [180, 100],
            [215, 50],
            [245, 0],
          ]);
    var contrastScore = scale(contrast, [
      [8, 0],
      [25, 60],
      [45, 100],
    ]);
    var sharpnessScore = scale(sharpness, [
      [5, 0],
      [30, 40],
      [100, 80],
      [250, 100],
    ]);
    var score = pyRound(
      0.25 * resolution + 0.25 * exposure + 0.15 * contrastScore + 0.35 * sharpnessScore,
    );
    var issues = [];
    if (resolution < 55) issues.push("низкое разрешение");
    if (brightness < 60) issues.push("слишком тёмное");
    else if (brightness > 215) issues.push("пересвечено");
    if (contrastScore < 40) issues.push("низкий контраст");
    if (sharpnessScore < 40) issues.push("нерезкое");
    return {
      width: width,
      height: height,
      brightness: Math.round(brightness * 10) / 10,
      contrast: Math.round(contrast * 10) / 10,
      sharpness: Math.round(sharpness * 10) / 10,
      resolution_score: resolution,
      exposure_score: exposure,
      contrast_score: contrastScore,
      sharpness_score: sharpnessScore,
      score: score,
      issues: issues,
    };
  }

  function hamming(a, b) {
    var d = 0;
    for (var i = 0; i < a.length; i++) if (a.charAt(i) !== b.charAt(i)) d++;
    return d;
  }

  /** Сводный анализ набора фото (по сохранённым метрикам): уверенность и замечания. */
  function analyzePhotos(photos) {
    if (!photos.length) return { photos: [], confidence: 0, issues: ["Нет фотографий"] };
    var result = [];
    var hashes = [];
    photos.forEach(function (p, i) {
      var m = JSON.parse(JSON.stringify(p.metrics));
      m.index = i + 1;
      m.duplicate_of = null;
      for (var j = 0; j < hashes.length; j++) {
        if (hamming(p.ahash, hashes[j]) <= DUPLICATE_DISTANCE) {
          m.duplicate_of = j + 1;
          m.issues.push("похоже на фото " + (j + 1));
          break;
        }
      }
      result.push(m);
      hashes.push(p.ahash);
    });
    var unique = result.filter(function (m) {
      return m.duplicate_of === null;
    });
    var mean =
      unique.reduce(function (s, m) {
        return s + m.score;
      }, 0) / unique.length;
    var coverage = unique.length === 1 ? 0.6 : unique.length === 2 ? 0.8 : 1.0;
    var issues = result
      .filter(function (m) {
        return m.issues.length;
      })
      .map(function (m) {
        return "Фото " + m.index + ": " + m.issues.join(", ");
      });
    if (unique.length < RECOMMENDED_PHOTOS) {
      issues.push(
        "Добавьте ещё ракурсы: рекомендуем не меньше " +
          RECOMMENDED_PHOTOS +
          " разных фото (общий вид, клеймо/проба, бирка или документы)",
      );
    }
    return { photos: result, confidence: pyRound(mean * coverage), issues: issues };
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(r.error);
      };
      r.readAsDataURL(file);
    });
  }
  function readHead(file) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () {
        resolve(new Uint8Array(r.result));
      };
      r.onerror = function () {
        resolve(new Uint8Array(0));
      };
      r.readAsArrayBuffer(file.slice(0, 16));
    });
  }
  function sniffFormat(b) {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "JPEG";
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
      return "PNG";
    if (
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50
    )
      return "WEBP";
    return null;
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("decode"));
      };
      img.src = src;
    });
  }
  function fitted(w, h, side) {
    var k = Math.min(1, side / Math.max(w, h));
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  }
  function drawTo(img, w, h) {
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // прозрачный PNG — на белом фоне, как в backend
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas: canvas, ctx: ctx };
  }
  function grayOf(ctx, w, h) {
    var data = ctx.getImageData(0, 0, w, h).data;
    var gray = new Float64Array(w * h);
    for (var i = 0, j = 0; i < data.length; i += 4, j++) {
      // Pillow: L = R·299/1000 + G·587/1000 + B·114/1000
      gray[j] = (data[i] * 19595 + data[i + 1] * 38470 + data[i + 2] * 7471 + 0x8000) >> 16;
    }
    return gray;
  }

  /** Нормализация как `normalize_photo`: JPEG без EXIF, уменьшенный, с миниатюрой и метриками. */
  function processImage(src) {
    return loadImage(src).then(function (img) {
      var w = img.naturalWidth,
        h = img.naturalHeight;
      if (!w || !h) throw new Error("decode");
      if (Math.min(w, h) < PHOTO_MIN_SIDE) {
        var small = new Error("small");
        small.small = true;
        throw small;
      }
      var full = fitted(w, h, PHOTO_FULL_SIDE);
      var fullCanvas = drawTo(img, full[0], full[1]).canvas;
      var thumb = fitted(w, h, PHOTO_THUMB_SIDE);
      var thumbCanvas = drawTo(img, thumb[0], thumb[1]).canvas;
      var a = fitted(w, h, ANALYSIS_SIDE);
      var analysis = drawTo(img, a[0], a[1]);
      var backend = fitted(w, h, BACKEND_FULL_SIDE); // размеры, которые сохранил бы backend
      var metrics = measureGray(
        grayOf(analysis.ctx, a[0], a[1]),
        a[0],
        a[1],
        backend[0],
        backend[1],
      );
      var hashCtx = drawTo(img, 8, 8).ctx;
      var g8 = grayOf(hashCtx, 8, 8);
      var mean = 0,
        i;
      for (i = 0; i < 64; i++) mean += g8[i];
      mean /= 64;
      var bits = "";
      for (i = 0; i < 64; i++) bits += g8[i] > mean ? "1" : "0";
      return {
        full: fullCanvas.toDataURL("image/jpeg", 0.85),
        thumb: thumbCanvas.toDataURL("image/jpeg", 0.8),
        width: backend[0],
        height: backend[1],
        metrics: metrics,
        ahash: bits,
      };
    });
  }

  // ------------------------------------------------------------------------------------
  // Хранилище
  // ------------------------------------------------------------------------------------

  var storage = null;
  try {
    storage = global.localStorage;
    var probe = "lombard.demo.probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
  } catch (e) {
    storage = null; // приватный режим: данные живут до перезагрузки
  }
  var memory = {};
  function sget(key) {
    if (storage) {
      try {
        return storage.getItem(key);
      } catch (e) {
        /* недоступно */
      }
    }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }
  function sset(key, value) {
    if (storage) {
      storage.setItem(key, value); // QuotaExceededError уходит вызывающему
      return;
    }
    memory[key] = value;
  }
  function sremove(key) {
    if (storage) {
      try {
        storage.removeItem(key);
      } catch (e) {
        /* ignore */
      }
    }
    delete memory[key];
  }
  function quotaError() {
    return new HttpError(413, {
      detail:
        "В хранилище браузера закончилось место для демо. Удалите лишние черновики или нажмите «Сбросить демо».",
    });
  }

  var db = null;
  var photoCache = {};

  function emptyDb() {
    return {
      version: DB_VERSION,
      seq: {},
      clock_offset: 0,
      last_by_role: {},
      users: [],
      categories: [],
      metal_prices: [],
      applications: [],
      photos: [],
      appraisals: [],
      offers: [],
      tasks: [],
      loans: [],
      payments: [],
      history: [],
      notifications: [],
    };
  }
  function nextId(table) {
    db.seq[table] = (db.seq[table] || 0) + 1;
    return db.seq[table];
  }
  function insert(table, row) {
    row.id = nextId(table);
    db[table].push(row);
    return row;
  }
  function byId(table, id) {
    for (var i = 0; i < db[table].length; i++) if (db[table][i].id === id) return db[table][i];
    return null;
  }
  function where(table, pred) {
    return db[table].filter(pred);
  }
  function save() {
    sset(DB_KEY, JSON.stringify(db));
  }
  function load() {
    var raw = sget(DB_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return parsed && parsed.version === DB_VERSION ? parsed : null;
    } catch (e) {
      return null;
    }
  }
  function photoData(id, variant) {
    var key = PHOTO_KEY + id + "." + variant;
    if (!(key in photoCache)) photoCache[key] = sget(key) || "";
    return photoCache[key];
  }
  function storePhotoData(id, full, thumb) {
    var keys = [PHOTO_KEY + id + ".f", PHOTO_KEY + id + ".t"];
    try {
      sset(keys[0], full);
      sset(keys[1], thumb);
    } catch (e) {
      keys.forEach(sremove);
      throw quotaError();
    }
    photoCache[keys[0]] = full;
    photoCache[keys[1]] = thumb;
  }
  function removePhotoData(id) {
    [".f", ".t"].forEach(function (s) {
      sremove(PHOTO_KEY + id + s);
      delete photoCache[PHOTO_KEY + id + s];
    });
  }
  function wipeStorage() {
    if (storage) {
      var keys = [];
      for (var i = 0; i < storage.length; i++) {
        var k = storage.key(i);
        if (k && k.indexOf("lombard.demo.") === 0) keys.push(k);
      }
      keys.forEach(sremove);
    }
    memory = {};
    photoCache = {};
  }

  // ------------------------------------------------------------------------------------
  // Часы приложения («перемотка времени»)
  // ------------------------------------------------------------------------------------

  function now() {
    return Date.now() + (db ? db.clock_offset : 0);
  }
  function today() {
    return kzDate(now());
  }
  function clockRead() {
    var seconds = Math.floor(db.clock_offset / 1000);
    return {
      now: iso(now()),
      offset_seconds: seconds,
      offset_days: Math.round((seconds / 86400) * 100) / 100,
      enabled: true,
    };
  }

  // ------------------------------------------------------------------------------------
  // Пользователи и вход
  // ------------------------------------------------------------------------------------

  function userRead(u) {
    return {
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      phone: u.phone,
      phone_display: u.phone ? formatKzPhone(u.phone) : null,
      role: u.role,
      is_active: u.is_active,
      city: u.city,
      created_at: iso(u.created_at),
      last_login_at: iso(u.last_login_at),
    };
  }
  function brief(u) {
    return u ? { id: u.id, full_name: u.full_name, phone: u.phone, city: u.city } : null;
  }
  function findUserByEmail(email) {
    var e = String(email).toLowerCase();
    for (var i = 0; i < db.users.length; i++)
      if (db.users[i].email.toLowerCase() === e) return db.users[i];
    return null;
  }
  function randomToken() {
    var s = "";
    for (var i = 0; i < 24; i++)
      s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36));
    return s;
  }
  function tokenPair(user) {
    var t = Date.now();
    return {
      access_token: "demo-access." + user.id + "." + randomToken(),
      refresh_token: "demo-refresh." + user.id + "." + randomToken(),
      token_type: "bearer",
      access_expires_at: iso(t + SETTINGS.accessTtlMin * 60000),
      refresh_expires_at: iso(t + SETTINGS.refreshTtlDays * DAY),
    };
  }
  function authResponse(user) {
    var pair = tokenPair(user);
    pair.user = userRead(user);
    db.last_by_role[user.role] = user.id;
    return pair;
  }
  function userFromToken(token, kind) {
    var m = /^demo-(access|refresh)\.(\d+)\./.exec(token || "");
    if (!m || m[1] !== kind) return null;
    return byId("users", Number(m[2]));
  }

  // ------------------------------------------------------------------------------------
  // Машина состояний, история, уведомления
  // ------------------------------------------------------------------------------------

  function changeStatus(app, target, user, comment, at) {
    var actor = user ? user.role : "SYSTEM";
    var current = app.status;
    var actors = TRANSITIONS[current + ">" + target];
    if (!actors) {
      throw conflict(
        "Переход «" + STATUS_LABELS[current] + "» → «" + STATUS_LABELS[target] + "» невозможен",
      );
    }
    if (actors.indexOf(actor) < 0) {
      throw forbidden(
        "Роль " +
          actor +
          " не может перевести заявку из «" +
          STATUS_LABELS[current] +
          "» в «" +
          STATUS_LABELS[target] +
          "»",
      );
    }
    var t = at || now();
    app.status = target;
    app.updated_at = t;
    if (target === "SUBMITTED" && !app.submitted_at) app.submitted_at = t;
    return insert("history", {
      application_id: app.id,
      from_status: current,
      to_status: target,
      actor_id: user ? user.id : null,
      actor_role: user ? user.role : null,
      comment: comment || null,
      created_at: t,
    });
  }
  function historyNote(app, user, text, at) {
    insert("history", {
      application_id: app.id,
      from_status: app.status,
      to_status: app.status,
      actor_id: user ? user.id : null,
      actor_role: user ? user.role : null,
      comment: text,
      created_at: at || now(),
    });
  }

  function notify(userId, title, body, app, opts) {
    opts = opts || {};
    var t = now();
    insert("notifications", {
      user_id: userId,
      application_id: app ? app.id : null,
      channel: "IN_APP",
      title: title,
      body: body,
      is_read: false,
      created_at: t,
    });
    var user = byId("users", userId);
    if (!user) return;
    // Мок SMS / e-mail: «журнал отправки», как MockMessenger.
    if (opts.sms && user.phone) {
      var text = title + ". " + body;
      if (text.length > 160) text = text.slice(0, 159) + "…";
      insert("notifications", {
        user_id: userId,
        application_id: app ? app.id : null,
        channel: "SMS",
        title: formatKzPhone(user.phone),
        body: text,
        is_read: true,
        created_at: t,
      });
    }
    if (opts.email) {
      insert("notifications", {
        user_id: userId,
        application_id: app ? app.id : null,
        channel: "EMAIL",
        title: title,
        body: "Здравствуйте, " + user.full_name + "!\n\n" + body + "\n\n— Ломбард онлайн",
        is_read: true,
        created_at: t,
      });
    }
  }

  // ------------------------------------------------------------------------------------
  // Заявки: выборки
  // ------------------------------------------------------------------------------------

  function appNumber(app) {
    return "Л-" + pad(app.id, 6);
  }
  function category(app) {
    return byId("categories", app.category_id);
  }
  function categoryBrief(c) {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      requires_metal: c.requires_metal,
      ltv_percent: c.ltv_percent,
    };
  }
  function latest(list) {
    return list.length
      ? list.reduce(function (a, b) {
          return b.created_at > a.created_at || (b.created_at === a.created_at && b.id > a.id)
            ? b
            : a;
        })
      : null;
  }
  function appPhotos(app) {
    return where("photos", function (p) {
      return p.application_id === app.id;
    }).sort(function (a, b) {
      return a.position - b.position || a.id - b.id;
    });
  }
  function appraisalsOf(app, kind) {
    return where("appraisals", function (a) {
      return a.application_id === app.id && a.kind === kind;
    });
  }
  function latestAuto(app) {
    return latest(appraisalsOf(app, "AUTO"));
  }
  function latestExpert(app) {
    return latest(appraisalsOf(app, "EXPERT"));
  }
  function latestInspection(app) {
    return latest(appraisalsOf(app, "INSPECTION"));
  }
  function offersOf(app) {
    return where("offers", function (o) {
      return o.application_id === app.id;
    });
  }
  function currentOffer(app) {
    return latest(offersOf(app));
  }
  function currentTask(app, kind) {
    return latest(
      where("tasks", function (t) {
        return (
          t.application_id === app.id && t.status !== "CANCELLED" && (!kind || t.kind === kind)
        );
      }),
    );
  }
  function loanOf(app) {
    for (var i = 0; i < db.loans.length; i++)
      if (db.loans[i].application_id === app.id) return db.loans[i];
    return null;
  }
  function isEditable(app) {
    return app.status === "DRAFT" || app.status === "NEED_INFO";
  }
  function ensureEditable(app) {
    if (!isEditable(app))
      throw conflict("Заявку можно менять только в статусах «Черновик» и «Нужны фото»");
  }
  function getApplication(id, user) {
    var app = byId("applications", id);
    if (!app || (user.role === "CLIENT" && app.client_id !== user.id))
      throw notFound("Заявка не найдена");
    if (["CLIENT", "EXPERT", "ADMIN"].indexOf(user.role) < 0) throw notFound("Заявка не найдена");
    return app;
  }

  function photoRead(p) {
    return {
      id: p.id,
      position: p.position,
      original_name: p.original_name,
      content_type: p.content_type,
      size_bytes: p.size_bytes,
      width: p.width,
      height: p.height,
      quality_score: p.quality_score,
      url: photoData(p.id, "f"),
      thumb_url: photoData(p.id, "t"),
      created_at: iso(p.created_at),
    };
  }
  function appraisalRead(a) {
    return a
      ? {
          id: a.id,
          kind: a.kind,
          value_min: a.value_min,
          value_max: a.value_max,
          value: a.value,
          confidence: a.confidence,
          comment: a.comment,
          details: a.details,
          created_at: iso(a.created_at),
        }
      : null;
  }
  function historyRead(h) {
    return {
      id: h.id,
      from_status: h.from_status,
      to_status: h.to_status,
      to_status_label: STATUS_LABELS[h.to_status],
      actor_role: h.actor_role,
      comment: h.comment,
      created_at: iso(h.created_at),
    };
  }
  function offerRead(o) {
    var appraisal = byId("appraisals", o.appraisal_id);
    var details = appraisal.details || {};
    return {
      id: o.id,
      status: o.status,
      status_label: OFFER_STATUS_LABELS[o.status],
      market_value: appraisal.value,
      value_min: appraisal.value_min,
      value_max: appraisal.value_max,
      ltv_percent: details.ltv_percent === undefined ? null : details.ltv_percent,
      hallmark_confirmed:
        details.hallmark_confirmed === undefined ? null : details.hallmark_confirmed,
      loan_amount: o.loan_amount,
      daily_rate_bp: o.daily_rate_bp,
      rate_label: formatRate(o.daily_rate_bp),
      term_days: o.term_days,
      interest: o.total_to_repay - o.loan_amount,
      total_to_repay: o.total_to_repay,
      comment: o.comment,
      expert: brief(byId("users", o.expert_id)),
      expires_at: iso(o.expires_at),
      decided_at: iso(o.decided_at),
      created_at: iso(o.created_at),
      quote: quote(o.loan_amount, o.daily_rate_bp, o.term_days, today()),
    };
  }
  function slotLabel(start, end) {
    var s = new Date(start + KZ_OFFSET),
      e = new Date(end + KZ_OFFSET);
    return (
      pad(s.getUTCDate()) +
      "." +
      pad(s.getUTCMonth() + 1) +
      ", " +
      pad(s.getUTCHours()) +
      ":" +
      pad(s.getUTCMinutes()) +
      "–" +
      pad(e.getUTCHours()) +
      ":" +
      pad(e.getUTCMinutes())
    );
  }
  function visitRead(t) {
    return {
      id: t.id,
      kind: t.kind,
      kind_label: TASK_KIND_LABELS[t.kind],
      status: t.status,
      status_label: TASK_STATUS_LABELS[t.status],
      courier: brief(t.courier_id ? byId("users", t.courier_id) : null),
      city: t.city,
      address: t.address,
      contact_phone: t.contact_phone,
      contact_phone_display: formatKzPhone(t.contact_phone),
      slot_start: iso(t.slot_start),
      slot_end: iso(t.slot_end),
      slot_label: slotLabel(t.slot_start, t.slot_end),
      comment: t.comment,
      completed_at: iso(t.completed_at),
    };
  }

  function courierActions(app) {
    if (app.status === "OFFER_ACCEPTED") return ["schedule_courier"];
    var task = currentTask(app, "PICKUP");
    if (app.status === "COURIER_SCHEDULED" && task && task.status === "SCHEDULED")
      return ["reschedule_courier"];
    return [];
  }
  function canScheduleReturn(app) {
    return app.status === "REPAID" && !currentTask(app, "RETURN");
  }
  function loanActionsOfApp(app) {
    if (app.status === "INSPECTED" && !loanOf(app)) return ["issue_funds"];
    if (app.status === "LOAN_ACTIVE" || app.status === "OVERDUE") return ["repay", "extend"];
    if (canScheduleReturn(app)) return ["schedule_return"];
    return [];
  }
  function availableActions(app, viewer) {
    var actions = [];
    if (viewer.role === "CLIENT" && app.client_id === viewer.id) {
      if (isEditable(app)) actions.push("edit", "submit");
      if (app.status === "DRAFT") actions.push("delete");
      var offer = currentOffer(app);
      if (app.status === "OFFER_SENT" && offer && offer.status === "SENT")
        actions.push("accept_offer", "decline_offer");
      actions = actions.concat(courierActions(app), loanActionsOfApp(app));
    } else if (viewer.role === "EXPERT") {
      if (app.status === "PRE_ESTIMATED") actions.push("take");
      else if (app.status === "UNDER_REVIEW" && app.expert_id === viewer.id)
        actions.push("send_offer", "request_info", "reject");
      else if (app.status === "ITEM_DELIVERED") actions.push("inspect");
    } else if (viewer.role === "ADMIN") {
      actions = actions.concat(
        courierActions(app),
        loanActionsOfApp(app).filter(function (a) {
          return a === "issue_funds";
        }),
      );
    }
    return actions;
  }

  function card(app, viewer) {
    var cat = category(app);
    var offer = currentOffer(app);
    var loan = loanOf(app);
    var visit = currentTask(app);
    return {
      id: app.id,
      number: appNumber(app),
      client_id: app.client_id,
      status: app.status,
      status_label: STATUS_LABELS[app.status],
      category: categoryBrief(cat),
      title: app.title,
      description: app.description,
      metal: app.metal,
      fineness: app.fineness,
      weight_g: app.weight_mg === null ? null : app.weight_mg / 1000,
      brand: app.brand,
      condition: app.condition,
      requested_amount: app.requested_amount,
      created_at: iso(app.created_at),
      updated_at: iso(app.updated_at),
      submitted_at: iso(app.submitted_at),
      editable: isEditable(app),
      can_submit: isEditable(app),
      max_photos: SETTINGS.maxPhotos,
      photos: appPhotos(app).map(photoRead),
      pre_estimate: appraisalRead(latestAuto(app)),
      client: brief(byId("users", app.client_id)),
      expert: brief(app.expert_id ? byId("users", app.expert_id) : null),
      expert_appraisal: appraisalRead(latestExpert(app)),
      offer: offer ? offerRead(offer) : null,
      courier_visit: visit ? visitRead(visit) : null,
      inspection: appraisalRead(latestInspection(app)),
      loan: loan ? loanSummary(loan) : null,
      actions: availableActions(app, viewer),
      history: where("history", function (h) {
        return h.application_id === app.id;
      })
        .sort(function (a, b) {
          return a.id - b.id;
        })
        .map(historyRead),
    };
  }
  function listItem(app) {
    var pre = latestAuto(app);
    var photos = appPhotos(app);
    return {
      id: app.id,
      number: appNumber(app),
      status: app.status,
      status_label: STATUS_LABELS[app.status],
      title: app.title,
      category: categoryBrief(category(app)),
      photo_count: photos.length,
      cover_thumb_url: photos.length ? photoData(photos[0].id, "t") : null,
      pre_estimate_min: pre ? pre.value_min : null,
      pre_estimate_max: pre ? pre.value_max : null,
      created_at: iso(app.created_at),
      submitted_at: iso(app.submitted_at),
      updated_at: iso(app.updated_at),
    };
  }
  function queueItem(app) {
    var item = listItem(app);
    var pre = latestAuto(app);
    item.client = brief(byId("users", app.client_id));
    item.expert = brief(app.expert_id ? byId("users", app.expert_id) : null);
    item.pre_estimate_value = pre ? pre.value : null;
    item.pre_estimate_confidence = pre ? pre.confidence : null;
    item.requested_amount = app.requested_amount;
    return item;
  }

  // ------------------------------------------------------------------------------------
  // Заявки: изменения (`services/applications.py`)
  // ------------------------------------------------------------------------------------

  function activeCategory(id) {
    var c = byId("categories", id);
    if (!c || !c.is_active) throw problems([["category_id", "Категория не найдена"]]);
    return c;
  }
  function checkParams(app, cat) {
    var errs = validateMetalParams(cat.code, cat.requires_metal, app.metal, app.fineness);
    if (errs.length) throw problems(errs);
  }
  function validateParams(body, create) {
    var v = new Validator(body);
    if (create) {
      v.num("category_id", { required: true });
      v.str("title", { required: true, min: 2, max: 200 });
    } else {
      v.num("category_id", {});
      v.str("title", { min: 2, max: 200 });
    }
    v.str("description", { max: 4000 });
    v.oneOf("metal", METALS);
    v.num("fineness", { ge: 1, le: 999 });
    v.num("weight_g", { gt: 0, le: 10000, decimal: 3 });
    v.str("brand", { max: 100 });
    v.oneOf("condition", CONDITIONS);
    v.num("requested_amount", { gt: 0, le: MAX_REQUESTED_AMOUNT });
    var out = v.done();
    if (typeof out.title === "string") {
      out.title = squash(out.title);
      if (out.title.length < 2)
        throw new HttpError(422, {
          detail: [
            { loc: ["body", "title"], msg: "Минимальная длина — 2 симв.", type: "value_error" },
          ],
        });
    }
    if ("brand" in out) out.brand = squashOrNull(out.brand);
    if ("description" in out) out.description = stripOrNull(out.description);
    return out;
  }
  function weightMg(g) {
    return g === null || g === undefined ? null : Math.round(g * 1000);
  }

  function createApplication(user, body, at) {
    var data = validateParams(body, true);
    var cat = activeCategory(data.category_id);
    var t = at || now();
    var app = {
      client_id: user.id,
      category_id: cat.id,
      title: data.title,
      description: data.description === undefined ? null : data.description,
      metal: data.metal || null,
      fineness: data.fineness === undefined ? null : data.fineness,
      weight_mg: weightMg(data.weight_g),
      brand: data.brand === undefined ? null : data.brand,
      condition: data.condition || null,
      requested_amount: data.requested_amount === undefined ? null : data.requested_amount,
      status: "DRAFT",
      expert_id: null,
      created_at: t,
      updated_at: t,
      submitted_at: null,
    };
    checkParams(app, cat);
    insert("applications", app);
    insert("history", {
      application_id: app.id,
      from_status: null,
      to_status: "DRAFT",
      actor_id: user.id,
      actor_role: user.role,
      comment: "Заявка создана",
      created_at: t,
    });
    return app;
  }

  function updateApplication(app, body) {
    ensureEditable(app);
    var changes = validateParams(body, false);
    if ("title" in changes && changes.title === null) delete changes.title;
    if ("category_id" in changes) {
      if (changes.category_id !== null) app.category_id = activeCategory(changes.category_id).id;
      delete changes.category_id;
    }
    if ("weight_g" in changes) {
      app.weight_mg = weightMg(changes.weight_g);
      delete changes.weight_g;
    }
    Object.keys(changes).forEach(function (k) {
      app[k] = changes[k];
    });
    checkParams(app, category(app));
    app.updated_at = now();
  }

  function renumber(app) {
    appPhotos(app).forEach(function (p, i) {
      p.position = i;
    });
  }

  /** Загрузка фото: всё проверяется до записи; при ошибке ничего не сохраняется. */
  function addPhotos(app, files) {
    ensureEditable(app);
    if (!files.length) throw problems([["files", "Выберите хотя бы одно фото"]]);
    var current = appPhotos(app).length;
    var free = SETTINGS.maxPhotos - current;
    if (files.length > free) {
      throw problems([
        [
          "files",
          "К заявке можно приложить не больше " +
            SETTINGS.maxPhotos +
            " фото" +
            (free > 0 ? ", осталось мест: " + free : ", лимит исчерпан"),
        ],
      ]);
    }
    var maxBytes = SETTINGS.maxPhotoMb * 1024 * 1024;
    for (var i = 0; i < files.length; i++) {
      if (files[i].size > maxBytes) {
        throw new HttpError(413, {
          detail: "Фото «" + (files[i].name || "photo") + "» больше " + SETTINGS.maxPhotoMb + " МБ",
        });
      }
    }
    return Promise.all(
      files.map(function (f) {
        var name = f.name || "photo";
        return readHead(f).then(function (head) {
          if (!f.size) return { error: "«" + name + "»: Файл пустой" };
          var fmt = sniffFormat(head);
          if (!fmt) {
            return {
              error:
                "«" +
                name +
                "»: " +
                (head.length
                  ? "Поддерживаются только фото в форматах JPEG, PNG и WebP"
                  : "Файл не является изображением или повреждён"),
            };
          }
          return readAsDataUrl(f)
            .then(processImage)
            .then(
              function (norm) {
                return { file: f, norm: norm };
              },
              function (err) {
                return {
                  error:
                    "«" +
                    name +
                    "»: " +
                    (err && err.small
                      ? "Фото слишком маленькое: нужно не меньше " +
                        PHOTO_MIN_SIDE +
                        " px по короткой стороне"
                      : "Файл не является изображением или повреждён"),
                };
              },
            );
        });
      }),
    ).then(function (results) {
      var errs = results.filter(function (r) {
        return r.error;
      });
      if (errs.length) {
        throw problems(
          errs.map(function (r) {
            return ["files", r.error];
          }),
          "Не удалось принять фото",
        );
      }
      results.forEach(function (r) {
        savePhoto(app, r.file.name || "photo", r.norm);
      });
    });
  }

  function savePhoto(app, name, norm) {
    var photos = appPhotos(app);
    var position = photos.length ? photos[photos.length - 1].position + 1 : 0;
    var t = now();
    var photo = insert("photos", {
      application_id: app.id,
      position: position,
      original_name: String(name).slice(0, 255),
      content_type: "image/jpeg",
      size_bytes: Math.round(((norm.full.length - norm.full.indexOf(",") - 1) * 3) / 4),
      width: norm.width,
      height: norm.height,
      quality_score: norm.metrics.score,
      metrics: norm.metrics,
      ahash: norm.ahash,
      created_at: t,
    });
    storePhotoData(photo.id, norm.full, norm.thumb);
    app.updated_at = t;
    return photo;
  }

  function submitProblems(app) {
    var out = [];
    var cat = category(app);
    if (!cat.is_active) out.push(["category_id", "Категория больше не принимается"]);
    if (!appPhotos(app).length) out.push(["photos", "Добавьте хотя бы одно фото изделия"]);
    if (!app.condition) out.push(["condition", "Укажите состояние изделия"]);
    if (cat.requires_metal) {
      if (!app.metal) out.push(["metal", "Укажите металл"]);
      if (app.fineness === null) out.push(["fineness", "Укажите пробу"]);
      if (app.weight_mg === null) out.push(["weight_g", "Укажите вес изделия"]);
    }
    return out.concat(validateMetalParams(cat.code, cat.requires_metal, app.metal, app.fineness));
  }

  function currentMetalPrices(at) {
    var t = at || now();
    var prices = {};
    db.metal_prices
      .filter(function (p) {
        return p.effective_from <= t;
      })
      .sort(function (a, b) {
        return b.effective_from - a.effective_from || b.id - a.id;
      })
      .forEach(function (p) {
        if (!prices[p.metal]) prices[p.metal] = p;
      });
    return prices;
  }

  function computePreEstimate(app, at) {
    var photos = appPhotos(app);
    var analysis = analyzePhotos(photos);
    photos.forEach(function (p, i) {
      p.quality_score = analysis.photos[i].score;
    });
    var price = app.metal ? currentMetalPrices()[app.metal] : null;
    var cat = category(app);
    var result;
    try {
      result = estimate({
        category_code: cat.code,
        category_name: cat.name,
        requires_metal: cat.requires_metal,
        ltv_percent: cat.ltv_percent,
        metal: app.metal,
        fineness: app.fineness,
        weight_mg: app.weight_mg,
        brand: app.brand,
        condition: app.condition,
        metal_price_per_gram: price ? price.price_per_gram : null,
        photo_confidence: analysis.confidence,
      });
    } catch (e) {
      if (e instanceof EstimateError)
        throw problems([["metal", e.message]], "Не удалось оценить изделие");
      throw e;
    }
    var details = {
      version: METHOD_VERSION,
      method: result.method,
      params_confidence: result.params_confidence,
      photo_confidence: result.photo_confidence,
      confidence_label: confidenceLabel(result.confidence),
      loan_estimate: { min: result.loan_min, max: result.loan_max },
      steps: result.steps,
      warnings: result.warnings,
      photos: analysis,
      photo_appraiser: "heuristic-v1 (canvas, демо)",
      ltv_percent: cat.ltv_percent,
    };
    if (price) {
      details.metal_price = {
        metal: price.metal,
        price_per_gram: price.price_per_gram,
        effective_from: iso(price.effective_from),
      };
    }
    return insert("appraisals", {
      application_id: app.id,
      kind: "AUTO",
      appraiser_id: null,
      value_min: result.value_min,
      value_max: result.value_max,
      value: result.value,
      confidence: result.confidence,
      comment: result.summary,
      details: details,
      created_at: at || now(),
    });
  }

  function submitApplication(app, user, at) {
    if (!isEditable(app)) throw conflict("Заявка уже отправлена");
    var probs = submitProblems(app);
    if (probs.length) throw problems(probs, "Заявку пока нельзя отправить");
    var resubmit = app.status === "NEED_INFO";
    changeStatus(
      app,
      "SUBMITTED",
      user,
      resubmit ? "Повторно отправлена с дополнениями" : "Отправлена на оценку",
      at,
    );
    var appraisal = computePreEstimate(app, at);
    changeStatus(app, "PRE_ESTIMATED", null, appraisal.comment, at);
  }

  // ------------------------------------------------------------------------------------
  // Эксперт и оферта (`services/review.py`, `services/inspection.py`)
  // ------------------------------------------------------------------------------------

  var REVIEW_STATUSES = ["UNDER_REVIEW", "NEED_INFO", "OFFER_SENT"];

  function expertQueue(user, scope) {
    var list = db.applications.filter(function (a) {
      if (scope === "new") return a.status === "PRE_ESTIMATED";
      if (scope === "inspection") return a.status === "ITEM_DELIVERED";
      if (scope === "mine")
        return (
          REVIEW_STATUSES.indexOf(a.status) >= 0 &&
          (user.role !== "EXPERT" || a.expert_id === user.id)
        );
      return REVIEW_STATUSES.indexOf(a.status) >= 0 || a.status === "PRE_ESTIMATED";
    });
    return list.sort(function (a, b) {
      return (a.submitted_at || 0) - (b.submitted_at || 0) || a.id - b.id;
    });
  }
  function takeApplication(app, expert) {
    if (app.status === "UNDER_REVIEW") {
      if (app.expert_id === expert.id) return;
      throw conflict("Заявку уже взял в работу другой эксперт");
    }
    changeStatus(app, "UNDER_REVIEW", expert, "Эксперт взял в работу");
    app.expert_id = expert.id;
  }
  function ensureAssigned(app, expert) {
    if (app.status !== "UNDER_REVIEW") throw conflict("Сначала возьмите заявку в работу");
    if (app.expert_id !== expert.id) throw forbidden("Заявку ведёт другой эксперт");
  }
  function validateOfferTerms(body, withComment) {
    var v = new Validator(body);
    v.num("market_value", { required: true, gt: 0, le: MAX_MARKET_VALUE });
    v.num("ltv_percent", { ge: 1, le: 100 });
    v.num("daily_rate_bp", { ge: 1, le: 10000 });
    v.num("term_days", { required: true, ge: 1, le: 365 });
    v.num("loan_amount", { gt: 0 });
    v.num("value_min", { ge: 0 });
    v.num("value_max", { ge: 0 });
    v.num("confidence", { ge: 0, le: 100 });
    v.bool("hallmark_confirmed");
    if (withComment) v.str("comment", { max: 2000 });
    return v.done();
  }
  function offerInput(data, app) {
    var cat = category(app);
    return {
      market_value: data.market_value,
      ltv_percent: data.ltv_percent != null ? data.ltv_percent : cat.ltv_percent,
      daily_rate_bp: data.daily_rate_bp != null ? data.daily_rate_bp : cat.daily_rate_bp,
      term_days: data.term_days,
      loan_amount: data.loan_amount != null ? data.loan_amount : null,
      value_min: data.value_min != null ? data.value_min : null,
      value_max: data.value_max != null ? data.value_max : null,
      confidence: data.confidence != null ? data.confidence : null,
      hallmark_confirmed: data.hallmark_confirmed != null ? data.hallmark_confirmed : null,
      comment: stripOrNull(data.comment || null),
    };
  }
  function buildQuote(cat, d, start) {
    var errs = validateTerms(cat, d);
    if (d.value_min !== null && d.value_min !== undefined && d.value_min > d.market_value) {
      errs.push(["value_min", "Нижняя граница не больше рыночной стоимости"]);
    }
    if (d.value_max !== null && d.value_max !== undefined && d.value_max < d.market_value) {
      errs.push(["value_max", "Верхняя граница не меньше рыночной стоимости"]);
    }
    if (errs.length) throw problems(errs, "Проверьте условия займа");
    var amount =
      d.loan_amount !== null && d.loan_amount !== undefined
        ? d.loan_amount
        : maxLoanAmount(d.market_value, d.ltv_percent);
    return quote(amount, d.daily_rate_bp, d.term_days, start);
  }
  function sendOffer(app, expert, d) {
    ensureAssigned(app, expert);
    var t = now();
    var cat = category(app);
    var terms = buildQuote(cat, d, kzDate(t));
    var auto = latestAuto(app);
    var details = {
      ltv_percent: d.ltv_percent,
      category_ltv_percent: cat.ltv_percent,
      max_loan_amount: maxLoanAmount(d.market_value, d.ltv_percent),
      hallmark_confirmed: d.hallmark_confirmed,
    };
    if (auto) {
      details.auto_appraisal_id = auto.id;
      details.auto_value = auto.value;
      details.deviation_percent =
        Math.round(((d.market_value - auto.value) / auto.value) * 1000) / 10;
    }
    var appraisal = insert("appraisals", {
      application_id: app.id,
      kind: "EXPERT",
      appraiser_id: expert.id,
      value: d.market_value,
      value_min: d.value_min !== null ? d.value_min : d.market_value,
      value_max: d.value_max !== null ? d.value_max : d.market_value,
      confidence: d.confidence !== null ? d.confidence : EXPERT_DEFAULT_CONFIDENCE,
      comment: d.comment,
      details: details,
      created_at: t,
    });
    offersOf(app).forEach(function (o) {
      if (o.status === "SENT") o.status = "SUPERSEDED";
    });
    var offer = insert("offers", {
      application_id: app.id,
      appraisal_id: appraisal.id,
      expert_id: expert.id,
      loan_amount: terms.loan_amount,
      daily_rate_bp: terms.daily_rate_bp,
      term_days: terms.term_days,
      total_to_repay: terms.total_to_repay,
      status: "SENT",
      comment: d.comment,
      expires_at: t + SETTINGS.offerTtlHours * HOUR,
      decided_at: null,
      created_at: t,
    });
    changeStatus(app, "OFFER_SENT", expert, quoteSummary(terms));
    notify(
      app.client_id,
      "Предложение по заявке " + appNumber(app),
      "Эксперт оценил изделие в " +
        formatKzt(d.market_value) +
        ". Готовы выдать " +
        formatKzt(terms.loan_amount) +
        " на " +
        terms.term_days +
        " дн. Предложение действует до " +
        fmtDateTime(offer.expires_at) +
        ".",
      app,
    );
  }
  function requireComment(comment, field, message) {
    var text = (comment || "").trim();
    if (text.length < 5) throw problems([[field, message]]);
    return text;
  }
  function expireOfferIfNeeded(app, t) {
    if (app.status !== "OFFER_SENT") return false;
    var offer = currentOffer(app);
    t = t || now();
    if (!offer || !offer.expires_at || offer.expires_at > t) return false;
    offer.status = "EXPIRED";
    offer.decided_at = t;
    changeStatus(app, "OFFER_DECLINED", null, "Срок действия предложения истёк", t);
    notify(
      app.client_id,
      "Предложение по заявке " + appNumber(app) + " истекло",
      "Срок действия предложения закончился. Создайте новую заявку, если займ ещё нужен.",
      app,
    );
    return true;
  }
  function activeOffer(app) {
    var offer = currentOffer(app);
    if (app.status !== "OFFER_SENT" || !offer || offer.status !== "SENT")
      throw conflict("Нет действующего предложения по заявке");
    return offer;
  }
  function acceptOffer(app, client) {
    var t = now();
    if (expireOfferIfNeeded(app, t)) throw conflict("Срок действия предложения истёк", true);
    var offer = activeOffer(app);
    offer.status = "ACCEPTED";
    offer.decided_at = t;
    changeStatus(
      app,
      "OFFER_ACCEPTED",
      client,
      "Клиент принял предложение: " + formatKzt(offer.loan_amount),
    );
    if (app.expert_id) {
      notify(
        app.expert_id,
        "Предложение по заявке " + appNumber(app) + " принято",
        "Клиент согласился на " + formatKzt(offer.loan_amount) + ". Следующий шаг — курьер.",
        app,
      );
    }
  }
  function declineOffer(app, client, reason) {
    var t = now();
    if (expireOfferIfNeeded(app, t)) throw conflict("Срок действия предложения истёк", true);
    var offer = activeOffer(app);
    offer.status = "DECLINED";
    offer.decided_at = t;
    var text = (reason || "").trim() || null;
    changeStatus(
      app,
      "OFFER_DECLINED",
      client,
      text ? "Клиент отказался: " + text : "Клиент отказался от предложения",
    );
    if (app.expert_id) {
      notify(
        app.expert_id,
        "Отказ по заявке " + appNumber(app),
        text || "Клиент отказался от предложения без комментария.",
        app,
      );
    }
  }

  function acceptedOffer(app) {
    var accepted = offersOf(app).filter(function (o) {
      return o.status === "ACCEPTED";
    });
    if (!accepted.length) throw conflict("По заявке нет принятого предложения");
    return latest(accepted);
  }
  function validateInspection(body) {
    var v = new Validator(body);
    v.num("market_value", { gt: 0, le: MAX_MARKET_VALUE });
    v.num("loan_amount", { gt: 0 });
    v.bool("hallmark_confirmed");
    v.num("weight_g", { gt: 0, le: 10000, decimal: 3 });
    v.str("comment", { max: 2000 });
    return v.done();
  }
  function planInspection(app, d, t) {
    if (app.status !== "ITEM_DELIVERED")
      throw conflict("Осмотр возможен, когда изделие доставлено в ломбард");
    var offer = acceptedOffer(app);
    var expert = latestExpert(app);
    var offerAppraisal = byId("appraisals", offer.appraisal_id);
    var marketValue = d.market_value || (expert ? expert.value : offerAppraisal.value);
    var details = offerAppraisal.details || {};
    var ltv = Number(details.ltv_percent || category(app).ltv_percent);
    var amount = d.loan_amount;
    if (amount === null || amount === undefined)
      amount = Math.min(offer.loan_amount, maxLoanAmount(marketValue, ltv));
    if (amount > offer.loan_amount) {
      throw problems(
        [
          [
            "loan_amount",
            "Сумма не может превышать согласованную с клиентом (" +
              formatKzt(offer.loan_amount) +
              ")",
          ],
        ],
        "Проверьте результат осмотра",
      );
    }
    var terms = buildQuote(
      category(app),
      {
        market_value: marketValue,
        ltv_percent: ltv,
        daily_rate_bp: offer.daily_rate_bp,
        term_days: offer.term_days,
        loan_amount: amount,
        value_min: null,
        value_max: null,
      },
      kzDate(t),
    );
    return {
      offer: offer,
      market_value: marketValue,
      ltv_percent: ltv,
      quote: terms,
      adjusted: terms.loan_amount !== offer.loan_amount,
    };
  }
  function inspect(app, expert, d) {
    var t = now();
    var plan = planInspection(app, d, t);
    var terms = plan.quote;
    var comment = stripOrNull(d.comment || null);
    if (plan.adjusted && !comment) {
      throw problems(
        [["comment", "Объясните клиенту, почему сумма изменилась"]],
        "Проверьте результат осмотра",
      );
    }
    insert("appraisals", {
      application_id: app.id,
      kind: "INSPECTION",
      appraiser_id: expert.id,
      value: plan.market_value,
      value_min: plan.market_value,
      value_max: plan.market_value,
      confidence: 100,
      comment: comment,
      details: {
        offer_id: plan.offer.id,
        offer_loan_amount: plan.offer.loan_amount,
        loan_amount: terms.loan_amount,
        adjusted: plan.adjusted,
        ltv_percent: plan.ltv_percent,
        daily_rate_bp: terms.daily_rate_bp,
        term_days: terms.term_days,
        total_to_repay: terms.total_to_repay,
        hallmark_confirmed: d.hallmark_confirmed === undefined ? null : d.hallmark_confirmed,
        weight_g: d.weight_g === null || d.weight_g === undefined ? null : String(d.weight_g),
      },
      created_at: t,
    });
    var summary, body;
    if (plan.adjusted) {
      summary =
        "Осмотр: сумма займа скорректирована " +
        formatKzt(plan.offer.loan_amount) +
        " → " +
        formatKzt(terms.loan_amount);
      body =
        "Эксперт осмотрел изделие. Сумма займа изменена: " +
        formatKzt(terms.loan_amount) +
        " вместо " +
        formatKzt(plan.offer.loan_amount) +
        ". Причина: " +
        comment;
    } else {
      summary = "Осмотр: подлинность подтверждена, сумма " + formatKzt(terms.loan_amount);
      body =
        "Эксперт осмотрел изделие и подтвердил сумму займа " +
        formatKzt(terms.loan_amount) +
        ". Скоро деньги поступят на карту.";
    }
    changeStatus(app, "INSPECTED", expert, summary, t);
    notify(app.client_id, "Осмотр завершён: " + appNumber(app), body, app);
  }

  // ------------------------------------------------------------------------------------
  // Логистика (`services/logistics.py`)
  // ------------------------------------------------------------------------------------

  function activeCouriers(city) {
    return db.users
      .filter(function (u) {
        return (
          u.role === "COURIER" &&
          u.is_active &&
          (city === undefined || city === null || u.city === city)
        );
      })
      .sort(function (a, b) {
        return a.id - b.id;
      });
  }
  function servedCities() {
    var counts = {};
    activeCouriers().forEach(function (u) {
      if (u.city) counts[u.city] = (counts[u.city] || 0) + 1;
    });
    return Object.keys(counts)
      .sort()
      .map(function (c) {
        return [c, counts[c]];
      });
  }
  function isServed(city) {
    return servedCities().some(function (c) {
      return c[0] === city;
    });
  }
  function busyCourierIds(start, end, excludeTaskId) {
    var ids = {};
    db.tasks.forEach(function (t) {
      if (
        t.courier_id &&
        t.status !== "CANCELLED" &&
        t.slot_start < end &&
        t.slot_end > start &&
        t.id !== excludeTaskId
      )
        ids[t.courier_id] = true;
    });
    return ids;
  }
  function openTaskCounts() {
    var counts = {};
    db.tasks.forEach(function (t) {
      if (t.courier_id && OPEN_TASK_STATUSES.indexOf(t.status) >= 0)
        counts[t.courier_id] = (counts[t.courier_id] || 0) + 1;
    });
    return counts;
  }
  function daySlots(day) {
    var r = SETTINGS.slot;
    var slots = [];
    for (var h = r.dayStart; h < r.dayEnd; h += r.hours) {
      var start = Date.parse(day + "T" + pad(h) + ":00:00Z") - KZ_OFFSET;
      slots.push({ start: start, end: start + r.hours * HOUR });
    }
    return slots;
  }
  function bookableSlots(t) {
    var earliest = t + SETTINGS.slot.lead * HOUR;
    var day0 = kzDate(t);
    var result = [];
    for (var i = 0; i <= SETTINGS.slot.horizon; i++) {
      daySlots(addDays(day0, i)).forEach(function (s) {
        if (s.start >= earliest) result.push(s);
      });
    }
    return result;
  }
  function findSlot(start, t) {
    var slots = bookableSlots(t);
    for (var i = 0; i < slots.length; i++) if (slots[i].start === start) return slots[i];
    return null;
  }
  function pickCourier(city, slot, excludeTaskId) {
    var busy = busyCourierIds(slot.start, slot.end, excludeTaskId);
    var candidates = activeCouriers(city).filter(function (c) {
      return !busy[c.id];
    });
    if (!candidates.length) return null;
    var load = openTaskCounts();
    return candidates.reduce(function (best, c) {
      var a = load[best.id] || 0,
        b = load[c.id] || 0;
      return b < a || (b === a && c.id < best.id) ? c : best;
    });
  }
  function courierText(c) {
    return c.full_name + (c.phone ? ", " + formatKzPhone(c.phone) : "");
  }
  function validateVisit(body) {
    var v = new Validator(body);
    v.str("city", { required: true, min: 2, max: 100 });
    v.str("address", { required: true, min: 5, max: 500 });
    v.phone("contact_phone");
    v.str("slot_start", { required: true });
    v.str("comment", { max: 1000 });
    var out = v.done();
    var extra = new Validator({});
    ["city", "address"].forEach(function (f) {
      out[f] = squash(out[f]);
      if (out[f].length < 2) extra.fail(f, "Слишком короткое значение");
    });
    var start = Date.parse(out.slot_start);
    if (!isFinite(start) || !/(Z|[+-]\d\d:?\d\d)$/.test(out.slot_start))
      extra.fail("slot_start", "Ожидается дата и время с часовым поясом");
    extra.done();
    out.slot_start = start;
    out.comment = stripOrNull(out.comment || null);
    return out;
  }
  function visitInput(data, client) {
    var phone = data.contact_phone || client.phone;
    if (!phone)
      throw problems(
        [["contact_phone", "Укажите телефон для связи с курьером"]],
        "Проверьте данные для вызова курьера",
      );
    return {
      city: data.city,
      address: data.address,
      contact_phone: phone,
      slot_start: data.slot_start,
      comment: data.comment,
    };
  }
  function checkVisit(d, t) {
    var probs = [];
    if (!isServed(d.city)) probs.push(["city", "В этом городе курьерская служба пока не работает"]);
    var slot = findSlot(d.slot_start, t);
    if (!slot) probs.push(["slot_start", "Выберите время из списка доступных слотов"]);
    if (probs.length) throw problems(probs, "Проверьте данные для вызова курьера");
    return slot;
  }
  function bookVisit(app, kind, d, t) {
    var slot = checkVisit(d, t);
    var courier = pickCourier(d.city, slot);
    if (!courier) throw conflict("Все курьеры в это время заняты — выберите другой слот");
    var task = insert("tasks", {
      application_id: app.id,
      kind: kind,
      status: "SCHEDULED",
      courier_id: courier.id,
      city: d.city,
      address: d.address,
      contact_phone: d.contact_phone,
      slot_start: slot.start,
      slot_end: slot.end,
      comment: d.comment,
      completed_at: null,
      created_at: t,
      updated_at: t,
    });
    notify(
      courier.id,
      "Новый выезд: " + appNumber(app),
      (kind === "PICKUP" ? "Забрать изделие" : "Вернуть изделие") +
        " — " +
        d.city +
        ", " +
        d.address +
        "; " +
        slotLabel(slot.start, slot.end) +
        ".",
      app,
    );
    return task;
  }
  function schedulePickup(app, user, d) {
    var t = now();
    if (app.status !== "OFFER_ACCEPTED")
      throw conflict("Вызвать курьера можно только после принятия предложения");
    var task = bookVisit(app, "PICKUP", d, t);
    var slotText = slotLabel(task.slot_start, task.slot_end);
    changeStatus(app, "COURIER_SCHEDULED", user, "Курьер вызван на " + slotText);
    notify(
      app.client_id,
      "Курьер назначен по заявке " + appNumber(app),
      "Курьер приедет " +
        slotText +
        " по адресу: " +
        d.city +
        ", " +
        d.address +
        ". Курьер: " +
        courierText(byId("users", task.courier_id)) +
        ".",
      app,
    );
  }
  function reschedulePickup(app, user, d) {
    var t = now();
    var task = currentTask(app, "PICKUP");
    if (app.status !== "COURIER_SCHEDULED" || !task || task.status !== "SCHEDULED")
      throw conflict("Перенести визит можно, только пока курьер не выехал");
    var slot = checkVisit(d, t);
    var courier = task.courier_id ? byId("users", task.courier_id) : null;
    var sameCity = courier && courier.city === d.city && courier.is_active;
    if (!sameCity || !courier || busyCourierIds(slot.start, slot.end, task.id)[courier.id])
      courier = pickCourier(d.city, slot, task.id);
    if (!courier) throw conflict("Все курьеры в это время заняты — выберите другой слот");
    var previous = task.courier_id;
    task.courier_id = courier.id;
    task.city = d.city;
    task.address = d.address;
    task.contact_phone = d.contact_phone;
    task.comment = d.comment;
    task.slot_start = slot.start;
    task.slot_end = slot.end;
    task.updated_at = t;
    var label = slotLabel(slot.start, slot.end);
    historyNote(app, user, "Визит перенесён на " + label, t);
    notify(
      app.client_id,
      "Визит курьера перенесён: " + appNumber(app),
      "Новое время: " +
        label +
        ", " +
        d.city +
        ", " +
        d.address +
        ". Курьер: " +
        courierText(courier) +
        ".",
      app,
    );
    notify(
      courier.id,
      "Выезд " + appNumber(app) + ": " + label,
      d.city + ", " + d.address + ".",
      app,
    );
    if (previous && previous !== courier.id)
      notify(
        previous,
        "Выезд " + appNumber(app) + " передан другому курьеру",
        "Клиент перенёс визит.",
        app,
      );
  }

  function listTasks(user, scope, opts) {
    opts = opts || {};
    var list = db.tasks.filter(function (t) {
      if (user.role === "COURIER") return t.courier_id === user.id;
      if (opts.unassigned) return !t.courier_id;
      if (opts.courier_id) return t.courier_id === opts.courier_id;
      return true;
    });
    if (scope === "day") {
      var day = opts.day || today();
      var start = Date.parse(day + "T00:00:00Z") - KZ_OFFSET;
      list = list.filter(function (t) {
        return t.slot_start >= start && t.slot_start < start + DAY && t.status !== "CANCELLED";
      });
    } else if (scope === "active") {
      list = list.filter(function (t) {
        return OPEN_TASK_STATUSES.indexOf(t.status) >= 0;
      });
    } else if (scope === "done") {
      list = list.filter(function (t) {
        return t.status === "DELIVERED" || t.status === "CANCELLED";
      });
    }
    var dir = scope === "done" ? -1 : 1;
    return list.sort(function (a, b) {
      return dir * (a.slot_start - b.slot_start || a.id - b.id);
    });
  }
  function getTask(id, user) {
    var t = byId("tasks", id);
    if (!t || (user.role === "COURIER" && t.courier_id !== user.id))
      throw notFound("Выезд не найден");
    if (user.role !== "COURIER" && user.role !== "ADMIN") throw notFound("Выезд не найден");
    return t;
  }
  function nextSteps(kind, status) {
    return Object.keys(STEPS)
      .filter(function (k) {
        return k.split(":")[0] === kind && STEPS[k][0] === status;
      })
      .map(function (k) {
        return k.split(":")[1];
      });
  }
  function taskActions(t, viewer) {
    if (viewer.role === "COURIER" && t.courier_id === viewer.id) return nextSteps(t.kind, t.status);
    if (
      viewer.role === "ADMIN" &&
      (t.status === "SCHEDULED" || (!t.courier_id && OPEN_TASK_STATUSES.indexOf(t.status) >= 0))
    )
      return ["assign"];
    return [];
  }
  function taskRead(t, viewer) {
    var app = byId("applications", t.application_id);
    var r = visitRead(t);
    r.application = {
      id: app.id,
      number: appNumber(app),
      title: app.title,
      category_name: category(app).name,
      status: app.status,
      status_label: STATUS_LABELS[app.status],
    };
    r.client = brief(byId("users", app.client_id));
    r.created_at = iso(t.created_at);
    r.updated_at = iso(t.updated_at);
    r.actions = taskActions(t, viewer);
    return r;
  }
  function courierStep(task, courier, step) {
    var t = now();
    if (task.courier_id !== courier.id) throw notFound("Выезд не найден");
    var key = task.kind + ":" + step;
    var rule = STEPS[key];
    if (!rule)
      throw conflict("Шаг «" + (STEP_LABELS[step] || step) + "» не применим к этому выезду");
    if (task.status !== rule[0])
      throw conflict(
        "Шаг «" +
          STEP_LABELS[step] +
          "» невозможен: выезд в статусе «" +
          TASK_STATUS_LABELS[task.status] +
          "»",
      );
    var app = byId("applications", task.application_id);
    if (rule[2]) changeStatus(app, rule[2], courier, STEP_LABELS[step], t);
    task.status = rule[1];
    task.updated_at = t;
    if (rule[1] === "DELIVERED") task.completed_at = t;
    var note = STEP_NOTES[key];
    notify(
      app.client_id,
      note[0] + ": " + appNumber(app),
      note[1].replace("{courier}", courier.full_name),
      app,
    );
    if (task.kind === "PICKUP" && rule[1] === "DELIVERED" && app.expert_id) {
      notify(
        app.expert_id,
        "Нужен осмотр: " + appNumber(app),
        "Изделие доставлено в ломбард и ждёт осмотра.",
        app,
      );
    }
  }
  function assignCourier(task, courier, admin) {
    if (OPEN_TASK_STATUSES.indexOf(task.status) < 0) throw conflict("Выезд уже завершён");
    if (task.status !== "SCHEDULED" && task.courier_id)
      throw conflict("Курьер уже выехал — переназначить нельзя");
    if (courier.role !== "COURIER" || !courier.is_active)
      throw problems([["courier_id", "Выберите активного курьера"]]);
    if (task.courier_id === courier.id) return;
    if (busyCourierIds(task.slot_start, task.slot_end, task.id)[courier.id])
      throw conflict(courier.full_name + " уже занят(а) в это время");
    var previous = task.courier_id;
    task.courier_id = courier.id;
    task.updated_at = now();
    var app = byId("applications", task.application_id);
    var label = slotLabel(task.slot_start, task.slot_end);
    notify(
      courier.id,
      "Новый выезд: " + appNumber(app),
      "Назначил администратор " +
        admin.full_name +
        ": " +
        task.city +
        ", " +
        task.address +
        "; " +
        label +
        ".",
      app,
    );
    if (previous)
      notify(
        previous,
        "Выезд " + appNumber(app) + " передан другому курьеру",
        "Переназначил администратор " + admin.full_name + ".",
        app,
      );
    notify(
      app.client_id,
      "Сменился курьер по заявке " + appNumber(app),
      "Курьер: " + courierText(courier) + ". Время прежнее: " + label + ".",
      app,
    );
  }

  // ------------------------------------------------------------------------------------
  // Займы (`services/loans.py`)
  // ------------------------------------------------------------------------------------

  function gateway(op, card, amount) {
    var digits = normalizeCard(card);
    if (amount <= 0) return { ok: false, ref: null, message: "Некорректная сумма операции" };
    if (digits === DECLINED_CARD)
      return { ok: false, ref: null, message: "Банк отклонил операцию" };
    if (digits === NO_FUNDS_CARD && op === "charge")
      return { ok: false, ref: null, message: "Недостаточно средств на карте" };
    return {
      ok: true,
      ref: "MOCK-" + op.toUpperCase() + "-" + randomToken().slice(0, 12).toUpperCase(),
      message: "Операция проведена",
    };
  }
  function checkCard(number) {
    var p = cardProblem(number);
    if (p) throw problems([["card_number", p]], "Проверьте данные карты");
    return normalizeCard(number);
  }
  function validateCardBody(body, withTerm) {
    var v = new Validator(body);
    v.str("card_number", { required: true, min: 12, max: 32 });
    if (withTerm) v.num("term_days", { ge: 1, le: 365 });
    return v.done();
  }
  function payoutTerms(app) {
    if (app.status !== "INSPECTED")
      throw conflict("Деньги выдаются после осмотра изделия экспертом");
    if (loanOf(app)) throw conflict("Займ по заявке уже выдан");
    var insp = latestInspection(app);
    var details = (insp && insp.details) || {};
    if (!details.loan_amount) throw conflict("Нет результатов осмотра");
    return {
      offer_id: Number(details.offer_id || acceptedOffer(app).id),
      loan_amount: Number(details.loan_amount),
      daily_rate_bp: Number(details.daily_rate_bp),
      term_days: Number(details.term_days),
    };
  }
  function issueFunds(app, user, cardNumber) {
    var t = now();
    var terms = payoutTerms(app);
    var cardDigits = checkCard(cardNumber);
    var calc = quote(terms.loan_amount, terms.daily_rate_bp, terms.term_days, kzDate(t));
    var number = ticketNumber(app.id, t);
    var result = gateway("payout", cardDigits, terms.loan_amount);
    if (!result.ok)
      throw new HttpError(402, { detail: "Не удалось перевести деньги: " + result.message });
    var loan = insert("loans", {
      application_id: app.id,
      offer_id: terms.offer_id,
      ticket_number: number,
      principal: terms.loan_amount,
      daily_rate_bp: terms.daily_rate_bp,
      term_days: terms.term_days,
      issued_at: t,
      due_at: dueAtFor(calc.due_date),
      interest_from: t,
      status: "ACTIVE",
      extensions_count: 0,
      closed_at: null,
    });
    insert("payments", {
      loan_id: loan.id,
      kind: "DISBURSEMENT",
      status: "SUCCEEDED",
      amount: terms.loan_amount,
      destination: maskCard(cardDigits),
      provider_ref: result.ref,
      created_at: t,
    });
    changeStatus(
      app,
      "FUNDS_ISSUED",
      user.role === "ADMIN" ? user : null,
      formatKzt(terms.loan_amount) + " отправлено на карту " + maskCard(cardDigits),
      t,
    );
    changeStatus(
      app,
      "LOAN_ACTIVE",
      null,
      "Залоговый билет " +
        number +
        ": вернуть " +
        formatKzt(calc.total_to_repay) +
        " до " +
        fmtDate(calc.due_date),
      t,
    );
    notify(
      app.client_id,
      "Деньги отправлены: " + formatKzt(terms.loan_amount),
      "Займ по заявке " +
        appNumber(app) +
        " выдан на карту " +
        maskCard(cardDigits) +
        ". Залоговый билет " +
        number +
        ". Вернуть " +
        formatKzt(calc.total_to_repay) +
        " до " +
        fmtDate(calc.due_date) +
        ".",
      app,
      { sms: true, email: true },
    );
  }
  function syncLoan(loan, t) {
    var changed = false;
    var app = byId("applications", loan.application_id);
    var f = figures(loan, t);
    if (loan.status === "ACTIVE" && f.phase !== "ACTIVE") {
      loan.status = "OVERDUE";
      changeStatus(app, "OVERDUE", null, "Срок займа истёк " + fmtDate(f.due_date), t);
      notify(
        app.client_id,
        "Займ просрочен: " + loan.ticket_number,
        "Срок возврата был " +
          fmtDate(f.due_date) +
          ". Погасите займ или продлите его до " +
          fmtDate(f.grace_until) +
          " — после этой даты изделие перейдёт ломбарду. Сейчас к оплате " +
          formatKzt(f.total_to_repay) +
          ".",
        app,
        { sms: true, email: true },
      );
      changed = true;
    }
    if (loan.status === "OVERDUE" && f.phase === "FORFEIT") {
      loan.status = "FORFEITED";
      loan.closed_at = t;
      changeStatus(
        app,
        "FORFEITED",
        null,
        "Льготный период закончился, изделие перешло ломбарду",
        t,
      );
      notify(
        app.client_id,
        "Изделие перешло ломбарду: " + loan.ticket_number,
        "Льготный период после срока займа закончился. По условиям залогового билета изделие перешло в собственность ломбарда, долг по займу закрыт.",
        app,
        { sms: true, email: true },
      );
      changed = true;
    }
    return changed;
  }
  function processLoans(t) {
    var counts = { overdue: 0, forfeited: 0 };
    db.loans
      .filter(function (l) {
        return (l.status === "ACTIVE" || l.status === "OVERDUE") && l.due_at < t;
      })
      .sort(function (a, b) {
        return a.id - b.id;
      })
      .forEach(function (loan) {
        var before = loan.status;
        if (syncLoan(loan, t)) {
          if (before === "ACTIVE") counts.overdue++;
          if (loan.status === "FORFEITED") counts.forfeited++;
        }
      });
    return counts;
  }
  function ensureOpen(loan) {
    if (loan.status === "FORFEITED")
      throw conflict("Льготный период закончился: изделие перешло ломбарду");
    if (loan.status !== "ACTIVE" && loan.status !== "OVERDUE") throw conflict("Займ уже закрыт");
  }
  function charge(loan, kind, cardDigits, amount, t) {
    var result = gateway("charge", cardDigits, amount);
    insert("payments", {
      loan_id: loan.id,
      kind: kind,
      status: result.ok ? "SUCCEEDED" : "FAILED",
      amount: amount,
      destination: maskCard(cardDigits),
      provider_ref: result.ref,
      created_at: t,
    });
    // Неудачный платёж остаётся в истории (commit), клиенту — 402.
    if (!result.ok)
      throw new HttpError(402, { detail: "Оплата не прошла: " + result.message }, true);
  }
  function repay(loan, client, cardNumber) {
    var t = now();
    syncLoan(loan, t);
    ensureOpen(loan);
    var cardDigits = checkCard(cardNumber);
    var f = figures(loan, t);
    charge(loan, "REPAYMENT", cardDigits, f.total_to_repay, t);
    loan.status = "REPAID";
    loan.closed_at = t;
    var app = byId("applications", loan.application_id);
    changeStatus(
      app,
      "REPAID",
      client,
      "Займ погашен: " +
        formatKzt(f.total_to_repay) +
        " (проценты " +
        formatKzt(f.interest) +
        " за " +
        f.days_used +
        " дн.)",
      t,
    );
    notify(
      app.client_id,
      "Займ погашен: " + loan.ticket_number,
      "Оплата " +
        formatKzt(f.total_to_repay) +
        " получена. Выберите время, когда курьер привезёт изделие.",
      app,
      { sms: true },
    );
  }
  function extensionQuote(loan, termDays, t) {
    ensureOpen(loan);
    var cat = category(byId("applications", loan.application_id));
    var term = termDays || loan.term_days;
    if (!(term >= cat.min_term_days && term <= cat.max_term_days)) {
      throw problems(
        [
          [
            "term_days",
            cat.name + ": срок от " + cat.min_term_days + " до " + cat.max_term_days + " дней",
          ],
        ],
        "Проверьте условия продления",
      );
    }
    if (loan.extensions_count >= SETTINGS.maxExtensions)
      throw conflict("Займ можно продлить не больше " + SETTINGS.maxExtensions + " раз");
    var f = figures(loan, t);
    return {
      term_days: term,
      pay_now: f.interest,
      days_used: f.days_used,
      new_due_date: addDays(kzDate(t), term),
      total_at_new_due: loan.principal + interestFor(loan.principal, loan.daily_rate_bp, term),
      extensions_left: SETTINGS.maxExtensions - loan.extensions_count - 1,
    };
  }
  function extend(loan, client, cardNumber, termDays) {
    var t = now();
    syncLoan(loan, t);
    var plan = extensionQuote(loan, termDays, t);
    var cardDigits = checkCard(cardNumber);
    charge(loan, "EXTENSION", cardDigits, plan.pay_now, t);
    loan.status = "ACTIVE";
    loan.interest_from = t;
    loan.due_at = dueAtFor(plan.new_due_date);
    loan.term_days = plan.term_days;
    loan.extensions_count += 1;
    var app = byId("applications", loan.application_id);
    changeStatus(
      app,
      "EXTENDED",
      client,
      "Оплачены проценты " + formatKzt(plan.pay_now) + " за " + plan.days_used + " дн.",
      t,
    );
    changeStatus(
      app,
      "LOAN_ACTIVE",
      null,
      "Займ продлён на " + plan.term_days + " дн., до " + fmtDate(plan.new_due_date),
      t,
    );
    notify(
      app.client_id,
      "Займ продлён: " + loan.ticket_number,
      "Проценты " +
        formatKzt(plan.pay_now) +
        " оплачены. Новый срок — " +
        fmtDate(plan.new_due_date) +
        ", к возврату " +
        formatKzt(plan.total_at_new_due) +
        ".",
      app,
      { sms: true },
    );
  }
  function scheduleReturn(app, user, d) {
    var t = now();
    if (app.status !== "REPAID") throw conflict("Вернуть изделие можно после погашения займа");
    if (!canScheduleReturn(app)) throw conflict("Возврат изделия уже запланирован");
    var task = bookVisit(app, "RETURN", d, t);
    var label = slotLabel(task.slot_start, task.slot_end);
    historyNote(app, user, "Возврат изделия: курьер приедет " + label, t);
    notify(
      app.client_id,
      "Возврат изделия запланирован: " + appNumber(app),
      "Курьер " +
        byId("users", task.courier_id).full_name +
        " привезёт изделие " +
        label +
        " по адресу: " +
        d.city +
        ", " +
        d.address +
        ".",
      app,
    );
  }
  function loansOf(user) {
    return db.loans
      .filter(function (l) {
        return (
          user.role !== "CLIENT" || byId("applications", l.application_id).client_id === user.id
        );
      })
      .sort(function (a, b) {
        return b.issued_at - a.issued_at || b.id - a.id;
      });
  }
  function getLoan(id, user) {
    var loan = byId("loans", id);
    if (!loan) throw notFound("Займ не найден");
    if (user.role === "CLIENT" && byId("applications", loan.application_id).client_id !== user.id)
      throw notFound("Займ не найден");
    if (user.role !== "CLIENT" && user.role !== "ADMIN") throw notFound("Займ не найден");
    return loan;
  }
  function paymentsOf(loan) {
    return where("payments", function (p) {
      return p.loan_id === loan.id;
    }).sort(function (a, b) {
      return a.id - b.id;
    });
  }
  function loanSummary(loan) {
    var f = figures(loan, now());
    return {
      id: loan.id,
      ticket_number: loan.ticket_number,
      status: loan.status,
      status_label: LOAN_STATUS_LABELS[loan.status],
      principal: loan.principal,
      daily_rate_bp: loan.daily_rate_bp,
      rate_label: formatRate(loan.daily_rate_bp),
      issued_at: iso(loan.issued_at),
      due_date: f.due_date,
      grace_until: f.grace_until,
      days_used: f.days_used,
      accrued_interest: f.interest,
      total_to_repay: f.total_to_repay,
      days_left: f.days_left,
      overdue_days: f.overdue_days,
      grace_days_left: f.grace_days_left,
      due_soon: f.due_soon,
      extensions_count: loan.extensions_count,
      closed_at: iso(loan.closed_at),
      ticket_url: "/api/loans/" + loan.id + "/ticket",
    };
  }
  function loanRead(loan, viewer) {
    var t = now();
    var app = byId("applications", loan.application_id);
    var extension = null;
    if (loan.status === "ACTIVE" || loan.status === "OVERDUE") {
      try {
        extension = extensionQuote(loan, null, t);
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        extension = null;
      }
    }
    var actions = ["ticket"];
    if (viewer.role === "CLIENT" && (loan.status === "ACTIVE" || loan.status === "OVERDUE"))
      actions.push("repay", "extend");
    if (viewer.role === "CLIENT" && canScheduleReturn(app)) actions.push("schedule_return");
    if (!extension)
      actions = actions.filter(function (a) {
        return a !== "extend";
      });
    var r = loanSummary(loan);
    r.application = {
      id: app.id,
      number: appNumber(app),
      title: app.title,
      category_name: category(app).name,
      status: app.status,
      status_label: STATUS_LABELS[app.status],
    };
    r.client = brief(byId("users", app.client_id));
    r.term_days = loan.term_days;
    r.due_at = iso(loan.due_at);
    r.interest_from = iso(loan.interest_from || loan.issued_at);
    r.total_at_due =
      loan.principal + interestFor(loan.principal, loan.daily_rate_bp, loan.term_days);
    r.extensions_left = Math.max(0, SETTINGS.maxExtensions - loan.extensions_count);
    r.extension = extension;
    r.payments = paymentsOf(loan).map(function (p) {
      return {
        id: p.id,
        kind: p.kind,
        kind_label: PAYMENT_KIND_LABELS[p.kind],
        status: p.status,
        status_label: PAYMENT_STATUS_LABELS[p.status],
        amount: p.amount,
        destination: p.destination,
        provider_ref: p.provider_ref,
        created_at: iso(p.created_at),
      };
    });
    r.actions = actions;
    r.now = iso(t);
    return r;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" }[c];
    });
  }
  /** Залоговый билет — та же печатная HTML-страница, что `services/ticket.py`. */
  function renderTicket(loan) {
    var t = now();
    var app = byId("applications", loan.application_id);
    var client = byId("users", app.client_id);
    var f = figures(loan, t);
    var atDue = loan.principal + interestFor(loan.principal, loan.daily_rate_bp, loan.term_days);
    function row(label, value, money) {
      return (
        "<tr><th>" +
        esc(label) +
        "</th><td" +
        (money ? ' class="money"' : "") +
        ">" +
        esc(value) +
        "</td></tr>"
      );
    }
    var item = [row("Изделие", app.title), row("Категория", category(app).name)];
    if (app.metal)
      item.push(
        row("Металл", METAL_LABELS[app.metal] + (app.fineness ? ", проба " + app.fineness : "")),
      );
    if (app.weight_mg)
      item.push(row("Вес", (app.weight_mg / 1000).toFixed(2).replace(".", ",") + " г"));
    if (app.brand) item.push(row("Бренд", app.brand));
    if (app.condition) item.push(row("Состояние", CONDITION_LABELS[app.condition]));
    var insp = appraisalsOf(app, "INSPECTION").sort(function (a, b) {
      return a.id - b.id;
    });
    if (insp.length)
      item.push(row("Оценка при осмотре", formatKzt(insp[insp.length - 1].value), true));
    var terms = [
      row("Сумма займа", formatKzt(loan.principal), true),
      row("Ставка", formatRate(loan.daily_rate_bp)),
      row("Срок текущего периода", loan.term_days + " дн."),
      row("Дата выдачи", fmtDateTime(loan.issued_at)),
      row("Вернуть до", fmtDate(f.due_date) + " включительно"),
      row("К возврату в срок", formatKzt(atDue), true),
      row("Льготный период", "до " + fmtDate(f.grace_until)),
      row("Продлений", String(loan.extensions_count)),
      row("Статус", LOAN_STATUS_LABELS[loan.status]),
    ];
    var payments = paymentsOf(loan)
      .map(function (p) {
        return (
          "<tr><td>" +
          esc(fmtDateTime(p.created_at)) +
          "</td><td>" +
          esc(PAYMENT_KIND_LABELS[p.kind]) +
          "</td><td>" +
          esc(p.destination || "—") +
          "</td><td>" +
          esc(PAYMENT_STATUS_LABELS[p.status]) +
          '</td><td class="money">' +
          esc(formatKzt(p.amount)) +
          "</td></tr>"
        );
      })
      .join("");
    var open = loan.status === "ACTIVE" || loan.status === "OVERDUE";
    var todayRow = open
      ? '<tr class="total"><td>К оплате на ' +
        esc(fmtDate(kzDate(t))) +
        " (" +
        f.days_used +
        ' дн.)</td><td class="money">' +
        esc(formatKzt(f.total_to_repay)) +
        "</td></tr>"
      : "";
    var css =
      ':root { --ink:#1d1b18; --muted:#6b645b; --line:#d9d2c5; --accent:#7a5c1e; }\n* { box-sizing:border-box; }\nbody { margin:0; padding:32px 16px; background:#f6f3ee; color:var(--ink);\n  font:15px/1.5 "Golos Text","Segoe UI",Roboto,Arial,sans-serif; }\n.sheet { max-width:760px; margin:0 auto; background:#fff; border:1px solid var(--line);\n  padding:40px 44px; }\nheader { display:flex; justify-content:space-between; gap:24px; align-items:flex-start;\n  border-bottom:2px solid var(--ink); padding-bottom:16px; margin-bottom:24px; }\nh1 { font:600 26px/1.2 Georgia,"Times New Roman",serif; margin:0 0 4px; }\n.num { font:600 18px/1.3 ui-monospace,Menlo,Consolas,monospace; color:var(--accent); }\n.muted { color:var(--muted); font-size:13px; }\nh2 { font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted);\n  margin:28px 0 8px; }\ntable { width:100%; border-collapse:collapse; }\ntd, th { padding:7px 0; border-bottom:1px solid var(--line); text-align:left;\n  vertical-align:top; }\nth { font-weight:500; color:var(--muted); width:44%; }\ntd.money, th.money { text-align:right; font-variant-numeric:tabular-nums; }\n.total td { font-weight:600; font-size:17px; border-bottom:2px solid var(--ink); }\n.sign { display:flex; gap:40px; margin-top:40px; }\n.sign div { flex:1; border-top:1px solid var(--ink); padding-top:6px; font-size:13px;\n  color:var(--muted); }\n.note { font-size:12px; color:var(--muted); margin-top:24px; }\n@media print { body { background:#fff; padding:0; } .sheet { border:0; padding:0; } }\n@media (max-width:560px) { .sheet { padding:24px 18px; } header { flex-direction:column; } }\n';
    var phone = client.phone ? formatKzPhone(client.phone) : "—";
    return (
      '<!doctype html>\n<html lang="ru"><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Залоговый билет ' +
      esc(loan.ticket_number) +
      "</title>\n<style>" +
      css +
      '</style></head>\n<body><main class="sheet">\n<header>\n  <div><h1>Залоговый билет</h1>\n  <div class="muted">ТОО «Ломбард онлайн» · учебный проект · Казахстан · демо-версия</div></div>\n  <div style="text-align:right"><div class="num">' +
      esc(loan.ticket_number) +
      '</div>\n  <div class="muted">заявка ' +
      esc(appNumber(app)) +
      "</div></div>\n</header>\n<h2>Залогодатель</h2>\n<table>" +
      row("ФИО", client.full_name) +
      row("Телефон", phone) +
      row("E-mail", client.email) +
      "</table>\n<h2>Предмет залога</h2>\n<table>" +
      item.join("") +
      "</table>\n<h2>Условия займа</h2>\n<table>" +
      terms.join("") +
      todayRow +
      '</table>\n<h2>Операции</h2>\n<table><tr><th>Дата</th><th>Операция</th><th>Карта</th><th>Статус</th>\n<th class="money">Сумма</th></tr>' +
      payments +
      '</table>\n<p class="note">Проценты начисляются за каждый день пользования займом (не меньше одного дня)\nс даты выдачи или последнего продления. Если займ не погашен и не продлён до окончания\nльготного периода, изделие переходит в собственность ломбарда. Время — Казахстан (UTC+5).\nДокумент сформирован ' +
      esc(fmtDateTime(t)) +
      '.</p>\n<div class="sign"><div>Залогодатель</div><div>Представитель ломбарда</div></div>\n</main></body></html>\n'
    );
  }

  // ------------------------------------------------------------------------------------
  // Администратор: статистика и фоновые задачи
  // ------------------------------------------------------------------------------------

  function stats() {
    var t = now();
    var counts = {};
    STATUSES.forEach(function (s) {
      counts[s] = 0;
    });
    db.applications.forEach(function (a) {
      counts[a.status] += 1;
    });
    function sum(list) {
      return list.reduce(function (s, x) {
        return s + counts[x];
      }, 0);
    }
    var st = {
      now: iso(t),
      applications_total: db.applications.length,
      by_status: counts,
      funnel: {
        draft: sum(["DRAFT", "SUBMITTED"]),
        review: sum(["PRE_ESTIMATED", "UNDER_REVIEW", "NEED_INFO", "OFFER_SENT"]),
        logistics: sum([
          "OFFER_ACCEPTED",
          "COURIER_SCHEDULED",
          "COURIER_EN_ROUTE",
          "ITEM_PICKED_UP",
          "ITEM_DELIVERED",
          "INSPECTED",
        ]),
        loans: sum(["FUNDS_ISSUED", "LOAN_ACTIVE", "EXTENDED", "OVERDUE"]),
        closed: sum(["REPAID", "ITEM_RETURNED", "FORFEITED"]),
        declined: sum(["REJECTED", "OFFER_DECLINED"]),
      },
      loans_active: 0,
      loans_overdue: 0,
      loans_repaid: 0,
      loans_forfeited: 0,
      loans_due_soon: 0,
      portfolio_principal: 0,
      accrued_interest: 0,
      issued_total: 0,
      repaid_total: 0,
      interest_income: 0,
      failed_payments: 0,
      users_by_role: {},
      couriers_open_tasks: 0,
      courier_tasks_today: 0,
    };
    db.loans.forEach(function (loan) {
      if (loan.status === "ACTIVE" || loan.status === "OVERDUE") {
        var f = figures(loan, t);
        st.portfolio_principal += loan.principal;
        st.accrued_interest += f.interest;
        st.loans_due_soon += f.due_soon ? 1 : 0;
      }
      st.loans_active += loan.status === "ACTIVE" ? 1 : 0;
      st.loans_overdue += loan.status === "OVERDUE" ? 1 : 0;
      st.loans_repaid += loan.status === "REPAID" ? 1 : 0;
      st.loans_forfeited += loan.status === "FORFEITED" ? 1 : 0;
      paymentsOf(loan).forEach(function (p) {
        if (p.status === "FAILED") {
          st.failed_payments += 1;
          return;
        }
        if (p.status !== "SUCCEEDED") return;
        if (p.kind === "DISBURSEMENT") st.issued_total += p.amount;
        else if (p.kind === "EXTENSION") st.interest_income += p.amount;
        else if (p.kind === "REPAYMENT") {
          st.repaid_total += p.amount;
          st.interest_income += p.amount - loan.principal;
        }
      });
    });
    ROLES.forEach(function (r) {
      st.users_by_role[r] = db.users.filter(function (u) {
        return u.role === r && u.is_active;
      }).length;
    });
    var load = openTaskCounts();
    Object.keys(load).forEach(function (k) {
      st.couriers_open_tasks += load[k];
    });
    var d = kzDate(t);
    st.courier_tasks_today = db.tasks.filter(function (x) {
      return x.status !== "CANCELLED" && kzDate(x.slot_start) === d;
    }).length;
    return st;
  }
  function runJobs() {
    var t = now();
    var expired = 0;
    db.applications
      .filter(function (a) {
        return (
          a.status === "OFFER_SENT" &&
          offersOf(a).some(function (o) {
            return o.status === "SENT" && o.expires_at <= t;
          })
        );
      })
      .forEach(function (a) {
        if (expireOfferIfNeeded(a, t)) expired++;
      });
    var counts = processLoans(t);
    return {
      now: iso(t),
      offers_expired: expired,
      loans_overdue: counts.overdue,
      loans_forfeited: counts.forfeited,
    };
  }
  function advanceClock(days, hours, jobs) {
    db.clock_offset += days * DAY + hours * HOUR;
    var r = clockRead();
    r.jobs = jobs === false ? null : runJobs();
    return r;
  }

  function adminCategoryRead(c) {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      ltv_percent: c.ltv_percent,
      daily_rate_bp: c.daily_rate_bp,
      min_term_days: c.min_term_days,
      max_term_days: c.max_term_days,
      requires_metal: c.requires_metal,
      sort_order: c.sort_order,
      is_active: c.is_active,
    };
  }
  function metalPriceRead(p, currentIds) {
    return {
      id: p.id,
      metal: p.metal,
      price_per_gram: p.price_per_gram,
      effective_from: iso(p.effective_from),
      source: p.source,
      is_current: Boolean(currentIds[p.id]),
    };
  }
  function currentPriceIds() {
    var cur = currentMetalPrices();
    var ids = {};
    Object.keys(cur).forEach(function (m) {
      ids[cur[m].id] = true;
    });
    return ids;
  }
  function validateRegister(body, staff) {
    var v = new Validator(body);
    v.str("email", { required: true });
    v.str("password", { required: true, min: 8, max: 128 });
    v.str("full_name", { required: true, min: 2, max: 255 });
    v.phone("phone");
    v.str("city", { max: 100 });
    if (staff) v.oneOf("role", ROLES);
    var out = v.done();
    var extra = new Validator({});
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email))
      extra.fail("email", "Некорректный адрес e-mail");
    out.email = out.email.toLowerCase();
    if (!/[^\d\W_]/.test(out.password) || !/\d/.test(out.password))
      extra.fail("password", "Пароль должен содержать хотя бы одну букву и одну цифру");
    out.full_name = squash(out.full_name);
    if (out.full_name.length < 2) extra.fail("full_name", "Укажите имя");
    extra.done();
    if (staff) {
      out.role = out.role || "EXPERT";
      if (out.role === "COURIER" && !out.city) {
        throw new HttpError(422, {
          detail: [
            { loc: ["body"], msg: "Для курьера укажите город обслуживания", type: "value_error" },
          ],
        });
      }
    }
    return out;
  }
  function createUser(data, role) {
    if (findUserByEmail(data.email)) throw conflict("Пользователь с таким e-mail уже существует");
    var t = now();
    return insert("users", {
      email: data.email,
      full_name: data.full_name,
      phone: data.phone || null,
      city: data.city || null,
      role: role,
      is_active: true,
      password: data.password,
      created_at: t,
      last_login_at: role === "CLIENT" ? t : null,
    });
  }

  // ------------------------------------------------------------------------------------
  // Демо-данные (как `backend/app/seed.py` + одна заявка, ожидающая эксперта)
  // ------------------------------------------------------------------------------------

  var SEED_CATEGORIES = [
    ["gold", "Золото", 80, 25, 7, 60, true, "Кольца, серьги, цепи, браслеты, слитки"],
    ["silver", "Серебро", 70, 30, 7, 60, true, "Украшения и столовое серебро"],
    ["platinum", "Платина и палладий", 75, 25, 7, 60, true, "Украшения из платины"],
    ["watches", "Часы", 60, 30, 7, 60, false, "Швейцарские и японские часы с документами"],
    ["electronics", "Электроника", 50, 40, 7, 30, false, "Смартфоны, ноутбуки, планшеты"],
  ];
  var SEED_PRICES = { GOLD: 6650000, SILVER: 82000, PLATINUM: 2600000, PALLADIUM: 2350000 };
  var SEED_USERS = [
    ["client@lombard.kz", "Айгерим Садыкова", "CLIENT", "+77011234567", "Алматы"],
    ["client2@lombard.kz", "Данияр Ахметов", "CLIENT", "+77771234568", "Астана"],
    ["expert@lombard.kz", "Ерлан Касымов", "EXPERT", "+77052223344", "Алматы"],
    ["courier@lombard.kz", "Нурлан Жумабаев", "COURIER", "+77475556677", "Алматы"],
    ["courier2@lombard.kz", "Асель Нурланова", "COURIER", "+77758889900", "Астана"],
    ["admin@lombard.kz", "Гульнара Беккожина", "ADMIN", "+77273001020", "Алматы"],
  ];

  function seed() {
    db = emptyDb();
    var t = Date.now();
    SEED_CATEGORIES.forEach(function (c, i) {
      insert("categories", {
        code: c[0],
        name: c[1],
        ltv_percent: c[2],
        daily_rate_bp: c[3],
        min_term_days: c[4],
        max_term_days: c[5],
        requires_metal: c[6],
        description: c[7],
        sort_order: i * 10,
        is_active: true,
      });
    });
    METALS.forEach(function (m) {
      insert("metal_prices", {
        metal: m,
        price_per_gram: SEED_PRICES[m],
        effective_from: Date.parse("2026-11-01T00:00:00Z"),
        source: "seed",
      });
    });
    SEED_USERS.forEach(function (u) {
      insert("users", {
        email: u[0],
        full_name: u[1],
        role: u[2],
        phone: u[3],
        city: u[4],
        is_active: true,
        password: DEMO_PASSWORD,
        created_at: t,
        last_login_at: null,
      });
    });
    // Черновик клиента — как в backend.
    var client = findUserByEmail("client@lombard.kz");
    createApplication(client, {
      category_id: 1,
      title: "Кольцо с бриллиантом",
      description: "Золотое кольцо 585 пробы, бриллиант 0,2 карат, есть бирка.",
      metal: "GOLD",
      fineness: 585,
      weight_g: 3.52,
      condition: "EXCELLENT",
      requested_amount: 15000000,
    });
    return seedWithPhotos(t);
  }

  /** Заявка второго клиента с фото — в очереди эксперта сразу есть что оценить. */
  function seedWithPhotos(t) {
    var sources = global.LOMBARD_DEMO_SEED_PHOTOS;
    if (!sources || !sources.length || typeof document === "undefined") return Promise.resolve();
    var client = findUserByEmail("client2@lombard.kz");
    var created = t - 26 * 60000;
    var app = createApplication(
      client,
      {
        category_id: 1,
        title: "Обручальное кольцо",
        description: "Классическое гладкое кольцо, проба на внутренней стороне. Чек не сохранился.",
        metal: "GOLD",
        fineness: 585,
        weight_g: 4.2,
        condition: "GOOD",
        requested_amount: 10000000,
      },
      created,
    );
    return Promise.all(
      sources.map(function (s) {
        return processImage(s.dataUrl).then(function (norm) {
          return { name: s.name, norm: norm };
        });
      }),
    )
      .then(function (list) {
        list.forEach(function (x) {
          var p = savePhoto(app, x.name, x.norm);
          p.created_at = created;
        });
        submitApplication(app, client, t - 9 * 60000);
        app.updated_at = t - 9 * 60000;
      })
      .catch(function () {
        /* без фото демо всё равно работает */
      });
  }

  // ------------------------------------------------------------------------------------
  // Маршруты API
  // ------------------------------------------------------------------------------------

  var routes = [];
  function route(method, pattern, handler) {
    var keys = [];
    var re = new RegExp(
      "^" +
        pattern.replace(/:(\w+)/g, function (_, k) {
          keys.push(k);
          return "(\\d+)";
        }) +
        "$",
    );
    routes.push({ method: method, re: re, keys: keys, handler: handler });
  }
  function auth(ctx) {
    var header = ctx.headers.get("Authorization") || "";
    var token = header.replace(/^Bearer\s+/i, "");
    if (!token) throw unauthorized();
    var user = userFromToken(token, "access");
    if (!user) throw unauthorized("Пользователь не найден");
    if (!user.is_active) throw unauthorized("Учётная запись заблокирована");
    return user;
  }
  function role(ctx) {
    var allowed = Array.prototype.slice.call(arguments, 1);
    var user = auth(ctx);
    if (allowed.indexOf(user.role) < 0) throw forbidden();
    return user;
  }
  function created(body) {
    return { status: 201, body: body };
  }
  function qint(ctx, name, min, max) {
    var raw = ctx.query.get(name);
    if (raw === null || raw === "") return null;
    var n = Number(raw);
    if (!/^-?\d+$/.test(raw))
      throw new HttpError(422, {
        detail: [{ loc: ["query", name], msg: "Ожидается целое число", type: "int_parsing" }],
      });
    if (min !== undefined && n < min)
      throw new HttpError(422, {
        detail: [
          {
            loc: ["query", name],
            msg: "Значение должно быть не меньше " + min,
            type: "greater_than_equal",
          },
        ],
      });
    if (max !== undefined && n > max)
      throw new HttpError(422, {
        detail: [
          {
            loc: ["query", name],
            msg: "Значение должно быть не больше " + max,
            type: "less_than_equal",
          },
        ],
      });
    return n;
  }
  function qenum(ctx, name, values, dflt) {
    var raw = ctx.query.get(name);
    if (raw === null || raw === "") return dflt;
    if (values.indexOf(raw) < 0) {
      throw new HttpError(422, {
        detail: [
          {
            loc: ["query", name],
            msg:
              "Допустимые значения: " +
              values
                .map(function (v) {
                  return "'" + v + "'";
                })
                .join(", "),
            type: "enum",
          },
        ],
      });
    }
    return raw;
  }

  // --- health, auth, catalog, calculator ---

  route("GET", "/health", function () {
    return { status: "ok", app: "Ломбард онлайн (демо)", version: "demo", environment: "demo" };
  });

  route("POST", "/auth/login", function (ctx) {
    var v = new Validator(ctx.body);
    v.str("email", { required: true });
    v.str("password", { required: true, max: 128 });
    var d = v.done();
    var user = findUserByEmail(d.email);
    if (!user || user.password !== d.password) throw unauthorized("Неверный e-mail или пароль");
    if (!user.is_active) throw forbidden("Учётная запись заблокирована");
    user.last_login_at = now();
    return authResponse(user);
  });
  route("POST", "/auth/register", function (ctx) {
    var d = validateRegister(ctx.body, false);
    return created(authResponse(createUser(d, "CLIENT")));
  });
  route("POST", "/auth/refresh", function (ctx) {
    var user = userFromToken((ctx.body || {}).refresh_token, "refresh");
    if (!user || !user.is_active) throw unauthorized("Учётная запись недоступна");
    return tokenPair(user);
  });
  route("GET", "/auth/me", function (ctx) {
    return userRead(auth(ctx));
  });

  route("GET", "/catalog/categories", function () {
    return db.categories
      .filter(function (c) {
        return c.is_active;
      })
      .sort(function (a, b) {
        return a.sort_order - b.sort_order || a.id - b.id;
      })
      .map(function (c) {
        var metals = c.requires_metal ? CATEGORY_METALS[c.code] : null;
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          description: c.description,
          ltv_percent: c.ltv_percent,
          daily_rate_bp: c.daily_rate_bp,
          min_term_days: c.min_term_days,
          max_term_days: c.max_term_days,
          requires_metal: c.requires_metal,
          allowed_metals: METALS.filter(function (m) {
            return !metals || metals.indexOf(m) >= 0;
          }),
        };
      });
  });
  route("GET", "/catalog/metals", function () {
    var prices = currentMetalPrices();
    return METALS.map(function (m) {
      return {
        metal: m,
        label: METAL_LABELS[m],
        finenesses: FINENESS_BY_METAL[m].slice(),
        price_per_gram: prices[m] ? prices[m].price_per_gram : null,
        effective_from: prices[m] ? iso(prices[m].effective_from) : null,
      };
    });
  });
  route("GET", "/catalog/conditions", function () {
    return CONDITIONS.map(function (c) {
      return { condition: c, label: CONDITION_LABELS[c] };
    });
  });

  route("POST", "/calculator", function (ctx) {
    var v = new Validator(ctx.body);
    v.num("category_id", {});
    v.str("category_code", { max: 50 });
    v.num("term_days", { required: true, ge: 1, le: 365 });
    v.num("market_value", { gt: 0, le: MAX_MARKET_VALUE });
    v.oneOf("metal", METALS);
    v.num("fineness", { ge: 1, le: 999 });
    v.num("weight_g", { gt: 0, le: 10000, decimal: 3 });
    v.str("brand", { max: 100 });
    v.oneOf("condition", CONDITIONS);
    v.num("loan_amount", { gt: 0 });
    var d = v.done();
    if (d.category_id == null && !d.category_code) {
      throw new HttpError(422, {
        detail: [
          {
            loc: ["body"],
            msg: "Укажите категорию (category_id или category_code)",
            type: "value_error",
          },
        ],
      });
    }
    var cat = db.categories.filter(function (c) {
      return (
        c.is_active && (d.category_id != null ? c.id === d.category_id : c.code === d.category_code)
      );
    })[0];
    if (!cat) throw problems([["category_id", "Категория не найдена"]]);
    var value,
      vmin,
      vmax,
      estimated,
      steps = [];
    if (d.market_value != null) {
      value = vmin = vmax = d.market_value;
      estimated = false;
    } else {
      var errs = validateMetalParams(cat.code, cat.requires_metal, d.metal, d.fineness);
      if (errs.length) throw problems(errs, "Проверьте параметры изделия");
      var price = d.metal ? currentMetalPrices()[d.metal] : null;
      var r;
      try {
        r = estimate({
          category_code: cat.code,
          category_name: cat.name,
          requires_metal: cat.requires_metal,
          ltv_percent: cat.ltv_percent,
          metal: d.metal || null,
          fineness: d.fineness == null ? null : d.fineness,
          weight_mg: weightMg(d.weight_g),
          brand: d.brand || null,
          condition: d.condition || null,
          metal_price_per_gram: price ? price.price_per_gram : null,
          photo_confidence: null,
        });
      } catch (e) {
        if (e instanceof EstimateError)
          throw problems(
            [["market_value", e.message + ". Или укажите стоимость изделия"]],
            "Недостаточно данных для расчёта",
          );
        throw e;
      }
      value = r.value;
      vmin = r.value_min;
      vmax = r.value_max;
      estimated = true;
      steps = r.steps;
    }
    var terms = {
      market_value: value,
      ltv_percent: cat.ltv_percent,
      daily_rate_bp: cat.daily_rate_bp,
      term_days: d.term_days,
      loan_amount: d.loan_amount == null ? null : d.loan_amount,
    };
    var errors = validateTerms(cat, terms);
    if (errors.length) throw problems(errors, "Проверьте условия расчёта");
    var limit = maxLoanAmount(value, cat.ltv_percent);
    var amount = d.loan_amount != null ? d.loan_amount : limit;
    return {
      category_id: cat.id,
      category_name: cat.name,
      ltv_percent: cat.ltv_percent,
      market_value: value,
      value_min: vmin,
      value_max: vmax,
      estimated: estimated,
      estimate_steps: steps,
      max_loan_amount: limit,
      quote: quote(amount, cat.daily_rate_bp, d.term_days, today()),
    };
  });

  // --- уведомления ---

  function inbox(user) {
    return db.notifications
      .filter(function (n) {
        return n.user_id === user.id && n.channel === "IN_APP";
      })
      .sort(function (a, b) {
        return b.created_at - a.created_at || b.id - a.id;
      });
  }
  function noteRead(n) {
    return {
      id: n.id,
      channel: n.channel,
      title: n.title,
      body: n.body,
      is_read: n.is_read,
      application_id: n.application_id,
      created_at: iso(n.created_at),
    };
  }
  route("GET", "/notifications", function (ctx) {
    var user = auth(ctx);
    var limit = qint(ctx, "limit", 1, 200) || 50;
    var unread = ctx.query.get("unread") === "true";
    return inbox(user)
      .filter(function (n) {
        return !unread || !n.is_read;
      })
      .slice(0, limit)
      .map(noteRead);
  });
  route("GET", "/notifications/unread-count", function (ctx) {
    var user = auth(ctx);
    return {
      unread: inbox(user).filter(function (n) {
        return !n.is_read;
      }).length,
    };
  });
  route("POST", "/notifications/read-all", function (ctx) {
    var user = auth(ctx);
    inbox(user).forEach(function (n) {
      n.is_read = true;
    });
    return { unread: 0 };
  });
  route("POST", "/notifications/:id/read", function (ctx) {
    var user = auth(ctx);
    var n = byId("notifications", ctx.params.id);
    if (!n || n.user_id !== user.id || n.channel !== "IN_APP")
      throw notFound("Уведомление не найдено");
    n.is_read = true;
    return noteRead(n);
  });

  // --- заявки клиента ---

  route("GET", "/applications", function (ctx) {
    var user = role(ctx, "CLIENT", "EXPERT", "ADMIN");
    var status = qenum(ctx, "status", STATUSES, null);
    return db.applications
      .filter(function (a) {
        return (
          (user.role !== "CLIENT" || a.client_id === user.id) && (!status || a.status === status)
        );
      })
      .sort(function (a, b) {
        return b.created_at - a.created_at || b.id - a.id;
      })
      .map(listItem);
  });
  route("POST", "/applications", function (ctx) {
    var user = role(ctx, "CLIENT");
    return created(card(createApplication(user, ctx.body), user));
  });
  route("GET", "/applications/:id", function (ctx) {
    var user = role(ctx, "CLIENT", "EXPERT", "ADMIN");
    return card(getApplication(ctx.params.id, user), user);
  });
  route("PATCH", "/applications/:id", function (ctx) {
    var user = role(ctx, "CLIENT");
    var app = getApplication(ctx.params.id, user);
    updateApplication(app, ctx.body);
    return card(app, user);
  });
  route("DELETE", "/applications/:id", function (ctx) {
    var user = role(ctx, "CLIENT");
    var app = getApplication(ctx.params.id, user);
    if (app.status !== "DRAFT") throw conflict("Удалить можно только черновик");
    var photos = appPhotos(app);
    ["photos", "history", "appraisals", "notifications"].forEach(function (table) {
      db[table] = db[table].filter(function (r) {
        return r.application_id !== app.id;
      });
    });
    db.applications = db.applications.filter(function (a) {
      return a.id !== app.id;
    });
    ctx.after(function () {
      photos.forEach(function (p) {
        removePhotoData(p.id);
      });
    });
    return { status: 204, body: null };
  });
  route("POST", "/applications/:id/photos", function (ctx) {
    var user = role(ctx, "CLIENT");
    var app = getApplication(ctx.params.id, user);
    var files =
      ctx.body instanceof FormData
        ? ctx.body.getAll("files").filter(function (f) {
            return typeof f === "object";
          })
        : [];
    if (!(ctx.body instanceof FormData))
      throw new HttpError(422, {
        detail: [{ loc: ["body", "files"], msg: "Обязательное поле", type: "missing" }],
      });
    return addPhotos(app, files).then(function () {
      return created(card(app, user));
    });
  });
  route("DELETE", "/applications/:id/photos/:photo", function (ctx) {
    var user = role(ctx, "CLIENT");
    var app = getApplication(ctx.params.id, user);
    ensureEditable(app);
    var photo = byId("photos", ctx.params.photo);
    if (!photo || photo.application_id !== app.id) throw notFound("Фото не найдено");
    db.photos = db.photos.filter(function (p) {
      return p.id !== photo.id;
    });
    renumber(app);
    app.updated_at = now();
    ctx.after(function () {
      removePhotoData(photo.id);
    });
    return card(app, user);
  });
  route("PUT", "/applications/:id/photos/order", function (ctx) {
    var user = role(ctx, "CLIENT");
    var app = getApplication(ctx.params.id, user);
    var ids = (ctx.body || {}).photo_ids;
    if (!Array.isArray(ids))
      throw new HttpError(422, {
        detail: [{ loc: ["body", "photo_ids"], msg: "Обязательное поле", type: "missing" }],
      });
    if (!ids.length)
      throw new HttpError(422, {
        detail: [
          { loc: ["body", "photo_ids"], msg: "Нужно хотя бы 1 элемент(ов)", type: "too_short" },
        ],
      });
    ensureEditable(app);
    var current = appPhotos(app);
    var a = ids
      .slice()
      .sort(function (x, y) {
        return x - y;
      })
      .join(",");
    var b = current
      .map(function (p) {
        return p.id;
      })
      .sort(function (x, y) {
        return x - y;
      })
      .join(",");
    if (a !== b) throw problems([["photo_ids", "Передайте все фото заявки ровно по одному разу"]]);
    ids.forEach(function (id, i) {
      byId("photos", id).position = i;
    });
    app.updated_at = now();
    return card(app, user);
  });
  route("POST", "/applications/:id/submit", function (ctx) {
    var user = role(ctx, "CLIENT");
    var app = getApplication(ctx.params.id, user);
    submitApplication(app, user);
    return card(app, user);
  });
  route("POST", "/applications/:id/offer/accept", function (ctx) {
    var user = role(ctx, "CLIENT");
    var app = getApplication(ctx.params.id, user);
    acceptOffer(app, user);
    return card(app, user);
  });
  route("POST", "/applications/:id/offer/decline", function (ctx) {
    var user = role(ctx, "CLIENT");
    var app = getApplication(ctx.params.id, user);
    var v = new Validator(ctx.body);
    v.str("reason", { max: 2000 });
    declineOffer(app, user, v.done().reason);
    return card(app, user);
  });
  route("POST", "/applications/:id/courier", function (ctx) {
    var user = role(ctx, "CLIENT", "ADMIN");
    var app = getApplication(ctx.params.id, user);
    schedulePickup(app, user, visitInput(validateVisit(ctx.body), byId("users", app.client_id)));
    return card(app, user);
  });
  route("PUT", "/applications/:id/courier", function (ctx) {
    var user = role(ctx, "CLIENT", "ADMIN");
    var app = getApplication(ctx.params.id, user);
    reschedulePickup(app, user, visitInput(validateVisit(ctx.body), byId("users", app.client_id)));
    return card(app, user);
  });
  route("POST", "/applications/:id/payout", function (ctx) {
    var user = role(ctx, "CLIENT", "ADMIN");
    var app = getApplication(ctx.params.id, user);
    issueFunds(app, user, validateCardBody(ctx.body).card_number);
    return card(app, user);
  });
  route("POST", "/applications/:id/return", function (ctx) {
    var user = role(ctx, "CLIENT", "ADMIN");
    var app = getApplication(ctx.params.id, user);
    scheduleReturn(app, user, visitInput(validateVisit(ctx.body), byId("users", app.client_id)));
    return card(app, user);
  });

  // --- доставка ---

  route("GET", "/delivery/cities", function (ctx) {
    auth(ctx);
    return servedCities().map(function (c) {
      return { city: c[0], couriers: c[1] };
    });
  });
  route("GET", "/delivery/slots", function (ctx) {
    auth(ctx);
    var city = ctx.query.get("city") || "";
    if (city.length < 2)
      throw new HttpError(422, {
        detail: [
          { loc: ["query", "city"], msg: "Минимальная длина — 2 симв.", type: "string_too_short" },
        ],
      });
    if (!isServed(city))
      throw problems(
        [["city", "В этом городе курьерская служба пока не работает"]],
        "Проверьте город",
      );
    var couriers = activeCouriers(city).map(function (c) {
      return c.id;
    });
    return bookableSlots(now()).map(function (s) {
      var busy = busyCourierIds(s.start, s.end);
      var free = couriers.filter(function (id) {
        return !busy[id];
      }).length;
      return {
        start: iso(s.start),
        end: iso(s.end),
        date: kzDate(s.start),
        label: slotLabel(s.start, s.end),
        capacity: couriers.length,
        free: free,
        available: free > 0,
      };
    });
  });

  // --- займы ---

  route("GET", "/loans", function (ctx) {
    var user = role(ctx, "CLIENT", "ADMIN");
    var status = qenum(ctx, "status", ["ACTIVE", "OVERDUE", "REPAID", "FORFEITED"], null);
    var t = now();
    var list = loansOf(user);
    list.forEach(function (l) {
      syncLoan(l, t);
    });
    return list
      .filter(function (l) {
        return !status || l.status === status;
      })
      .map(function (l) {
        return loanRead(l, user);
      });
  });
  route("GET", "/loans/:id", function (ctx) {
    var user = role(ctx, "CLIENT", "ADMIN");
    var loan = getLoan(ctx.params.id, user);
    syncLoan(loan, now());
    return loanRead(loan, user);
  });
  route("GET", "/loans/:id/ticket", function (ctx) {
    var user = role(ctx, "CLIENT", "ADMIN");
    var loan = getLoan(ctx.params.id, user);
    syncLoan(loan, now());
    return { status: 200, html: renderTicket(loan) };
  });
  route("GET", "/loans/:id/extension", function (ctx) {
    var user = role(ctx, "CLIENT", "ADMIN");
    var loan = getLoan(ctx.params.id, user);
    var t = now();
    syncLoan(loan, t);
    var term = qint(ctx, "term_days", 1, 365);
    ctx.commit();
    return extensionQuote(loan, term, t);
  });
  route("POST", "/loans/:id/repay", function (ctx) {
    var user = role(ctx, "CLIENT");
    var loan = getLoan(ctx.params.id, user);
    repay(loan, user, validateCardBody(ctx.body).card_number);
    return loanRead(loan, user);
  });
  route("POST", "/loans/:id/extend", function (ctx) {
    var user = role(ctx, "CLIENT");
    var loan = getLoan(ctx.params.id, user);
    var d = validateCardBody(ctx.body, true);
    extend(loan, user, d.card_number, d.term_days);
    return loanRead(loan, user);
  });

  // --- эксперт ---

  route("GET", "/expert/queue", function (ctx) {
    var user = role(ctx, "EXPERT", "ADMIN");
    var scope = qenum(ctx, "scope", ["new", "mine", "inspection", "all"], "new");
    return expertQueue(user, scope).map(queueItem);
  });
  route("POST", "/expert/applications/:id/take", function (ctx) {
    var user = role(ctx, "EXPERT");
    var app = getApplication(ctx.params.id, user);
    takeApplication(app, user);
    return card(app, user);
  });
  route("POST", "/expert/applications/:id/quote", function (ctx) {
    var user = role(ctx, "EXPERT");
    var app = getApplication(ctx.params.id, user);
    var d = offerInput(validateOfferTerms(ctx.body, false), app);
    ensureAssigned(app, user);
    return buildQuote(category(app), d, today());
  });
  route("POST", "/expert/applications/:id/offer", function (ctx) {
    var user = role(ctx, "EXPERT");
    var app = getApplication(ctx.params.id, user);
    sendOffer(app, user, offerInput(validateOfferTerms(ctx.body, true), app));
    return card(app, user);
  });
  route("POST", "/expert/applications/:id/need-info", function (ctx) {
    var user = role(ctx, "EXPERT");
    var app = getApplication(ctx.params.id, user);
    var v = new Validator(ctx.body);
    v.str("comment", { max: 2000 });
    var comment = v.done().comment;
    ensureAssigned(app, user);
    var text = requireComment(comment, "comment", "Напишите клиенту, что нужно добавить");
    changeStatus(app, "NEED_INFO", user, text);
    notify(app.client_id, "Нужны дополнения к заявке " + appNumber(app), text, app);
    return card(app, user);
  });
  route("POST", "/expert/applications/:id/reject", function (ctx) {
    var user = role(ctx, "EXPERT");
    var app = getApplication(ctx.params.id, user);
    var v = new Validator(ctx.body);
    v.str("reason", { max: 2000 });
    var reason = v.done().reason;
    ensureAssigned(app, user);
    var text = requireComment(reason, "reason", "Укажите причину отказа");
    changeStatus(app, "REJECTED", user, text);
    notify(app.client_id, "Заявка " + appNumber(app) + " отклонена", text, app);
    return card(app, user);
  });
  route("POST", "/expert/applications/:id/inspection/quote", function (ctx) {
    var user = role(ctx, "EXPERT");
    var app = getApplication(ctx.params.id, user);
    var plan = planInspection(app, validateInspection(ctx.body), now());
    return {
      market_value: plan.market_value,
      offer_loan_amount: plan.offer.loan_amount,
      adjusted: plan.adjusted,
      quote: plan.quote,
    };
  });
  route("POST", "/expert/applications/:id/inspection", function (ctx) {
    var user = role(ctx, "EXPERT");
    var app = getApplication(ctx.params.id, user);
    inspect(app, user, validateInspection(ctx.body));
    return card(app, user);
  });

  // --- курьер ---

  route("GET", "/courier/tasks", function (ctx) {
    var user = role(ctx, "COURIER", "ADMIN");
    var scope = qenum(ctx, "scope", ["day", "active", "done", "all"], "day");
    var day = ctx.query.get("day") || null;
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day))
      throw new HttpError(422, {
        detail: [{ loc: ["query", "day"], msg: "Ожидается дата", type: "date_parsing" }],
      });
    return listTasks(user, scope, { day: day }).map(function (t) {
      return taskRead(t, user);
    });
  });
  route("GET", "/courier/tasks/:id", function (ctx) {
    var user = role(ctx, "COURIER", "ADMIN");
    return taskRead(getTask(ctx.params.id, user), user);
  });
  [
    ["start", "start"],
    ["pick-up", "pick_up"],
    ["deliver", "deliver"],
  ].forEach(function (s) {
    route("POST", "/courier/tasks/:id/" + s[0], function (ctx) {
      var user = role(ctx, "COURIER");
      var task = getTask(ctx.params.id, user);
      courierStep(task, user, s[1]);
      return taskRead(task, user);
    });
  });

  // --- администратор ---

  route("GET", "/admin/categories", function (ctx) {
    role(ctx, "ADMIN");
    return db.categories
      .slice()
      .sort(function (a, b) {
        return a.sort_order - b.sort_order || a.id - b.id;
      })
      .map(adminCategoryRead);
  });
  route("POST", "/admin/categories", function (ctx) {
    role(ctx, "ADMIN");
    var v = new Validator(ctx.body);
    v.str("code", { required: true, min: 2, max: 50, pattern: /^[a-z][a-z0-9_]*$/ });
    v.str("name", { required: true, min: 2, max: 100 });
    v.str("description", { max: 2000 });
    v.num("ltv_percent", { required: true, ge: 1, le: 100 });
    v.num("daily_rate_bp", { required: true, ge: 1, le: 1000 });
    v.num("min_term_days", { ge: 1, le: 365 });
    v.num("max_term_days", { ge: 1, le: 365 });
    v.bool("requires_metal");
    v.num("sort_order", {});
    var d = v.done();
    var tmin = d.min_term_days == null ? 7 : d.min_term_days;
    var tmax = d.max_term_days == null ? 60 : d.max_term_days;
    if (tmax < tmin)
      throw new HttpError(422, {
        detail: [
          { loc: ["body"], msg: "Максимальный срок меньше минимального", type: "value_error" },
        ],
      });
    if (
      db.categories.some(function (c) {
        return c.code === d.code;
      })
    )
      throw conflict("Категория с таким кодом уже есть");
    return created(
      adminCategoryRead(
        insert("categories", {
          code: d.code,
          name: d.name,
          description: d.description == null ? null : d.description,
          ltv_percent: d.ltv_percent,
          daily_rate_bp: d.daily_rate_bp,
          min_term_days: tmin,
          max_term_days: tmax,
          requires_metal: Boolean(d.requires_metal),
          sort_order: d.sort_order == null ? 100 : d.sort_order,
          is_active: true,
        }),
      ),
    );
  });
  route("PATCH", "/admin/categories/:id", function (ctx) {
    role(ctx, "ADMIN");
    var c = byId("categories", ctx.params.id);
    if (!c) throw notFound("Категория не найдена");
    var v = new Validator(ctx.body);
    v.str("name", { min: 2, max: 100 });
    v.str("description", { max: 2000 });
    v.num("ltv_percent", { ge: 1, le: 100 });
    v.num("daily_rate_bp", { ge: 1, le: 1000 });
    v.num("min_term_days", { ge: 1, le: 365 });
    v.num("max_term_days", { ge: 1, le: 365 });
    v.num("sort_order", {});
    v.bool("is_active");
    var d = v.done();
    var changes = {};
    Object.keys(d).forEach(function (k) {
      if (d[k] !== null) changes[k] = d[k];
    });
    var tmin = "min_term_days" in changes ? changes.min_term_days : c.min_term_days;
    var tmax = "max_term_days" in changes ? changes.max_term_days : c.max_term_days;
    if (tmax < tmin)
      throw problems(
        [["max_term_days", "Максимальный срок меньше минимального"]],
        "Проверьте условия категории",
      );
    Object.keys(changes).forEach(function (k) {
      c[k] = changes[k];
    });
    return adminCategoryRead(c);
  });
  route("GET", "/admin/metal-prices", function (ctx) {
    role(ctx, "ADMIN");
    var metal = qenum(ctx, "metal", METALS, null);
    var ids = currentPriceIds();
    return db.metal_prices
      .filter(function (p) {
        return !metal || p.metal === metal;
      })
      .sort(function (a, b) {
        return b.effective_from - a.effective_from || b.id - a.id;
      })
      .map(function (p) {
        return metalPriceRead(p, ids);
      });
  });
  route("POST", "/admin/metal-prices", function (ctx) {
    role(ctx, "ADMIN");
    var v = new Validator(ctx.body);
    v.oneOf("metal", METALS, true);
    v.num("price_per_gram", { required: true, gt: 0, le: 1000000000 });
    v.str("effective_from", {});
    v.str("source", { max: 100 });
    var d = v.done();
    var effective = now();
    if (d.effective_from) {
      if (
        !/(Z|[+-]\d\d:?\d\d)$/.test(d.effective_from) ||
        !isFinite(Date.parse(d.effective_from))
      ) {
        throw new HttpError(422, {
          detail: [
            {
              loc: ["body", "effective_from"],
              msg: "Укажите время с часовым поясом, например 2026-11-05T09:00:00+05:00",
              type: "value_error",
            },
          ],
        });
      }
      effective = Date.parse(d.effective_from);
    }
    if (
      db.metal_prices.some(function (p) {
        return p.metal === d.metal && p.effective_from === effective;
      })
    )
      throw conflict("Цена на это время уже задана");
    var price = insert("metal_prices", {
      metal: d.metal,
      price_per_gram: d.price_per_gram,
      effective_from: effective,
      source: d.source || "manual",
    });
    return created(metalPriceRead(price, currentPriceIds()));
  });
  route("GET", "/admin/users", function (ctx) {
    role(ctx, "ADMIN");
    var r = qenum(ctx, "role", ROLES, null);
    var q = (ctx.query.get("q") || "").toLowerCase();
    return db.users
      .filter(function (u) {
        return (
          (!r || u.role === r) &&
          (!q || u.email.toLowerCase().indexOf(q) >= 0 || u.full_name.toLowerCase().indexOf(q) >= 0)
        );
      })
      .sort(function (a, b) {
        return a.id - b.id;
      })
      .map(userRead);
  });
  route("POST", "/admin/users", function (ctx) {
    role(ctx, "ADMIN");
    var d = validateRegister(ctx.body, true);
    return created(userRead(createUser(d, d.role)));
  });
  route("PATCH", "/admin/users/:id", function (ctx) {
    var admin = role(ctx, "ADMIN");
    var user = byId("users", ctx.params.id);
    if (!user) throw notFound("Пользователь не найден");
    var v = new Validator(ctx.body);
    v.oneOf("role", ROLES);
    v.bool("is_active");
    v.str("city", { max: 100 });
    var d = v.done();
    if (
      user.id === admin.id &&
      (d.is_active === false || ("role" in d && d.role !== null && d.role !== "ADMIN"))
    ) {
      throw conflict("Нельзя снять с себя роль администратора или заблокировать себя");
    }
    Object.keys(d).forEach(function (k) {
      if (d[k] !== null || k === "city") user[k] = d[k];
    });
    return userRead(user);
  });
  route("GET", "/admin/couriers", function (ctx) {
    var admin = role(ctx, "ADMIN");
    var city = ctx.query.get("city");
    var load = openTaskCounts();
    var todayCounts = {};
    listTasks(admin, "day").forEach(function (t) {
      if (t.courier_id) todayCounts[t.courier_id] = (todayCounts[t.courier_id] || 0) + 1;
    });
    return activeCouriers(city || null).map(function (c) {
      return {
        courier: brief(c),
        open_tasks: load[c.id] || 0,
        today_tasks: todayCounts[c.id] || 0,
      };
    });
  });
  route("GET", "/admin/courier-tasks", function (ctx) {
    var admin = role(ctx, "ADMIN");
    var scope = qenum(ctx, "scope", ["day", "active", "done", "all"], "active");
    var opts = {
      day: ctx.query.get("day") || null,
      courier_id: qint(ctx, "courier_id"),
      unassigned: ctx.query.get("unassigned") === "true",
    };
    return listTasks(admin, scope, opts).map(function (t) {
      return taskRead(t, admin);
    });
  });
  route("POST", "/admin/courier-tasks/:id/assign", function (ctx) {
    var admin = role(ctx, "ADMIN");
    var task = getTask(ctx.params.id, admin);
    var v = new Validator(ctx.body);
    v.num("courier_id", { required: true });
    var courier = byId("users", v.done().courier_id);
    if (!courier) throw notFound("Курьер не найден");
    assignCourier(task, courier, admin);
    return taskRead(task, admin);
  });
  route("GET", "/admin/stats", function (ctx) {
    role(ctx, "ADMIN");
    return stats();
  });
  route("POST", "/admin/jobs/run", function (ctx) {
    role(ctx, "ADMIN");
    return runJobs();
  });
  route("GET", "/admin/clock", function (ctx) {
    role(ctx, "ADMIN");
    return clockRead();
  });
  route("POST", "/admin/clock", function (ctx) {
    role(ctx, "ADMIN");
    var v = new Validator(ctx.body);
    v.num("days", { ge: 0, le: 365 });
    v.num("hours", { ge: 0, le: 24 * 365 });
    v.bool("run_jobs");
    var d = v.done();
    return advanceClock(d.days || 0, d.hours || 0, d.run_jobs);
  });
  route("DELETE", "/admin/clock", function (ctx) {
    role(ctx, "ADMIN");
    db.clock_offset = 0;
    return clockRead();
  });
  route("GET", "/admin/messages", function (ctx) {
    role(ctx, "ADMIN");
    var channel = qenum(ctx, "channel", ["IN_APP", "SMS", "EMAIL"], null);
    if (channel === "IN_APP")
      throw problems([["channel", "Журнал содержит только SMS и EMAIL"]], "Проверьте фильтр");
    var limit = qint(ctx, "limit", 1, 500) || 100;
    return db.notifications
      .filter(function (n) {
        return n.channel !== "IN_APP" && (!channel || n.channel === channel);
      })
      .sort(function (a, b) {
        return b.created_at - a.created_at || b.id - a.id;
      })
      .slice(0, limit)
      .map(function (n) {
        var r = noteRead(n);
        var u = byId("users", n.user_id);
        r.user = brief(u);
        r.email = u.email;
        return r;
      });
  });

  // --- только демо: панель демо-режима ---

  var ROLE_HOME_LABEL = {
    CLIENT: "Клиент",
    EXPERT: "Эксперт",
    COURIER: "Курьер",
    ADMIN: "Администратор",
  };

  function accountFor(r) {
    var last = byId("users", db.last_by_role[r]);
    if (last && last.is_active && last.role === r) return last;
    return (
      db.users
        .filter(function (u) {
          return u.role === r && u.is_active;
        })
        .sort(function (a, b) {
          return a.id - b.id;
        })[0] || null
    );
  }
  function demoState() {
    var accounts = {};
    ROLES.forEach(function (r) {
      var u = accountFor(r);
      accounts[r] = u
        ? { full_name: u.full_name, email: u.email, role_label: ROLE_HOME_LABEL[r] }
        : null;
    });
    var c = clockRead();
    c.today = today();
    c.accounts = accounts;
    return c;
  }
  route("GET", "/demo/state", function () {
    return demoState();
  });
  route("POST", "/demo/switch", function (ctx) {
    var v = new Validator(ctx.body);
    v.oneOf("role", ROLES, true);
    var user = accountFor(v.done().role);
    if (!user) throw conflict("Нет активного пользователя с этой ролью");
    user.last_login_at = now();
    return authResponse(user);
  });
  route("POST", "/demo/clock", function (ctx) {
    var v = new Validator(ctx.body);
    v.num("days", { ge: 0, le: 365 });
    var d = v.done();
    advanceClock(d.days || 0, 0, true);
    return demoState();
  });
  route("DELETE", "/demo/clock", function () {
    db.clock_offset = 0;
    return demoState();
  });
  route("POST", "/demo/reset", function (ctx) {
    ctx.reset = true;
    return { status: 204, body: null };
  });

  // ------------------------------------------------------------------------------------
  // Обработка запросов и перехват fetch
  // ------------------------------------------------------------------------------------

  var ready = null;
  var queue = Promise.resolve();

  function init() {
    db = load();
    if (db) return Promise.resolve();
    return Promise.resolve(seed()).then(function () {
      try {
        save();
      } catch (e) {
        /* нет места — работаем в памяти */
      }
    });
  }
  function resetAll() {
    wipeStorage();
    db = null;
    return init();
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function dispatch(method, path, headers, body) {
    var qi = path.indexOf("?");
    var pathname = qi < 0 ? path : path.slice(0, qi);
    var query = new URLSearchParams(qi < 0 ? "" : path.slice(qi + 1));
    var found = null;
    var allowed = false;
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].re.exec(pathname);
      if (!m) continue;
      allowed = true;
      if (routes[i].method !== method) continue;
      found = { route: routes[i], match: m };
      break;
    }
    if (!found) {
      return Promise.resolve(
        allowed
          ? { status: 405, body: { detail: "Method Not Allowed" } }
          : { status: 404, body: { detail: "Not Found" } },
      );
    }
    var params = {};
    found.route.keys.forEach(function (k, idx) {
      params[k] = Number(found.match[idx + 1]);
    });
    var afterCommit = [];
    var ctx = {
      method: method,
      params: params,
      query: query,
      headers: headers,
      body: body,
      reset: false,
      after: function (fn) {
        afterCommit.push(fn);
      },
      commit: function () {
        if (snapshot !== null) snapshot = JSON.stringify(db);
      },
    };
    // «Транзакция»: изменяющий запрос с ошибкой откатывается (как rollback в backend),
    // если ошибка не помечена commit (отказ банка, истёкшее предложение).
    var snapshot = method === "GET" ? null : JSON.stringify(db);
    return Promise.resolve()
      .then(function () {
        return found.route.handler(ctx);
      })
      .then(
        function (result) {
          if (ctx.reset) {
            return resetAll().then(function () {
              return { status: 204, body: null };
            });
          }
          try {
            save();
          } catch (e) {
            if (snapshot !== null) db = JSON.parse(snapshot);
            throw quotaError();
          }
          afterCommit.forEach(function (fn) {
            fn();
          });
          if (
            result &&
            typeof result === "object" &&
            "status" in result &&
            ("body" in result || "html" in result)
          )
            return result;
          return { status: 200, body: result };
        },
        function (err) {
          if (!(err instanceof HttpError)) throw err;
          if (snapshot !== null && !err.commit) db = JSON.parse(snapshot);
          try {
            save();
          } catch (e) {
            /* ignore */
          }
          return { status: err.status, body: err.body };
        },
      )
      .catch(function (err) {
        if (err instanceof HttpError) return { status: err.status, body: err.body };
        if (global.console) global.console.error("[demo api]", err);
        return {
          status: 500,
          body: { detail: "Ошибка демо-сервера: " + (err && err.message ? err.message : err) },
        };
      });
  }

  var REASONS = {
    200: "OK",
    201: "Created",
    204: "No Content",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    413: "Payload Too Large",
    422: "Unprocessable Entity",
    500: "Internal Server Error",
  };

  function toResponse(r) {
    var init = { status: r.status, statusText: REASONS[r.status] || "", headers: {} };
    if (r.html !== undefined) {
      init.headers["Content-Type"] = "text/html; charset=utf-8";
      return new Response(r.html, init);
    }
    if (r.status === 204 || r.body === null || r.body === undefined)
      return new Response(null, init);
    init.headers["Content-Type"] = "application/json";
    return new Response(JSON.stringify(r.body), init);
  }

  /** Путь API из адреса запроса: "/api/x", "./api/x", "file:///api/x" → "/x". */
  function apiPath(url) {
    var m = /^(?:[a-z]+:\/\/[^/]*)?(?:\.)?\/api(\/[^#]*)$/i.exec(url);
    return m ? m[1] : null;
  }

  function handle(method, path, headers, body, signal) {
    if (!ready) ready = init();
    var job = queue
      .then(function () {
        return ready;
      })
      .then(function () {
        return delay(LATENCY_MS);
      })
      .then(function () {
        if (signal && signal.aborted) throw abortError();
        return dispatch(method, path, headers, body);
      });
    // Запросы обрабатываются по очереди — как транзакции одного процесса.
    queue = job.catch(function () {});
    return job;
  }
  function abortError() {
    try {
      return new DOMException("The operation was aborted.", "AbortError");
    } catch (e) {
      var err = new Error("The operation was aborted.");
      err.name = "AbortError";
      return err;
    }
  }

  var realFetch = typeof global.fetch === "function" ? global.fetch.bind(global) : null;

  function mockFetch(input, init) {
    init = init || {};
    var url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    var path = apiPath(url);
    if (path === null) {
      if (realFetch) return realFetch(input, init);
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    var method = (init.method || (input && input.method) || "GET").toUpperCase();
    var headers = new Headers(init.headers || (input && input.headers) || {});
    var body = init.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return Promise.resolve(
          toResponse({
            status: 422,
            body: { detail: [{ loc: ["body"], msg: "Некорректный JSON", type: "json_invalid" }] },
          }),
        );
      }
    }
    var signal = init.signal;
    if (signal && signal.aborted) return Promise.reject(abortError());
    var result = handle(method, path, headers, body, signal).then(toResponse);
    if (!signal) return result;
    return new Promise(function (resolve, reject) {
      var onAbort = function () {
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      result.then(
        function (r) {
          signal.removeEventListener("abort", onAbort);
          resolve(r);
        },
        function (e) {
          signal.removeEventListener("abort", onAbort);
          reject(e);
        },
      );
    });
  }

  global.fetch = mockFetch;

  /** Для отладки из консоли и для тестов. */
  global.LombardDemo = {
    ready: function () {
      if (!ready) ready = init();
      return ready;
    },
    request: function (method, path, body, token) {
      var h = new Headers();
      if (token) h.set("Authorization", "Bearer " + token);
      return handle(method.toUpperCase(), path, h, body).then(function (r) {
        return { status: r.status, body: r.body, html: r.html };
      });
    },
    reset: function () {
      ready = queue.then(resetAll);
      return ready;
    },
    settings: SETTINGS,
    _internal: {
      estimate: estimate,
      quote: quote,
      validateTerms: validateTerms,
      maxLoanAmount: maxLoanAmount,
      interestFor: interestFor,
      formatKzt: formatKzt,
      formatRate: formatRate,
      figures: figures,
      measureGray: measureGray,
      analyzePhotos: analyzePhotos,
      normalizeKzPhone: normalizeKzPhone,
      cardProblem: cardProblem,
      maskCard: maskCard,
      bookableSlots: bookableSlots,
      slotLabel: slotLabel,
      TRANSITIONS: TRANSITIONS,
      STATUS_LABELS: STATUS_LABELS,
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
