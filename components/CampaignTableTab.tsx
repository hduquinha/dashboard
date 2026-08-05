"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Megaphone, Layers } from "lucide-react";
import AdDetailModal from "@/components/AdDetailModal";
import CreativeLightbox from "@/components/CreativeLightbox";
import CreativeThumb from "@/components/CreativeThumb";
import { costPer } from "@/lib/adDestinationGroups";
import { formatCurrency, formatNullableCurrency, formatNumber } from "@/lib/campaignFormat";
import { isAdvantagePlusAdset, readableAdsetName, readableCampaignName } from "@/lib/metaAdsLabels";
import type { AdRow, AdsetGroup, AggregatedMetrics, CampaignGroup, FunnelStageDef, MetaAdsFilters } from "@/types/metaAds";

interface CampaignTableTabProps {
  hierarchy: CampaignGroup[];
  /** Período da tela: o modal lista os cadastros dessa mesma janela. */
  filters: Pick<MetaAdsFilters, "from" | "to">;
  stageDefs: FunnelStageDef[];
}

type SortKey = "spend" | "cadastrosCrm" | "novos" | "custoPorLead";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "spend", label: "Investimento" },
  { key: "cadastrosCrm", label: "Cadastros" },
  { key: "novos", label: "Pessoas novas" },
  { key: "custoPorLead", label: "Lead mais barato" },
];

type SortableTotals = Pick<AggregatedMetrics, "spend" | "cadastrosCrm" | "novos">;

/** Ordenação: as contagens vão do maior pro menor, mas custo por lead é o
 * contrário — o melhor é o mais baixo. Quem não tem cadastro (custo
 * incalculável) cai pro fim da lista, ordenado por gasto, para "lead mais
 * barato" não premiar quem não trouxe lead nenhum. */
function compareBySort(a: SortableTotals, b: SortableTotals, sortKey: SortKey): number {
  if (sortKey !== "custoPorLead") return b[sortKey] - a[sortKey];

  const costA = costPer(a.spend, a.cadastrosCrm);
  const costB = costPer(b.spend, b.cadastrosCrm);
  if (costA === null && costB === null) return b.spend - a.spend;
  if (costA === null) return 1;
  if (costB === null) return -1;
  return costA - costB;
}

function statusLabel(status: string): string {
  if (status === "ACTIVE") return "Ativa";
  if (status === "PAUSED") return "Pausada";
  if (status === "ADSET_PAUSED") return "Conjunto pausado";
  if (status === "CAMPAIGN_PAUSED") return "Campanha pausada";
  if (status === "ARCHIVED") return "Arquivada";
  return status.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function StatusDot({ status }: { status: string }) {
  const active = status === "ACTIVE";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        active ? "bg-[rgb(224_248_243)] text-[rgb(var(--teal-9))]" : "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-10))]"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[rgb(var(--teal-9))]" : "bg-[rgb(var(--slate-8))]"}`} />
      {statusLabel(status)}
    </span>
  );
}

/** Faixa de números que acompanha cada linha, alinhada em colunas fixas para
 * que campanha, conjunto e anúncio fiquem lendo na mesma vertical. */
function MetricStrip({
  spend,
  leadsMeta,
  envios,
  cadastros,
  novos,
}: {
  spend: number;
  leadsMeta: number;
  envios: number;
  cadastros: number;
  novos: number;
}) {
  // O alerta compara ENVIO com ENVIO. Enquanto ele comparava o número da Meta
  // com "Cadastros" (pessoas), acendia em todo anúncio que teve uma repetição —
  // ruído, não sinal. Agora só acende quando a Meta contou mais preenchimento
  // do que chegou aqui, que é perda de atribuição de verdade.
  const gap = leadsMeta > envios;
  const cell = "flex flex-col items-end";
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-right sm:grid-cols-7">
      <div className={cell}>
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Investido</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatCurrency(spend)}</span>
      </div>
      <div className={`${cell} hidden sm:flex`} title="Eventos de Lead atribuídos pela Meta. Ela conta ENVIO de formulário, não pessoa.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Meta marcou</span>
        <span
          className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${
            gap ? "text-[rgb(139_94_0)]" : "text-[rgb(var(--slate-12))]"
          }`}
        >
          {gap ? <AlertTriangle className="h-3 w-3" /> : null}
          {formatNumber(leadsMeta)}
        </span>
      </div>
      <div
        className={`${cell} hidden sm:flex`}
        title="Todo preenchimento atribuído a este anúncio, inclusive repetido e descartado. Fala a mesma língua da Meta — é por aqui que se compara com o gerenciador."
      >
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Envios</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(envios)}</span>
      </div>
      <div className={cell} title="Pessoas que este anúncio trouxe: as novas mais as que já eram da base e voltaram.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Cadastros</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(cadastros)}</span>
      </div>
      <div className={`${cell} hidden sm:flex`} title="Pessoas inéditas no CRM — nunca tinham passado pela base.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Novos</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--teal-9))]">{formatNumber(novos)}</span>
      </div>
      <div className={cell} title="Investimento ÷ cadastros — o custo médio por pessoa trazida.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Custo/lead</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--blue-11))]">
          {formatNullableCurrency(costPer(spend, cadastros))}
        </span>
      </div>
      <div className={`${cell} hidden sm:flex`} title="Investimento ÷ pessoas novas.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Custo/novo</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
          {formatNullableCurrency(costPer(spend, novos))}
        </span>
      </div>
    </div>
  );
}

function AdRowLine({
  ad,
  onOpenCreative,
  onOpenDetail,
}: {
  ad: AdRow;
  onOpenCreative: (ad: AdRow) => void;
  onOpenDetail: (ad: AdRow) => void;
}) {
  return (
    <div className="flex flex-col gap-2 py-2.5 pl-14 pr-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <CreativeThumb creative={ad} onOpen={() => onOpenCreative(ad)} />
        <div className="min-w-0">
          {/* Ver a peça e ver QUEM ela trouxe são perguntas diferentes: a
              miniatura abre o criativo, o nome abre os cadastros. */}
          <button
            type="button"
            onClick={() => onOpenDetail(ad)}
            title={`${ad.adName} — ver os cadastros deste anúncio`}
            className="block max-w-full truncate text-left text-sm font-medium text-[rgb(var(--slate-12))] underline decoration-transparent underline-offset-2 transition hover:decoration-[rgb(var(--blue-9))] hover:text-[rgb(var(--blue-11))]"
          >
            {ad.adName}
          </button>
          <StatusDot status={ad.effectiveStatus ?? ad.status} />
        </div>
      </div>
      <MetricStrip
        spend={ad.spend}
        leadsMeta={ad.leadsMeta}
        envios={ad.envios}
        cadastros={ad.cadastrosCrm}
        novos={ad.novos}
      />
    </div>
  );
}

function AdsetRow({
  adset,
  sortKey,
  onOpenCreative,
  onOpenDetail,
}: {
  adset: AdsetGroup;
  sortKey: SortKey;
  onOpenCreative: (ad: AdRow) => void;
  onOpenDetail: (ad: AdRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const ads = useMemo(
    () => [...adset.ads].sort((a, b) => compareBySort(a, b, sortKey)),
    [adset.ads, sortKey]
  );
  return (
    <div className="border-t border-[rgb(var(--border-weak))] first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-2.5 pl-8 pr-3 text-left transition hover:bg-[rgb(var(--slate-2))]"
        aria-expanded={open}
      >
        <ChevronRight className={`h-4 w-4 flex-shrink-0 text-[rgb(var(--slate-9))] transition-transform ${open ? "rotate-90" : ""}`} />
        <Layers className="h-4 w-4 flex-shrink-0 text-[rgb(var(--slate-9))]" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-[rgb(var(--slate-12))]" title={adset.adsetName}>
              {readableAdsetName(adset.adsetName)}
            </span>
            {isAdvantagePlusAdset(adset.adsetName) ? (
              <span className="inline-flex flex-shrink-0 rounded-full bg-[rgb(var(--blue-3))] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[rgb(var(--blue-11))]">
                ADV+
              </span>
            ) : null}
            <span className="flex-shrink-0 text-[11px] text-[rgb(var(--slate-9))]">
              {adset.ads.length} anúncio{adset.ads.length === 1 ? "" : "s"}
            </span>
          </div>
          <MetricStrip
            spend={adset.totals.spend}
            leadsMeta={adset.totals.leadsMeta}
            envios={adset.totals.envios}
            cadastros={adset.totals.cadastrosCrm}
            novos={adset.totals.novos}
          />
        </div>
      </button>
      {open ? (
        <div className="bg-[rgb(var(--slate-1))]">
          {ads.map((ad) => (
            <AdRowLine key={ad.adId} ad={ad} onOpenCreative={onOpenCreative} onOpenDetail={onOpenDetail} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CampaignRow({
  campaign,
  sortKey,
  onOpenCreative,
  onOpenDetail,
}: {
  campaign: CampaignGroup;
  sortKey: SortKey;
  onOpenCreative: (ad: AdRow) => void;
  onOpenDetail: (ad: AdRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const adsets = useMemo(
    () => [...campaign.adsets].sort((a, b) => compareBySort(a.totals, b.totals, sortKey)),
    [campaign.adsets, sortKey]
  );
  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-3 text-left transition hover:bg-[rgb(var(--slate-2))]"
        aria-expanded={open}
      >
        <ChevronRight className={`h-5 w-5 flex-shrink-0 text-[rgb(var(--slate-10))] transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--blue-3))]">
          <Megaphone className="h-4 w-4 text-[rgb(var(--blue-11))]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]" title={campaign.campaignName}>
              {readableCampaignName(campaign.campaignName)}
            </span>
            <StatusDot status={campaign.status} />
            <span className="flex-shrink-0 text-[11px] text-[rgb(var(--slate-9))]">
              {campaign.adsets.length} conjunto{campaign.adsets.length === 1 ? "" : "s"}
            </span>
          </div>
          <MetricStrip
            spend={campaign.totals.spend}
            leadsMeta={campaign.totals.leadsMeta}
            envios={campaign.totals.envios}
            cadastros={campaign.totals.cadastrosCrm}
            novos={campaign.totals.novos}
          />
        </div>
      </button>
      {open ? (
        <div className="border-t border-[rgb(var(--border-weak))]">
          {adsets.map((adset) => (
            <AdsetRow
              key={adset.adsetId}
              adset={adset}
              sortKey={sortKey}
              onOpenCreative={onOpenCreative}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function CampaignTableTab({ hierarchy, filters, stageDefs }: CampaignTableTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [lightboxAd, setLightboxAd] = useState<AdRow | null>(null);
  const [detailAd, setDetailAd] = useState<AdRow | null>(null);

  const campaigns = useMemo(
    () => [...hierarchy].sort((a, b) => compareBySort(a.totals, b.totals, sortKey)),
    [hierarchy, sortKey]
  );

  return (
    <section aria-labelledby="campaign-table-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="campaign-table-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
            Campanhas em camadas
          </h2>
          <p className="text-sm text-[rgb(var(--slate-10))]">
            Clique numa campanha para abrir os conjuntos; clique num conjunto para abrir os anúncios. No nome do
            anúncio, você vê quem se cadastrou por ele; na miniatura, o criativo abre em tela cheia.
          </p>
          <p className="mt-1 text-xs text-[rgb(var(--slate-9))]">
            <strong className="font-semibold text-[rgb(var(--slate-10))]">Envios</strong> é o número que fala a
            língua da Meta (cada preenchimento conta, mesmo repetido);{" "}
            <strong className="font-semibold text-[rgb(var(--slate-10))]">Cadastros</strong> é gente de verdade; e{" "}
            <strong className="font-semibold text-[rgb(var(--slate-10))]">Novos</strong>, quem nunca tinha passado
            pela base.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[rgb(var(--slate-9))]">Ordenar por</span>
          <div className="flex gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={sortKey === option.key}
                onClick={() => setSortKey(option.key)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  sortKey === option.key
                    ? "bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-12))] shadow-sm"
                    : "text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {campaigns.length > 0 ? (
        <div className="space-y-2.5">
          {campaigns.map((campaign) => (
            <CampaignRow
              key={campaign.campaignId}
              campaign={campaign}
              sortKey={sortKey}
              onOpenCreative={setLightboxAd}
              onOpenDetail={setDetailAd}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
          Nenhuma campanha para esse recorte no período selecionado.
        </div>
      )}

      {detailAd ? (
        <AdDetailModal
          key={detailAd.adId}
          ad={detailAd}
          filters={filters}
          stageDefs={stageDefs}
          onOpenCreative={() => setLightboxAd(detailAd)}
          onClose={() => setDetailAd(null)}
        />
      ) : null}

      {lightboxAd ? (
        <CreativeLightbox key={lightboxAd.adId} ad={lightboxAd} onClose={() => setLightboxAd(null)} />
      ) : null}
    </section>
  );
}
