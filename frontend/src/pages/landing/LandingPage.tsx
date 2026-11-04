import { useCategories } from "../../api/queries";
import { useAuth } from "../../auth/AuthContext";
import { homePath } from "../../auth/roles";
import { ItemArt, type ItemKind } from "../../components/ItemArt";
import { Accordion, type AccordionItem } from "../../components/ui/Accordion";
import { ButtonLink } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Icon } from "../../components/ui/Icon";
import { formatRate, formatTenge, formatTengeRange, NBSP } from "../../lib/format";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "../../layouts/PublicLayout";
import styles from "./Landing.module.css";
import { LoanCalculator } from "./LoanCalculator";

/**
 * Пример предоценки в герое — та же сквозная заявка, что в макете (№ 10-482):
 * кольцо 585, 4,2 г; оценка 112–127 тыс. ₸, займ 95 000 ₸ на 30 дней под 0,25 % в день.
 */
const EXAMPLE = {
  number: "10-482",
  title: "Кольцо",
  meta: ["Золото 585, 4,2 г", "Вставка — фианит"],
  min: 11_200_000,
  max: 12_700_000,
  confidence: 92,
  loan: 9_500_000,
  repay: 9_500_000 + Math.round((9_500_000 * 25 * 30) / 10_000),
  term: 30,
};

const STEPS = [
  {
    title: "Сфотографируйте изделие",
    text: "Загрузите от 1 до 6 фото и укажите металл, пробу и вес. Сразу покажем предварительную оценку.",
  },
  {
    title: "Получите предложение",
    text: "Эксперт проверит фото и пришлёт сумму займа, ставку и срок. Можно согласиться или отказаться.",
  },
  {
    title: "Передайте курьеру",
    text: "Курьер приедет в удобный интервал, упакует изделие в сейф-пакет и выдаст акт приёма.",
  },
  {
    title: "Получите деньги",
    text: "После осмотра в ломбарде деньги придут на карту, а залоговый билет — в личный кабинет.",
  },
];

const ACCEPTED: { codes: string[]; kind: ItemKind; title: string; text: string }[] = [
  {
    codes: ["gold", "platinum"],
    kind: "ring",
    title: "Золото и платина",
    text: "От 375 пробы, лом тоже",
  },
  { codes: ["silver"], kind: "chain", title: "Серебро", text: "От 800 пробы, столовое серебро" },
  { codes: ["watches"], kind: "watch", title: "Часы", text: "Швейцарские и японские марки" },
  {
    codes: ["electronics"],
    kind: "phone",
    title: "Электроника",
    text: "Смартфоны и ноутбуки до 3 лет",
  },
];

const FAQ: AccordionItem[] = [
  {
    id: "what",
    title: "Какие изделия вы принимаете?",
    content: (
      <p>
        Золото и платину от 375 пробы, серебро от 800, часы известных марок, смартфоны и ноутбуки не
        старше трёх лет. Если сомневаетесь — отправьте фото, эксперт ответит бесплатно.
      </p>
    ),
  },
  {
    id: "change",
    title: "Почему сумма может измениться после осмотра?",
    content: (
      <p>
        По фото эксперт не может взвесить изделие и проверить металл. Если при осмотре вес или проба
        отличаются от заявленных, сумма пересчитывается. Новую сумму вы увидите в кабинете до выдачи
        денег.
      </p>
    ),
  },
  {
    id: "return",
    title: "Как вернуть изделие?",
    content: (
      <p>
        Погасите займ в личном кабинете — сумма к оплате считается по фактическим дням. После оплаты
        выберите время, и курьер привезёт изделие в том же сейф-пакете.
      </p>
    ),
  },
  {
    id: "overdue",
    title: "Что будет, если не успею погасить займ?",
    content: (
      <p>
        После срока действует льготный период 30 дней: проценты начисляются по той же ставке, без
        штрафов. Если за это время займ не погашен и не продлён, изделие переходит ломбарду.
      </p>
    ),
  },
  {
    id: "extend",
    title: "Можно ли продлить займ онлайн?",
    content: (
      <p>
        Да. В кабинете оплатите начисленные проценты — новый срок начнётся со дня продления. Сумма
        займа при этом не меняется.
      </p>
    ),
  },
  {
    id: "safety",
    title: "Как защищено изделие при перевозке?",
    content: (
      <p>
        Курьер упаковывает изделие при вас в опломбированный сейф-пакет и выдаёт акт приёма. С этого
        момента изделие застраховано на сумму экспертной оценки.
      </p>
    ),
  },
];

function useCtaTarget(): string {
  const { user } = useAuth();
  if (!user) return "/register";
  return user.role === "CLIENT" ? "/client/new" : homePath(user.role);
}

function EstimateExample() {
  return (
    <Card as="aside" pad="l" className={styles.example} aria-label="Пример предварительной оценки">
      <div className={styles.exampleHead}>
        <p className={styles.exampleTitle}>Предварительная оценка</p>
        <p className={styles.exampleNumber}>
          Заявка №{NBSP}
          {EXAMPLE.number}
        </p>
      </div>
      <div className={styles.exampleItem}>
        <ItemArt kind="ring" square className={styles.exampleArt} />
        <div>
          <p className={styles.exampleItemTitle}>{EXAMPLE.title}</p>
          {EXAMPLE.meta.map((m) => (
            <p key={m} className={styles.exampleMeta}>
              {m}
            </p>
          ))}
        </div>
      </div>
      <div className={styles.exampleValue}>
        <p className={styles.resultCaption}>Рыночная стоимость</p>
        <p className={styles.amountL}>{formatTengeRange(EXAMPLE.min, EXAMPLE.max)}</p>
        <div className={styles.confidence}>
          <div className={styles.confidenceLabels}>
            <span>Уверенность оценки</span>
            <span>
              {EXAMPLE.confidence}
              {NBSP}%
            </span>
          </div>
          <div
            className={styles.confidenceTrack}
            role="meter"
            aria-label="Уверенность оценки"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={EXAMPLE.confidence}
          >
            <span style={{ width: `${EXAMPLE.confidence}%` }} />
          </div>
        </div>
      </div>
      <div className={styles.exampleFoot}>
        <div>
          <p className={styles.resultCaption}>Можно получить</p>
          <p className={`${styles.amountM} ${styles.accent}`}>{formatTenge(EXAMPLE.loan)}</p>
        </div>
        <div className={styles.alignEnd}>
          <p className={styles.resultCaption}>Вернуть через {EXAMPLE.term} дней</p>
          <p className={styles.amountM}>{formatTenge(EXAMPLE.repay)}</p>
        </div>
      </div>
    </Card>
  );
}

function Hero({ ctaTo }: { ctaTo: string }) {
  const categories = useCategories();
  const minRate = categories.data?.length
    ? Math.min(...categories.data.map((c) => c.daily_rate_bp))
    : null;
  const facts = [
    { icon: "clock", title: "Оценка за 15 минут", text: "Эксперты на связи с 9 до 21" },
    { icon: "shield", title: "Изделие застраховано", text: "С момента передачи курьеру" },
    {
      icon: "scale",
      title: minRate ? `От ${formatRate(minRate)} в день` : "Ставка за дни пользования",
      text: "Без комиссий за выдачу",
    },
  ] as const;

  return (
    <section className={`container ${styles.hero}`} aria-labelledby="hero-title">
      <div className={styles.heroText}>
        <h1 id="hero-title" className="t-display">
          Займ под залог без визита в ломбард
        </h1>
        <p className={`t-lead ${styles.heroLead}`}>
          Сфотографируйте украшение или часы. Эксперт оценит их за 15 минут, курьер заберёт изделие
          из дома, а деньги придут на карту.
        </p>
        <div className={styles.heroActions}>
          <ButtonLink to={ctaTo} icon="camera" size="l">
            Оценить по фото
          </ButtonLink>
          <ButtonLink to="/#calculator" variant="secondary" size="l">
            Рассчитать займ
          </ButtonLink>
        </div>
        <ul className={styles.facts} role="list">
          {facts.map((f) => (
            <li key={f.icon}>
              <Icon name={f.icon} size={20} className={styles.factIcon} />
              <p className={styles.factTitle}>{f.title}</p>
              <p className={styles.factText}>{f.text}</p>
            </li>
          ))}
        </ul>
      </div>
      <EstimateExample />
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className={`container ${styles.section}`} aria-labelledby="how-title">
      <div className={styles.sectionHead}>
        <h2 id="how-title" className="t-h1">
          Как это работает
        </h2>
        <p className={styles.sectionAside}>
          Весь путь занимает от двух часов до одного дня. В ломбард приходить не нужно.
        </p>
      </div>
      <ol className={styles.steps} role="list">
        {STEPS.map((s, i) => (
          <li key={s.title} className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="t-h4">{s.title}</h3>
            <p className={styles.stepText}>{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Accepted() {
  const categories = useCategories();
  const ltv = (codes: string[]) => {
    const list = categories.data?.filter((c) => codes.includes(c.code)) ?? [];
    return list.length ? Math.max(...list.map((c) => c.ltv_percent)) : null;
  };
  return (
    <section
      id="accepted"
      className={`container ${styles.section}`}
      aria-labelledby="accepted-title"
    >
      <h2 id="accepted-title" className={`t-h1 ${styles.sectionTitle}`}>
        Что принимаем
      </h2>
      <ul className={styles.accepted} role="list">
        {ACCEPTED.map((a) => {
          const percent = ltv(a.codes);
          return (
            <li key={a.kind}>
              <Card pad="s" className={styles.acceptedCard}>
                <ItemArt kind={a.kind} className={styles.acceptedArt} />
                <h3 className="t-h4">{a.title}</h3>
                <p className={styles.acceptedText}>{a.text}</p>
                {percent !== null && (
                  <p className={styles.acceptedLtv}>
                    До {percent}
                    {NBSP}% от оценки
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Faq() {
  return (
    <section
      id="faq"
      className={`container ${styles.section} ${styles.faq}`}
      aria-labelledby="faq-title"
    >
      <div className={styles.faqAside}>
        <h2 id="faq-title" className="t-h1">
          Вопросы
        </h2>
        <p className={styles.faqText}>Не нашли ответ — позвоните, консультация бесплатная.</p>
        <a href={SUPPORT_PHONE_HREF} className={styles.faqPhone}>
          {SUPPORT_PHONE}
        </a>
        <p className={styles.faqHours}>Ежедневно с 9:00 до 21:00</p>
      </div>
      <Accordion items={FAQ} defaultOpen="what" />
    </section>
  );
}

export function LandingPage() {
  const ctaTo = useCtaTarget();
  return (
    <>
      <Hero ctaTo={ctaTo} />
      <HowItWorks />
      <section
        id="calculator"
        className={`container ${styles.section}`}
        aria-labelledby="calc-title"
      >
        <LoanCalculator
          ctaTo={ctaTo}
          intro={
            <div className={styles.calcIntro}>
              <h2 id="calc-title" className="t-h1">
                Сколько можно получить
              </h2>
              <p className={styles.calcLead}>
                Расчёт ориентировочный: точную сумму назовёт эксперт после проверки фото.
              </p>
            </div>
          }
        />
      </section>
      <Accepted />
      <Faq />
    </>
  );
}
