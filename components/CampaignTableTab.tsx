"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Megaphone, Layers, Image as ImageIcon } from "lucide-react";
import { isAdvantagePlusAdset, readableAdsetName, readableCampaignName } from "@/lib/metaAdsLabels";
import type { AdRow, AdsetGroup, AggregatedMetrics, CampaignGroup } from "@/types/metaAds";

interface CampaignTableTabProps {
  hierarchy: CampaignGroup[];
}

type SortKey = "spend" | "cadastrosCrm" | "leadsCrm";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "spend", label: "Investimento" },
  { key: "cadastrosCrm", label: "Cadastros" },
  { key: "leadsCrm", label: "Contatos novos" },
];

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function formatNullableCurrency(value: number | null): string {
  return value === null ? "—" : formatCurrency(value);
}

function costPerContact(totals: Pick<AggregatedMetrics, "spend" | "leadsCrm">): number | null {
  return totals.leadsCrm > 0 ? totals.spend / totals.leadsCrm : null;
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
  cadastros,
  contatos,
}: {
  spend: number;
  leadsMeta: number;
  cadastros: number;
  contatos: number;
}) {
  const gap = leadsMeta > cadastros;
  const cpc = costPerContact({ spend, leadsCrm: contatos });
  const cell = "flex flex-col items-end";
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-right sm:grid-cols-5">
      <div className={cell}>
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Investido</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatCurrency(spend)}</span>
      </div>
      <div className={`${cell} hidden sm:flex`} title="Eventos de Lead atribuídos pela Meta.">
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
      <div className={cell} title="Envios salvos pelo formulário, incluindo contatos que já existiam.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Cadastros</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(cadastros)}</span>
      </div>
      <div className={cell} title="Pessoas novas criadas no CRM.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Contatos novos</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--teal-9))]">{formatNumber(contatos)}</span>
      </div>
      <div className={`${cell} hidden sm:flex`} title="Investimento ÷ contatos novos.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Custo/contato</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatNullableCurrency(cpc)}</span>
      </div>
    </div>
  );
}

function AdRowLine({ ad }: { ad: AdRow }) {
  const src = ad.thumbnailUrl ?? ad.imageUrl;
  return (
    <div className="flex flex-col gap-2 py-2.5 pl-14 pr-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- miniatura do CDN do Meta
          <img src={src} alt="" className="h-9 w-9 flex-shrink-0 rounded object-cover" loading="lazy" />
        ) : (
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[rgb(var(--slate-3))]">
            <ImageIcon className="h-4 w-4 text-[rgb(var(--slate-8))]" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[rgb(var(--slate-12))]" title={ad.adName}>
            {ad.adName}
          </p>
          <StatusDot status={ad.effectiveStatus ?? ad.status} />
        </div>
      </div>
      <MetricStrip spend={ad.spend} leadsMeta={ad.leadsMeta} cadastros={ad.cadastrosCrm} contatos={ad.leadsCrm} />
    </div>
  );
}

function AdsetRow({ adset, sortKey }: { adset: AdsetGroup; sortKey: SortKey }) {
  const [open, setOpen] = useState(false);
  const ads = useMemo(
    () => [...adset.ads].sort((a, b) => b[sortKey] - a[sortKey]),
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
            cadastros={adset.totals.cadastrosCrm}
            contatos={adset.totals.leadsCrm}
          />
        </div>
      </button>
      {open ? (
        <div className="bg-[rgb(var(--slate-1))]">
          {ads.map((ad) => (
            <AdRowLine key={ad.adId} ad={ad} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CampaignRow({ campaign, sortKey }: { campaign: CampaignGroup; sortKey: SortKey }) {
  const [open, setOpen] = useState(false);
  const adsets = useMemo(
    () => [...campaign.adsets].sort((a, b) => b.totals[sortKey] - a.totals[sortKey]),
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
            cadastros={campaign.totals.cadastrosCrm}
            contatos={campaign.totals.leadsCrm}
          />
        </div>
      </button>
      {open ? <div className="border-t border-[rgb(var(--border-weak))]">{adsets.map((adset) => <AdsetRow key={adset.adsetId} adset={adset} sortKey={sortKey} />)}</div> : null}
    </div>
  );
}

export default function CampaignTableTab({ hierarchy }: CampaignTableTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");

  const campaigns = useMemo(
    () => [...hierarchy].sort((a, b) => b.totals[sortKey] - a.totals[sortKey]),
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
            Clique numa campanha para abrir os conjuntos; clique num conjunto para abrir os anúncios.
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
            <CampaignRow key={campaign.campaignId} campaign={campaign} sortKey={sortKey} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
          Nenhuma campanha para esse recorte no período selecionado.
        </div>
      )}
    </section>
  );
}
