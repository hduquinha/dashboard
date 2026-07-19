import type { AggregatedMetrics, CampaignGroup } from "@/types/metaAds";
import { isAdvantagePlusAdset, readableAdsetName, readableCampaignName } from "@/lib/metaAdsLabels";

interface CampaignSetNavigatorProps {
  hierarchy: CampaignGroup[];
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

interface ScopeMetrics {
  spend: number;
  clicks: number;
  cadastrosCrm: number;
}

interface NavigationCardProps {
  name: string;
  fullName?: string;
  status?: string;
  context: string;
  metrics: ScopeMetrics;
  selected: boolean;
  advantagePlus?: boolean;
  onClick: () => void;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function plural(value: number, singular: string, pluralForm: string): string {
  return `${formatNumber(value)} ${value === 1 ? singular : pluralForm}`;
}

function statusLabel(status: string): string {
  if (status === "ACTIVE") return "Ativa";
  if (status === "PAUSED") return "Pausada";
  if (status === "ARCHIVED") return "Arquivada";
  return status.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function scopeMetrics(totals: AggregatedMetrics): ScopeMetrics {
  return {
    spend: totals.spend,
    clicks: totals.clicks,
    cadastrosCrm: totals.cadastrosCrm,
  };
}

function combinedMetrics(hierarchy: CampaignGroup[]): ScopeMetrics {
  return hierarchy.reduce<ScopeMetrics>(
    (totals, campaign) => ({
      spend: totals.spend + campaign.totals.spend,
      clicks: totals.clicks + campaign.totals.clicks,
      cadastrosCrm: totals.cadastrosCrm + campaign.totals.cadastrosCrm,
    }),
    { spend: 0, clicks: 0, cadastrosCrm: 0 }
  );
}

function NavigationCard({ name, fullName, status, context, metrics, selected, advantagePlus, onClick }: NavigationCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      title={fullName ?? name}
      className={`min-h-[148px] w-full rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))] focus-visible:ring-offset-2 ${
        selected
          ? "border-[rgb(var(--blue-8))] bg-[rgb(var(--blue-2))] shadow-[0_0_0_1px_rgb(var(--blue-7))]"
          : "border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] hover:border-[rgb(var(--slate-7))] hover:bg-[rgb(var(--slate-2))]"
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 break-words text-sm font-semibold leading-snug text-[rgb(var(--slate-12))]">{name}</span>
        {selected ? (
          <span className="flex-shrink-0 rounded-full bg-[rgb(var(--blue-9))] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Em foco
          </span>
        ) : null}
      </span>
      {fullName && fullName !== name ? (
        <span className="mt-1 line-clamp-2 break-words text-[10px] leading-snug text-[rgb(var(--slate-8))]">{fullName}</span>
      ) : null}
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[rgb(var(--slate-9))]">
        {status ? (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${status === "ACTIVE" ? "bg-[rgb(var(--teal-9))]" : "bg-[rgb(var(--slate-8))]"}`}
            />
            {statusLabel(status)}
          </span>
        ) : null}
        {advantagePlus ? (
          <span
            title="Público Advantage+"
            className="rounded-full bg-[rgb(var(--blue-3))] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[rgb(var(--blue-11))]"
          >
            ADV+
          </span>
        ) : null}
        <span>{context}</span>
      </span>
      <span className="mt-3 grid grid-cols-3 gap-1.5 border-t border-[rgb(var(--border-weak))] pt-2.5">
        <span className="min-w-0">
          <span className="block text-[9px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">Investido</span>
          <span className="block break-words text-xs font-semibold text-[rgb(var(--slate-12))]">{formatCurrency(metrics.spend)}</span>
        </span>
        <span className="min-w-0">
          <span className="block text-[9px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">Cliques</span>
          <span className="block text-xs font-semibold text-[rgb(var(--slate-12))]">{formatNumber(metrics.clicks)}</span>
        </span>
        <span className="min-w-0">
          <span className="block text-[9px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">Cadastros</span>
          <span className="block text-xs font-semibold text-[rgb(var(--slate-12))]">{formatNumber(metrics.cadastrosCrm)}</span>
        </span>
      </span>
    </button>
  );
}

export default function CampaignSetNavigator({
  hierarchy,
  selectedCampaignId,
  selectedAdsetId,
  onCampaignChange,
  onAdsetChange,
}: CampaignSetNavigatorProps) {
  const selectedCampaign = hierarchy.find((campaign) => campaign.campaignId === selectedCampaignId) ?? null;
  const selectedAdset = selectedCampaign?.adsets.find((adset) => adset.adsetId === selectedAdsetId) ?? null;
  const campaignCount = hierarchy.length;
  const adsetCount = hierarchy.reduce((total, campaign) => total + campaign.adsets.length, 0);
  const adCount = hierarchy.reduce(
    (total, campaign) => total + campaign.adsets.reduce((campaignTotal, adset) => campaignTotal + adset.ads.length, 0),
    0
  );
  const totalMetrics = combinedMetrics(hierarchy);
  const selectedCampaignLabel = selectedCampaign ? readableCampaignName(selectedCampaign.campaignName) : "Todas as campanhas";
  const selectedAdsetLabel = selectedAdset ? readableAdsetName(selectedAdset.adsetName) : "Todos os conjuntos";
  const selectedScopeAdCount = selectedAdset
    ? selectedAdset.ads.length
    : selectedCampaign
      ? selectedCampaign.adsets.reduce((total, adset) => total + adset.ads.length, 0)
      : adCount;
  const selectedScopeMetrics = selectedAdset
    ? scopeMetrics(selectedAdset.totals)
    : selectedCampaign
      ? scopeMetrics(selectedCampaign.totals)
      : totalMetrics;

  return (
    <nav
      aria-label="Escolher campanha e conjunto de anúncios"
      className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] p-3 sm:p-4"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Escolha o que deseja analisar</h3>
          <p className="text-xs leading-relaxed text-[rgb(var(--slate-9))]">
            Totais do período, status e busca aplicados acima. O filtro de entrega abaixo afeta apenas os anúncios exibidos.
          </p>
        </div>
        <span className="rounded-full bg-[rgb(var(--surface-1))] px-2.5 py-1 text-[11px] font-medium text-[rgb(var(--slate-10))]">
          {plural(campaignCount, "campanha", "campanhas")} · {plural(adsetCount, "conjunto", "conjuntos")}
        </span>
      </div>

      <div className="grid gap-3 sm:hidden">
        <label className="grid gap-1.5 text-xs font-semibold text-[rgb(var(--slate-11))]">
          <span>1. Campanha</span>
          <select
            value={selectedCampaign?.campaignId ?? ""}
            title={selectedCampaign?.campaignName ?? "Todas as campanhas"}
            onChange={(event) => onCampaignChange(event.target.value || null)}
            className="min-h-11 w-full rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 py-2 text-sm font-medium text-[rgb(var(--slate-12))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))]"
          >
            <option value="">Todas as campanhas</option>
            {hierarchy.map((campaign) => (
              <option key={campaign.campaignId} value={campaign.campaignId} title={campaign.campaignName}>
                {readableCampaignName(campaign.campaignName)}
              </option>
            ))}
          </select>
          {selectedCampaign ? (
            <span className="break-words font-normal text-[10px] leading-snug text-[rgb(var(--slate-8))]" title={selectedCampaign.campaignName}>
              Nome técnico: {selectedCampaign.campaignName}
            </span>
          ) : null}
        </label>

        <label className="grid gap-1.5 text-xs font-semibold text-[rgb(var(--slate-11))]">
          <span>2. Conjunto</span>
          <select
            value={selectedAdset?.adsetId ?? ""}
            title={selectedAdset?.adsetName ?? "Todos os conjuntos"}
            disabled={!selectedCampaign}
            aria-describedby={!selectedCampaign ? "adset-selection-help" : undefined}
            onChange={(event) => onAdsetChange(event.target.value || null)}
            className="min-h-11 w-full rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 py-2 text-sm font-medium text-[rgb(var(--slate-12))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">Todos os conjuntos</option>
            {selectedCampaign?.adsets.map((adset) => (
              <option key={adset.adsetId} value={adset.adsetId} title={adset.adsetName}>
                {readableAdsetName(adset.adsetName)}
              </option>
            ))}
          </select>
          {selectedAdset ? (
            <span className="break-words font-normal text-[10px] leading-snug text-[rgb(var(--slate-8))]" title={selectedAdset.adsetName}>
              Nome técnico: {selectedAdset.adsetName}
              {isAdvantagePlusAdset(selectedAdset.adsetName) ? " · Público Advantage+" : ""}
            </span>
          ) : null}
          {!selectedCampaign ? (
            <span id="adset-selection-help" className="font-normal text-[11px] text-[rgb(var(--slate-9))]">
              Selecione uma campanha para escolher um conjunto específico.
            </span>
          ) : null}
        </label>
      </div>

      <div className="hidden space-y-5 sm:block">
        <section aria-labelledby="campaign-navigation-heading">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgb(var(--blue-9))] text-[10px] font-bold text-white">1</span>
            <h4 id="campaign-navigation-heading" className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">
              Campanha
            </h4>
          </div>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            <NavigationCard
              name="Todas as campanhas"
              context={`${plural(campaignCount, "campanha", "campanhas")} · ${plural(adCount, "anúncio", "anúncios")}`}
              metrics={totalMetrics}
              selected={!selectedCampaign}
              onClick={() => onCampaignChange(null)}
            />
            {hierarchy.map((campaign) => {
              const campaignAdCount = campaign.adsets.reduce((total, adset) => total + adset.ads.length, 0);
              return (
                <NavigationCard
                  key={campaign.campaignId}
                  name={readableCampaignName(campaign.campaignName)}
                  fullName={campaign.campaignName}
                  status={campaign.status}
                  context={`${plural(campaign.adsets.length, "conjunto", "conjuntos")} · ${plural(campaignAdCount, "anúncio", "anúncios")}`}
                  metrics={scopeMetrics(campaign.totals)}
                  selected={selectedCampaign?.campaignId === campaign.campaignId}
                  onClick={() => onCampaignChange(campaign.campaignId)}
                />
              );
            })}
          </div>
        </section>

        <section aria-labelledby="adset-navigation-heading">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgb(var(--blue-9))] text-[10px] font-bold text-white">2</span>
            <h4 id="adset-navigation-heading" className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">
              Conjunto
            </h4>
          </div>
          {selectedCampaign ? (
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
              <NavigationCard
                name="Todos os conjuntos"
                context={plural(
                  selectedCampaign.adsets.reduce((total, adset) => total + adset.ads.length, 0),
                  "anúncio",
                  "anúncios"
                )}
                metrics={scopeMetrics(selectedCampaign.totals)}
                selected={!selectedAdset}
                onClick={() => onAdsetChange(null)}
              />
              {selectedCampaign.adsets.map((adset) => (
                <NavigationCard
                  key={adset.adsetId}
                  name={readableAdsetName(adset.adsetName)}
                  fullName={adset.adsetName}
                  status={adset.status}
                  context={plural(adset.ads.length, "anúncio", "anúncios")}
                  metrics={scopeMetrics(adset.totals)}
                  selected={selectedAdset?.adsetId === adset.adsetId}
                  advantagePlus={isAdvantagePlusAdset(adset.adsetName)}
                  onClick={() => onAdsetChange(adset.adsetId)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4">
              <p className="text-sm font-semibold text-[rgb(var(--slate-11))]">Todos os conjuntos</p>
              <p className="mt-0.5 text-xs text-[rgb(var(--slate-9))]">
                Os anúncios de todos os conjuntos estão incluídos. Escolha uma campanha acima para comparar seus conjuntos.
              </p>
            </div>
          )}
        </section>
      </div>

      <div
        aria-live="polite"
        className="mt-4 rounded-lg border border-[rgb(var(--blue-5))] bg-[rgb(var(--surface-1))] px-3 py-2.5"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--blue-10))]">Escopo dos anúncios</p>
        <p className="mt-1 break-words text-sm leading-snug text-[rgb(var(--slate-12))]">
          <span className="font-semibold">Campanha:</span> {selectedCampaignLabel}
        </p>
        {selectedCampaign && selectedCampaignLabel !== selectedCampaign.campaignName ? (
          <p className="mt-0.5 break-words text-[10px] leading-snug text-[rgb(var(--slate-8))]">{selectedCampaign.campaignName}</p>
        ) : null}
        <p className="mt-0.5 break-words text-sm leading-snug text-[rgb(var(--slate-12))]">
          <span className="font-semibold">Conjunto:</span> {selectedAdsetLabel}
          {selectedAdset && isAdvantagePlusAdset(selectedAdset.adsetName) ? (
            <span
              title="Público Advantage+"
              className="ml-2 inline-flex rounded-full bg-[rgb(var(--blue-3))] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wide text-[rgb(var(--blue-11))]"
            >
              ADV+
            </span>
          ) : null}
        </p>
        {selectedAdset && selectedAdsetLabel !== selectedAdset.adsetName ? (
          <p className="mt-0.5 break-words text-[10px] leading-snug text-[rgb(var(--slate-8))]">{selectedAdset.adsetName}</p>
        ) : null}
        <p className="mt-1 text-[11px] text-[rgb(var(--slate-9))]">
          {plural(selectedScopeAdCount, "anúncio", "anúncios")} neste escopo antes do filtro de entrega.
        </p>
        <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-[rgb(var(--border-weak))] pt-2">
          <div>
            <dt className="text-[9px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">Investido</dt>
            <dd className="break-words text-xs font-semibold text-[rgb(var(--slate-12))]">{formatCurrency(selectedScopeMetrics.spend)}</dd>
          </div>
          <div>
            <dt className="text-[9px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">Cliques</dt>
            <dd className="text-xs font-semibold text-[rgb(var(--slate-12))]">{formatNumber(selectedScopeMetrics.clicks)}</dd>
          </div>
          <div>
            <dt className="text-[9px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">Cadastros</dt>
            <dd className="text-xs font-semibold text-[rgb(var(--slate-12))]">{formatNumber(selectedScopeMetrics.cadastrosCrm)}</dd>
          </div>
        </dl>
      </div>
    </nav>
  );
}
