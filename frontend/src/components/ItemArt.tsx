/**
 * Плоские иллюстрации изделий из макета (design/layout/kit.mjs → photo()):
 * светлая подложка, золото пробы — только в металле.
 */

export type ItemKind = "ring" | "chain" | "watch" | "phone";

const W = 160;
const H = 100;
const CX = W / 2;
const CY = H / 2;

const C = {
  metal: "var(--color-gold-500)",
  metalLight: "var(--color-gold-300)",
  metalDark: "var(--color-gold-700)",
  line: "var(--color-graphite-400)",
};

function Ring() {
  return (
    <>
      <circle cx={CX} cy={CY + 6} r={24} fill="none" stroke={C.metal} strokeWidth={7} />
      <circle
        cx={CX}
        cy={CY + 6}
        r={24}
        fill="none"
        stroke={C.metalLight}
        strokeWidth={1.4}
        opacity={0.9}
      />
      <path
        d={`M${CX - 9} ${CY - 22}L${CX} ${CY - 31}L${CX + 9} ${CY - 22}L${CX} ${CY - 15}Z`}
        fill="#fff"
        stroke={C.line}
        strokeWidth={0.8}
      />
      <path d={`M${CX - 9} ${CY - 22}H${CX + 9}`} stroke={C.line} strokeWidth={0.6} />
    </>
  );
}

function Chain() {
  const links = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return { x: W * 0.12 + t * W * 0.76, y: CY - 6 + Math.sin(t * Math.PI) * 22 };
  });
  return (
    <>
      {links.map((p, i) => (
        <ellipse
          key={i}
          cx={p.x}
          cy={p.y}
          rx={6}
          ry={3.6}
          fill="none"
          stroke={C.line}
          strokeWidth={2.2}
        />
      ))}
      <path d={`M${CX - 7} ${CY + 18}H${CX + 7}L${CX} ${CY + 32}Z`} fill={C.line} />
    </>
  );
}

function Watch() {
  const ticks = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2);
  return (
    <>
      <rect x={CX - 11} y={4} width={22} height={H - 8} rx={4} fill="var(--color-graphite-500)" />
      <circle cx={CX} cy={CY} r={22} fill={C.metal} />
      <circle cx={CX} cy={CY} r={18} fill="#fff" stroke={C.metalDark} strokeWidth={0.8} />
      {ticks.map((a, i) => (
        <path
          key={i}
          d={`M${CX + Math.cos(a) * 15} ${CY + Math.sin(a) * 15}L${CX + Math.cos(a) * 17} ${CY + Math.sin(a) * 17}`}
          stroke="var(--color-graphite-700)"
          strokeWidth={0.8}
        />
      ))}
      <path
        d={`M${CX} ${CY}L${CX + 7} ${CY - 7}`}
        stroke="var(--color-graphite-900)"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <path
        d={`M${CX} ${CY}V${CY - 13}`}
        stroke="var(--color-graphite-900)"
        strokeWidth={0.9}
        strokeLinecap="round"
      />
    </>
  );
}

function Phone() {
  return (
    <>
      <rect
        x={CX - 20}
        y={CY - 36}
        width={40}
        height={72}
        rx={7}
        fill="var(--color-graphite-900)"
      />
      <rect
        x={CX - 17}
        y={CY - 32}
        width={34}
        height={64}
        rx={4}
        fill="var(--color-malachite-700)"
      />
      <rect
        x={CX - 5}
        y={CY - 30}
        width={10}
        height={2.5}
        rx={1.25}
        fill="var(--color-graphite-900)"
      />
    </>
  );
}

const ART = { ring: Ring, chain: Chain, watch: Watch, phone: Phone };

export function ItemArt({
  kind,
  className,
  square,
}: {
  kind: ItemKind;
  className?: string;
  /** Квадратный кадр (миниатюра) — обрезка по центру. */
  square?: boolean;
}) {
  const Art = ART[kind];
  return (
    <svg
      viewBox={square ? `${CX - H / 2} 0 ${H} ${H}` : `0 0 ${W} ${H}`}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ background: "var(--color-photo-bg)", borderRadius: "var(--radius-md)" }}
    >
      <Art />
    </svg>
  );
}
