"use client";

import { X } from "lucide-react";
import { readableAdsetName, readableCampaignName } from "@/lib/metaAdsLabels";
import type { CampaignGroup } from "@/types/metaAds";

interface CampaignScopeSelectProps {
  hierarchy: CampaignGroup[];
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

/**
 * Seletor compacto (dois <select>) de campanha/conjunto — usado nas abas
 * Tabela e Anúncios pra reaproveitar o mesmo escopo escolhido na Visão
 * Geral sem repetir o grid grande de cards do CampaignSetNavigator, que
 * fica só lá.
 */
export default function CampaignScopeSelect({
  hierarchy,
  selectedCampaignId,
  selectedAdsetId,
  onCampaignChange,
  onAdsetChange,
}: CampaignScopeSelectProps) {
  const selectedCampaign = hierarchy.find((campaign) => campaign.campaignId === selectedCampaignId) ?? null;
  const hasScope = Boolean(selectedCampaignId || selectedAdsetId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="scope-campaign-select">
        Filtrar por campanha
      </label>
      <select
        id="scope-campaign-select"
        value={selectedCampaignId ?? ""}
        onChange={(event) => onCampaignChange(event.target.value || null)}
        className="min-h-9 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5 py-1.5 text-xs font-medium text-[rgb(var(--slate-12))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))]"
      >
        <option value="">Todas as campanhas</option>
        {hierarchy.map((campaign) => (
          <option key={campaign.campaignId} value={campaign.campaignId}>
            {readableCampaignName(campaign.campaignName)}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="scope-adset-select">
        Filtrar por conjunto
      </label>
      <select
        id="scope-adset-select"
        value={selectedAdsetId ?? ""}
        disabled={!selectedCampaign}
        onChange={(event) => onAdsetChange(event.target.value || null)}
        className="min-h-9 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5 py-1.5 text-xs font-medium text-[rgb(var(--slate-12))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">Todos os conjuntos</option>
        {selectedCampaign?.adsets.map((adset) => (
          <option key={adset.adsetId} value={adset.adsetId}>
            {readableAdsetName(adset.adsetName)}
          </option>
        ))}
      </select>

      {hasScope ? (
        <button
          type="button"
          onClick={() => {
            onCampaignChange(null);
            onAdsetChange(null);
          }}
          className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5 py-1.5 text-xs font-medium text-[rgb(var(--slate-10))] hover:bg-[rgb(var(--slate-2))]"
        >
          <X className="h-3.5 w-3.5" />
          Limpar filtro
        </button>
      ) : null}
    </div>
  );
}
