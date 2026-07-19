import type { Funnel } from "@/types/funnel";

/**
 * Paleta de cores para etapas de funil — cada dashboard.funnel_stages.color
 * guarda um destes tokens; UI (Kanban, badges) resolve pra classes Tailwind
 * aqui. Mantido em módulo próprio pra ser usado tanto no client (CrmKanbanView,
 * CrmClient) quanto no server (lib/funnels.ts, na hora de atribuir cor a
 * etapa nova).
 */
export const STAGE_COLOR_TOKENS = [
  "slate",
  "cyan",
  "blue",
  "violet",
  "amber",
  "orange",
  "emerald",
  "rose",
] as const;

export type StageColorToken = (typeof STAGE_COLOR_TOKENS)[number];

export function stageColorTokenForIndex(index: number): StageColorToken {
  return STAGE_COLOR_TOKENS[index % STAGE_COLOR_TOKENS.length];
}

export function normalizeStageColorToken(value: unknown): StageColorToken {
  return typeof value === "string" && (STAGE_COLOR_TOKENS as readonly string[]).includes(value)
    ? (value as StageColorToken)
    : "slate";
}

export interface StageColorClasses {
  label: string;
  headerBg: string;
  headerText: string;
  badgeBg: string;
  badgeText: string;
  cardBorder: string;
  dotColor: string;
  pillBg: string;
  pillText: string;
}

export const STAGE_COLOR_CLASSES: Record<StageColorToken, Omit<StageColorClasses, "label">> = {
  slate: {
    headerBg: "bg-slate-600",
    headerText: "text-white",
    badgeBg: "bg-slate-500",
    badgeText: "text-white",
    cardBorder: "border-l-slate-400",
    dotColor: "bg-slate-400",
    pillBg: "bg-slate-100",
    pillText: "text-slate-700",
  },
  cyan: {
    headerBg: "bg-cyan-600",
    headerText: "text-white",
    badgeBg: "bg-cyan-500",
    badgeText: "text-white",
    cardBorder: "border-l-cyan-500",
    dotColor: "bg-cyan-500",
    pillBg: "bg-cyan-50",
    pillText: "text-cyan-700",
  },
  blue: {
    headerBg: "bg-blue-600",
    headerText: "text-white",
    badgeBg: "bg-blue-500",
    badgeText: "text-white",
    cardBorder: "border-l-blue-500",
    dotColor: "bg-blue-500",
    pillBg: "bg-blue-50",
    pillText: "text-blue-700",
  },
  violet: {
    headerBg: "bg-violet-600",
    headerText: "text-white",
    badgeBg: "bg-violet-500",
    badgeText: "text-white",
    cardBorder: "border-l-violet-500",
    dotColor: "bg-violet-500",
    pillBg: "bg-violet-50",
    pillText: "text-violet-700",
  },
  amber: {
    headerBg: "bg-amber-500",
    headerText: "text-white",
    badgeBg: "bg-amber-400",
    badgeText: "text-amber-900",
    cardBorder: "border-l-amber-400",
    dotColor: "bg-amber-400",
    pillBg: "bg-amber-50",
    pillText: "text-amber-700",
  },
  orange: {
    headerBg: "bg-orange-500",
    headerText: "text-white",
    badgeBg: "bg-orange-400",
    badgeText: "text-white",
    cardBorder: "border-l-orange-400",
    dotColor: "bg-orange-400",
    pillBg: "bg-orange-50",
    pillText: "text-orange-700",
  },
  emerald: {
    headerBg: "bg-emerald-600",
    headerText: "text-white",
    badgeBg: "bg-emerald-500",
    badgeText: "text-white",
    cardBorder: "border-l-emerald-500",
    dotColor: "bg-emerald-500",
    pillBg: "bg-emerald-50",
    pillText: "text-emerald-700",
  },
  rose: {
    headerBg: "bg-rose-600",
    headerText: "text-white",
    badgeBg: "bg-rose-500",
    badgeText: "text-white",
    cardBorder: "border-l-rose-400",
    dotColor: "bg-rose-400",
    pillBg: "bg-rose-50",
    pillText: "text-rose-700",
  },
};

export const FALLBACK_STAGE_BADGE = { label: "Etapa", className: "bg-neutral-100 text-neutral-600" };

/** Junta as etapas de todos os funis visiveis num lookup por chave, pra
 * exibir label/cor do badge de uma etapa sem depender de um union fixo. */
export function buildStageBadgeMap(funnels: readonly Funnel[]): Map<string, { label: string; className: string }> {
  const map = new Map<string, { label: string; className: string }>();
  for (const funnel of funnels) {
    for (const stage of funnel.stages) {
      if (map.has(stage.key)) continue;
      const colors = STAGE_COLOR_CLASSES[stage.color];
      map.set(stage.key, { label: stage.label, className: `${colors.pillBg} ${colors.pillText}` });
    }
  }
  return map;
}
