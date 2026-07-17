// Procedural, duotone craft "specimen" shown on every pack card — a precise
// illustration of what the pack DOES to your image, keyed to its capability.
// Replaces the old random gradient with something legible and honest, and seeded
// per pack id so two cards of the same craft never look copy-pasted.
import type { PackCapability } from "../../../types";
import { CRAFT_HEX } from "./packsShared";

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function hexPath(cx: number, cy: number, r: number, rot: number): string {
  const p: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * Math.PI) / 3;
    p.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return "M" + p.join(" L") + " Z";
}

export default function Specimen({
  capability,
  id,
  isRtl,
}: {
  capability: PackCapability;
  id: string;
  isRtl: boolean;
}) {
  const C = CRAFT_HEX[capability] ?? "#8fa0c4";
  const r = rng(seedOf(id || capability));
  const uid = id.replace(/[^a-z0-9]/gi, "") || "x";
  // Matches the validated prototype: the art fills the card's aspect-ratio box
  // as an absolutely-positioned layer (not an inline-flow svg).
  const box = { viewBox: "0 0 200 150", fill: "none", className: "absolute inset-0 h-full w-full" } as const;

  if (capability === "photoreal") {
    const rot = r() * (Math.PI / 3);
    const gap = 8 + Math.round(r() * 5);
    const hi = r() * Math.PI * 2;
    const hx = 100 + 13 * Math.cos(hi);
    const hy = 75 + 13 * Math.sin(hi);
    return (
      <svg {...box}>
        <defs>
          <radialGradient id={`pg-${uid}`} cx="50%" cy="46%" r="58%">
            <stop offset="0" stopColor={C} stopOpacity=".20" />
            <stop offset="1" stopColor={C} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="200" height="150" fill={`url(#pg-${uid})`} />
        <g stroke={C} strokeWidth="2" strokeLinecap="round" opacity=".85">
          <path d={`M42 34 h-${gap} M32 34 v${gap}`} />
          <path d={`M158 34 h${gap} M168 34 v${gap}`} />
          <path d={`M42 116 h-${gap} M32 116 v-${gap}`} />
          <path d={`M158 116 h${gap} M168 116 v-${gap}`} />
        </g>
        <circle cx="100" cy="75" r="30" stroke={C} strokeWidth="2" opacity=".8" />
        <path d={hexPath(100, 75, 21, rot)} stroke={C} strokeWidth="1.6" fill={C} fillOpacity=".12" opacity=".8" />
        <path d={hexPath(100, 75, 11, rot)} stroke={C} strokeWidth="1.2" opacity=".55" />
        <circle cx={hx.toFixed(1)} cy={hy.toFixed(1)} r="3.4" fill={C} />
      </svg>
    );
  }

  if (capability === "text-in-image") {
    const glyph = isRtl ? "أ ب" : "Aa";
    const fs = isRtl ? 40 : 46;
    const dy = r() * 6 - 3;
    return (
      <svg {...box}>
        <rect x="34" y={40 + dy} width="132" height="70" rx="4" stroke={C} strokeWidth="1.5" strokeDasharray="5 5" opacity=".5" />
        <text
          x="100"
          y={92 + dy}
          fontFamily={isRtl ? "Tajawal, sans-serif" : "'Bricolage Grotesque', sans-serif"}
          fontWeight="800"
          fontSize={fs}
          fill={C}
          textAnchor="middle"
        >
          {glyph}
        </text>
        <line x1="46" y1={100 + dy} x2="154" y2={100 + dy} stroke={C} strokeWidth="1.2" opacity=".4" />
        <rect x="160" y={104 + dy} width="9" height="9" fill={C} opacity=".9" />
      </svg>
    );
  }

  if (capability === "edit-from-reference") {
    return (
      <svg {...box} style={isRtl ? { transform: "scaleX(-1)" } : undefined}>
        <defs>
          <clipPath id={`cl-${uid}`}>
            <rect x="34" y="30" width="132" height="90" rx="7" />
          </clipPath>
        </defs>
        <g clipPath={`url(#cl-${uid})`}>
          <rect x="34" y="30" width="132" height="90" fill="#222b3d" />
          <path d="M100 30 L166 30 L166 120 L100 120 Z" fill={C} fillOpacity=".16" />
          <g stroke="#5b6a86" strokeWidth="1.5" fill="none" opacity=".9">
            <circle cx="64" cy="56" r="7" />
            <path d="M42 108 l16 -20 l12 12 l10 -12 l16 20" />
          </g>
          <g stroke={C} strokeWidth="1.6" fill="none" opacity=".95">
            <circle cx="136" cy="56" r="7" />
            <path d="M112 108 l16 -20 l12 12 l10 -12 l16 20" />
          </g>
        </g>
        <rect x="34" y="30" width="132" height="90" rx="7" stroke={C} strokeWidth="1.5" opacity=".55" />
        <line x1="100" y1="30" x2="100" y2="120" stroke={C} strokeWidth="1.4" strokeDasharray="3 3" opacity=".7" />
        <circle cx="100" cy="75" r="10" fill="#0d1320" stroke={C} strokeWidth="1.6" />
        <path d="M96 71 l-4 4 l4 4 M104 71 l4 4 l-4 4" stroke={C} strokeWidth="1.5" fill="none" />
      </svg>
    );
  }

  if (capability === "vector-graphic") {
    const y1 = 95 + Math.round(r() * 15);
    const c1x = 64 + Math.round(r() * 16);
    const c1y = 40 + Math.round(r() * 20);
    const c2x = 120 + Math.round(r() * 16);
    const c2y = 95 + Math.round(r() * 20);
    const y2 = 55 + Math.round(r() * 15);
    return (
      <svg {...box}>
        <g opacity=".16" stroke={C}>
          <path d="M40 30v90M80 30v90M120 30v90M160 30v90M30 45h140M30 75h140M30 105h140" />
        </g>
        <line x1="50" y1={y1} x2={c1x} y2={c1y} stroke={C} strokeWidth="1" opacity=".5" />
        <line x1="150" y1={y2} x2={c2x} y2={c2y} stroke={C} strokeWidth="1" opacity=".5" />
        <path d={`M50 ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, 150 ${y2}`} stroke={C} strokeWidth="2.4" fill="none" />
        <circle cx={c1x} cy={c1y} r="4.2" fill="none" stroke={C} strokeWidth="1.4" />
        <circle cx={c2x} cy={c2y} r="4.2" fill="none" stroke={C} strokeWidth="1.4" />
        <rect x="45" y={y1 - 5} width="10" height="10" fill={C} />
        <rect x="145" y={y2 - 5} width="10" height="10" fill={C} />
      </svg>
    );
  }

  // calligraphy
  const amp = r() * 10 - 5;
  const ph = r() * 14 - 7;
  return (
    <svg {...box} style={isRtl ? { transform: "scaleX(-1)" } : undefined}>
      <line x1="34" y1="104" x2="166" y2="104" stroke={C} strokeWidth="1" opacity=".3" />
      <path
        d={`M50 98 C 62 ${44 + amp}, 92 ${44 - amp}, 96 82 C 99 ${106 + ph}, 120 ${106 + ph}, 128 76 C 133 ${54 + amp}, 150 52, 158 68`}
        stroke={C}
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
        opacity=".9"
      />
      <g transform="translate(50 98) rotate(-38)">
        <rect x="-3" y="-8" width="6" height="16" rx="1.5" fill={C} />
      </g>
    </svg>
  );
}
