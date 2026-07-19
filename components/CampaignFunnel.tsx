"use client";

import type { FunnelStagePoint } from "@/types/metaAds";

interface CampaignFunnelProps {
  stages: FunnelStagePoint[];
  loading?: boolean;
}

const KIND_BAR_COLOR: Record<string, string> = {
  entry: "bg-[rgb(var(--slate-9))]",
  normal: "bg-[rgb(var(--blue-9))]",
  won: "bg-[rgb(var(--teal-9))]",
  lost: "bg-[rgb(var(--ruby-9))]",
};

export default function CampaignFunnel({ stages, loading }: CampaignFunnelProps) {
  if (loading) {
    return <div className="h-48 animate-pulse rounded-lg bg-[rgb(var(--slate-3))]" />;
  }

  if (stages.length === 0 || stages.every((s) => s.count === 0)) {
    return (
      <p className="py-6 text-center text-sm text-[rgb(var(--slate-10))]">
        Nenhum lead da pipeline comercial nesse período/escopo ainda.
      </p>
    );
  }

  const maxCount = Math.max(...stages.map((s) => s.count), 1);
  const entryCount = stages.find((s) => s.kind === "entry")?.count ?? maxCount;

  // Pré-calcula os percentuais de conversão (etapa vs. etapa sequencial
  // anterior) num loop simples antes do render, em vez de mutar uma
  // variável dentro do .map() de JSX.
  const rows: Array<{ stage: FunnelStagePoint; conversionPct: number | null; ofEntryPct: number }> = [];
  let previousSequentialCount: number | null = null;
  for (const stage of stages) {
    const isSequential = stage.kind === "entry" || stage.kind === "normal";
    const conversionPct =
      isSequential && previousSequentialCount !== null && previousSequentialCount > 0
        ? Math.round((stage.count / previousSequentialCount) * 100)
        : null;
    if (isSequential) previousSequentialCount = stage.count;
    const ofEntryPct = entryCount > 0 ? Math.round((stage.count / entryCount) * 100) : 0;
    rows.push({ stage, conversionPct, ofEntryPct });
  }

  return (
    <div className="space-y-2.5">
      {rows.map(({ stage, conversionPct, ofEntryPct }) => {
        const isSequential = stage.kind === "entry" || stage.kind === "normal";
        const widthPct = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;

        return (
          <div key={stage.key} className="flex items-center gap-3">
            <span className="w-28 flex-shrink-0 truncate text-xs font-medium text-[rgb(var(--slate-11))]" title={stage.label}>
              {stage.label}
            </span>
            <div className="h-6 flex-1 overflow-hidden rounded bg-[rgb(var(--slate-3))]">
              <div
                className={`h-full rounded ${KIND_BAR_COLOR[stage.kind] ?? "bg-[rgb(var(--slate-9))]"} transition-all`}
                style={{ width: `${stage.count > 0 ? Math.max(widthPct, 2) : 0}%` }}
              />
            </div>
            <span className="w-10 flex-shrink-0 text-right text-sm font-semibold text-[rgb(var(--slate-12))]">
              {stage.count}
            </span>
            <span className="w-14 flex-shrink-0 text-right text-xs text-[rgb(var(--slate-9))]">
              {conversionPct !== null ? `${conversionPct}%` : isSequential ? `${ofEntryPct}%` : ""}
            </span>
          </div>
        );
      })}
      <p className="pt-1 text-[11px] text-[rgb(var(--slate-9))]">
        % ao lado de cada etapa normal = conversão vs. etapa anterior. Ganho/Perdido mostram % do total de entrada.
      </p>
    </div>
  );
}
