"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Eye, ImageOff, Layers, MousePointerClick, RotateCcw } from "lucide-react";
import AdDetailModal from "@/components/AdDetailModal";
import { AdDestination } from "@/components/AdDestination";
import CampaignScopeSelect from "@/components/CampaignScopeSelect";
import { attentionPriority, hasMovement, hasRegistration, needsAttention } from "@/lib/campaignDiagnostics";
import { groupAdsByCreative, type CreativeGroup } from "@/lib/creativeGroups";
import { isAdvantagePlusAdset, readableAdsetName, readableCampaignName } from "@/lib/metaAdsLabels";
import type { AdRow, CampaignGroup, FunnelStageDef, MetaAdsFilters } from "@/types/metaAds";

interface CampaignAdsGalleryProps {
  hierarchy: CampaignGroup[];
  stageDefs: FunnelStageDef[];
  filters: Pick<MetaAdsFilters, "from" | "to">;
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

type GalleryFilter = "moving" | "attention" | "registrations" | "all";

const PAGE_SIZE = 20;

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function effectiveStatusLabel(status: string): string {
  if (status === "ACTIVE") return "Em veiculação";
  if (status === "CAMPAIGN_PAUSED") return "Campanha pausada";
  if (status === "ADSET_PAUSED") return "Conjunto pausado";
  if (status === "PAUSED") return "Anúncio pausado";
  if (status === "ARCHIVED") return "Arquivado";
  return status.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function StatusBadge({ ad }: { ad: AdRow }) {
  const status = ad.effectiveStatus ?? ad.status;
  const active = status === "ACTIVE";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        active
          ? "bg-[rgb(224_248_243)] text-[rgb(var(--teal-9))]"
          : "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]"
      }`}
    >
      {effectiveStatusLabel(status)}
    </span>
  );
}

function DiagnosticBadge({ ad }: { ad: AdRow }) {
  if (ad.leadsMeta > ad.cadastrosCrm) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(255_247_224)] px-2.5 py-1 text-[11px] font-semibold text-[rgb(139_94_0)]">
        <AlertTriangle className="h-3.5 w-3.5" />
        Meta marcou {formatNumber(ad.leadsMeta)}; CRM confirmou {formatNumber(ad.cadastrosCrm)}
      </span>
    );
  }

  if (ad.cadastrosCrm > ad.leadsCrm) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(224_248_243)] px-2.5 py-1 text-[11px] font-semibold text-[rgb(var(--teal-9))]">
        <RotateCcw className="h-3.5 w-3.5" />
        Cadastro recebido; contato já existia
      </span>
    );
  }

  if (ad.leadsCrm > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(224_248_243)] px-2.5 py-1 text-[11px] font-semibold text-[rgb(var(--teal-9))]">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {formatNumber(ad.leadsCrm)} contato{ad.leadsCrm === 1 ? " novo" : "s novos"} no CRM
      </span>
    );
  }

  if (ad.clicks > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--blue-3))] px-2.5 py-1 text-[11px] font-semibold text-[rgb(var(--blue-11))]">
        <MousePointerClick className="h-3.5 w-3.5" />
        Teve clique; ainda sem cadastro
      </span>
    );
  }

  if (ad.impressions > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--slate-3))] px-2.5 py-1 text-[11px] font-semibold text-[rgb(var(--slate-11))]">
        <Eye className="h-3.5 w-3.5" />
        Foi exibido; ainda sem clique
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-[rgb(var(--slate-3))] px-2.5 py-1 text-[11px] font-semibold text-[rgb(var(--slate-10))]">
      Sem veiculação no período
    </span>
  );
}

function AdCreative({ ad }: { ad: AdRow }) {
  const src = ad.imageUrl ?? ad.thumbnailUrl;
  if (!src) {
    return (
      <div className="flex aspect-[4/5] w-full items-center justify-center bg-[rgb(var(--slate-3))]">
        <ImageOff className="h-10 w-10 text-[rgb(var(--slate-8))]" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL dinâmica do CDN do Meta
    <img
      src={src}
      alt={`Criativo do anúncio ${ad.adName}`}
      loading="lazy"
      className="aspect-[4/5] w-full bg-[rgb(var(--slate-2))] object-contain"
    />
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-[rgb(var(--slate-2))] px-2.5 py-2" title={title}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{value}</p>
    </div>
  );
}

/**
 * Card de um CRIATIVO. Quando o mesmo criativo roda em mais de um conjunto,
 * mostramos a distribuição ("Roda em N conjuntos") em vez de uma dupla
 * campanha/conjunto que seria arbitrária — os números do card já são a soma
 * de todos os `ad_id`, que é o nível onde "Meta marcou" e "Cadastros" batem.
 */
function CreativeCard({ creative, onOpen }: { creative: CreativeGroup; onOpen: () => void }) {
  const ad = creative.card;
  const grouped = creative.adsetCount > 1 || creative.campaignCount > 1;
  const campaignLabel = readableCampaignName(ad.campaignName);
  const adsetLabel = readableAdsetName(ad.adsetName);

  return (
    <article className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.05)]">
      <div className="grid min-h-full grid-cols-1 sm:grid-cols-[minmax(150px,0.72fr)_minmax(0,1.28fr)]">
        <AdCreative ad={ad} />

        <div className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge ad={ad} />
            <DiagnosticBadge ad={ad} />
          </div>

          <div className="min-w-0">
            {grouped ? (
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[rgb(var(--slate-9))]">
                <Layers className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="uppercase tracking-wide">
                  Roda em {creative.adsetCount} conjunto{creative.adsetCount === 1 ? "" : "s"}
                  {creative.campaignCount > 1 ? ` · ${creative.campaignCount} campanhas` : ""}
                </span>
              </div>
            ) : (
              <dl className="space-y-1.5 text-[11px] text-[rgb(var(--slate-9))]">
                <div title={ad.campaignName}>
                  <dt className="font-semibold uppercase tracking-wide text-[rgb(var(--slate-8))]">Campanha</dt>
                  <dd className="break-words font-medium leading-snug text-[rgb(var(--slate-11))]">{campaignLabel}</dd>
                </div>
                <div title={ad.adsetName}>
                  <dt className="font-semibold uppercase tracking-wide text-[rgb(var(--slate-8))]">Conjunto</dt>
                  <dd className="break-words font-medium leading-snug text-[rgb(var(--slate-11))]">
                    {adsetLabel}
                    {isAdvantagePlusAdset(ad.adsetName) ? (
                      <span
                        title="Público Advantage+"
                        className="ml-1.5 inline-flex rounded-full bg-[rgb(var(--blue-3))] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wide text-[rgb(var(--blue-11))]"
                      >
                        ADV+
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>
            )}
            <h3 className="mt-1 break-words text-base font-semibold leading-snug text-[rgb(var(--slate-12))]">{ad.adName}</h3>
          </div>

          <AdDestination landingUrl={ad.landingUrl} compact />

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <Metric label="Investido" value={formatCurrency(ad.spend)} />
            <Metric label="Cliques" value={formatNumber(ad.clicks)} title="Todos os cliques reportados pela Meta." />
            <Metric
              label="CTR"
              value={formatPercent(ad.ctr)}
              title="Percentual das exibições que gerou algum clique no anúncio. Não é quantidade de leads."
            />
            <Metric
              label="Meta marcou"
              value={formatNumber(ad.leadsMeta)}
              title={
                grouped
                  ? "Eventos Lead atribuídos pela Meta, somados em todos os conjuntos deste criativo."
                  : "Eventos Lead atribuídos pela Meta."
              }
            />
            <Metric label="Cadastros" value={formatNumber(ad.cadastrosCrm)} title="Envios salvos pelo formulário, incluindo contatos que já existiam." />
            <Metric label="Contatos novos" value={formatNumber(ad.leadsCrm)} title="Pessoas novas criadas no CRM; não inclui cadastros repetidos." />
          </div>

          <button
            type="button"
            onClick={onOpen}
            className="mt-auto inline-flex min-h-10 items-center justify-center rounded-md border border-[rgb(var(--border-weak))] px-3 py-2 text-sm font-semibold text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))]"
          >
            Ver detalhes e cadastros
          </button>
        </div>
      </div>
    </article>
  );
}

export default function CampaignAdsGallery({
  hierarchy,
  stageDefs,
  filters,
  selectedCampaignId,
  selectedAdsetId,
  onCampaignChange,
  onAdsetChange,
}: CampaignAdsGalleryProps) {
  const [selectedCreative, setSelectedCreative] = useState<CreativeGroup | null>(null);
  const [filter, setFilter] = useState<GalleryFilter>("moving");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const allAds = useMemo(
    () => hierarchy.flatMap((campaign) => campaign.adsets.flatMap((adset) => adset.ads)),
    [hierarchy]
  );

  const selectedCampaign = selectedCampaignId
    ? (hierarchy.find((campaign) => campaign.campaignId === selectedCampaignId) ?? null)
    : null;
  const effectiveCampaignId = selectedCampaign?.campaignId ?? null;
  const selectedAdset = selectedCampaign && selectedAdsetId
    ? (selectedCampaign.adsets.find((adset) => adset.adsetId === selectedAdsetId) ?? null)
    : null;
  const effectiveAdsetId = selectedAdset?.adsetId ?? null;

  const scopedAds = useMemo(() => {
    if (!effectiveCampaignId) return allAds;
    const campaign = hierarchy.find((item) => item.campaignId === effectiveCampaignId);
    if (!campaign) return allAds;
    if (!effectiveAdsetId) return campaign.adsets.flatMap((adset) => adset.ads);
    return campaign.adsets.find((adset) => adset.adsetId === effectiveAdsetId)?.ads ?? [];
  }, [allAds, effectiveAdsetId, effectiveCampaignId, hierarchy]);

  // Um card por CRIATIVO (soma dos `ad_id` de mesmo nome). Só assim "Meta
  // marcou" e "Cadastros" ficam comparáveis: o mesmo criativo roda em vários
  // conjuntos, a Meta distribui o crédito dos Leads de um jeito e o CRM atribui
  // cada cadastro ao conjunto clicado — por conjunto não bate, no criativo sim.
  const scopedCreatives = useMemo(() => groupAdsByCreative(scopedAds), [scopedAds]);

  const counts = useMemo(
    () => ({
      moving: scopedCreatives.filter((creative) => hasMovement(creative.card)).length,
      attention: scopedCreatives.filter((creative) => needsAttention(creative.card)).length,
      registrations: scopedCreatives.filter((creative) => hasRegistration(creative.card)).length,
      all: scopedCreatives.length,
    }),
    [scopedCreatives]
  );

  const filteredCreatives = useMemo(() => {
    const selected = scopedCreatives.filter((creative) => {
      if (filter === "moving") return hasMovement(creative.card);
      if (filter === "attention") return needsAttention(creative.card);
      if (filter === "registrations") return hasRegistration(creative.card);
      return true;
    });

    return selected.sort((a, b) => {
      const priority = attentionPriority(a.card) - attentionPriority(b.card);
      if (priority !== 0) return priority;
      if (b.card.spend !== a.card.spend) return b.card.spend - a.card.spend;
      return a.card.adName.localeCompare(b.card.adName, "pt-BR");
    });
  }, [filter, scopedCreatives]);

  function handleCampaignChange(campaignId: string | null) {
    onCampaignChange(campaignId);
    onAdsetChange(null);
    setVisibleCount(PAGE_SIZE);
  }

  function handleAdsetChange(adsetId: string | null) {
    onAdsetChange(adsetId);
    setVisibleCount(PAGE_SIZE);
  }

  if (hierarchy.length === 0) {
    return (
      <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
        Nenhum anúncio encontrado para esse filtro. Se a sincronização acabou de rodar, aguarde alguns minutos.
      </div>
    );
  }

  const filterOptions: Array<{ key: GalleryFilter; label: string; count: number }> = [
    { key: "moving", label: "Com entrega", count: counts.moving },
    { key: "attention", label: "Precisam de atenção", count: counts.attention },
    { key: "registrations", label: "Com cadastro", count: counts.registrations },
    { key: "all", label: "Todos", count: counts.all },
  ];
  const visibleCreatives = filteredCreatives.slice(0, visibleCount);

  return (
    <section aria-labelledby="campaign-ads-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="campaign-ads-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
            Anúncios
          </h2>
          <p className="text-sm text-[rgb(var(--slate-10))]">
            Um card por criativo. Quando o mesmo criativo roda em vários conjuntos, os números são somados — é o nível em que
            &ldquo;Meta marcou&rdquo; e &ldquo;Cadastros&rdquo; se comparam.
          </p>
        </div>
        <p className="text-xs text-[rgb(var(--slate-9))]">
          Mostrando {formatNumber(Math.min(visibleCreatives.length, filteredCreatives.length))} de {formatNumber(filteredCreatives.length)}
        </p>
      </div>

      <CampaignScopeSelect
        hierarchy={hierarchy}
        selectedCampaignId={effectiveCampaignId}
        selectedAdsetId={effectiveAdsetId}
        onCampaignChange={handleCampaignChange}
        onAdsetChange={handleAdsetChange}
      />

      <div className="flex flex-wrap gap-2" aria-label="Filtrar anúncios exibidos">
        {filterOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={filter === option.key}
            onClick={() => {
              setFilter(option.key);
              setVisibleCount(PAGE_SIZE);
            }}
            className={`min-h-10 rounded-full border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))] ${
              filter === option.key
                ? "border-[rgb(var(--blue-9))] bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
                : "border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-10))] hover:bg-[rgb(var(--slate-2))]"
            }`}
          >
            {option.label} ({formatNumber(option.count)})
          </button>
        ))}
      </div>

      {visibleCreatives.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {visibleCreatives.map((creative) => (
            <CreativeCard key={creative.key} creative={creative} onOpen={() => setSelectedCreative(creative)} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-8 text-center text-sm text-[rgb(var(--slate-10))]">
          Nenhum anúncio se encaixa neste escopo e filtro no período selecionado.
        </div>
      )}

      {visibleCreatives.length < filteredCreatives.length ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
            className="min-h-11 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-5 py-2 text-sm font-semibold text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))]"
          >
            Mostrar mais anúncios
          </button>
        </div>
      ) : null}

      {selectedCreative ? (
        <AdDetailModal
          ad={selectedCreative.card}
          members={selectedCreative.members}
          filters={filters}
          stageDefs={stageDefs}
          onClose={() => setSelectedCreative(null)}
        />
      ) : null}
    </section>
  );
}
