"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import CampaignScopeSelect from "@/components/CampaignScopeSelect";
import { readableAdsetName, readableCampaignName } from "@/lib/metaAdsLabels";
import type { AggregatedMetrics, CampaignGroup } from "@/types/metaAds";

type Level = "campanha" | "conjunto" | "anuncio";

interface TableRow {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  leadsMeta: number;
  cadastrosCrm: number;
  leadsCrm: number;
  cplReal: number | null;
  leadsQualificados: number;
  leadsFechados: number;
  valorFechado: number;
}

interface CampaignTableTabProps {
  hierarchy: CampaignGroup[];
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

function formatNullableCurrency(value: number | null): string {
  return value === null ? "—" : formatCurrency(value);
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** Campanha/conjunto só têm totais agregados (AggregatedMetrics), não as
 * taxas derivadas (ctr/cpc/cpm/cplReal) que o anúncio individual já traz
 * prontas do banco — calcula aqui pra não duplicar a fórmula em cada nível. */
function deriveRates(totals: AggregatedMetrics): { ctr: number | null; cpc: number | null; cpm: number | null; cplReal: number | null } {
  return {
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : null,
    cpm: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : null,
    cplReal: totals.leadsCrm > 0 ? totals.spend / totals.leadsCrm : null,
  };
}

function statusLabel(status: string): string {
  if (status === "ACTIVE") return "Ativa";
  if (status === "PAUSED") return "Pausada";
  if (status === "ARCHIVED") return "Arquivada";
  return status.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

type ColumnKey =
  | "name"
  | "status"
  | "spend"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpc"
  | "cpm"
  | "leadsMeta"
  | "cadastrosCrm"
  | "leadsCrm"
  | "cplReal"
  | "leadsQualificados"
  | "leadsFechados"
  | "valorFechado";

interface Column {
  key: ColumnKey;
  label: string;
  align?: "left" | "right";
  format: (row: TableRow) => string;
  sortValue: (row: TableRow) => number | string;
}

const COLUMNS: Column[] = [
  { key: "status", label: "Status", format: (r) => statusLabel(r.status), sortValue: (r) => r.status },
  { key: "spend", label: "Investido", align: "right", format: (r) => formatCurrency(r.spend), sortValue: (r) => r.spend },
  { key: "impressions", label: "Impressões", align: "right", format: (r) => formatNumber(r.impressions), sortValue: (r) => r.impressions },
  { key: "clicks", label: "Cliques", align: "right", format: (r) => formatNumber(r.clicks), sortValue: (r) => r.clicks },
  { key: "ctr", label: "CTR", align: "right", format: (r) => formatPercent(r.ctr), sortValue: (r) => r.ctr ?? -1 },
  { key: "cpc", label: "CPC", align: "right", format: (r) => formatNullableCurrency(r.cpc), sortValue: (r) => r.cpc ?? -1 },
  { key: "cpm", label: "CPM", align: "right", format: (r) => formatNullableCurrency(r.cpm), sortValue: (r) => r.cpm ?? -1 },
  { key: "leadsMeta", label: "Meta marcou", align: "right", format: (r) => formatNumber(r.leadsMeta), sortValue: (r) => r.leadsMeta },
  { key: "cadastrosCrm", label: "Cadastros", align: "right", format: (r) => formatNumber(r.cadastrosCrm), sortValue: (r) => r.cadastrosCrm },
  { key: "leadsCrm", label: "Contatos novos", align: "right", format: (r) => formatNumber(r.leadsCrm), sortValue: (r) => r.leadsCrm },
  { key: "cplReal", label: "Custo/contato novo", align: "right", format: (r) => formatNullableCurrency(r.cplReal), sortValue: (r) => r.cplReal ?? -1 },
  { key: "leadsQualificados", label: "Qualificados", align: "right", format: (r) => formatNumber(r.leadsQualificados), sortValue: (r) => r.leadsQualificados },
  { key: "leadsFechados", label: "Fechados", align: "right", format: (r) => formatNumber(r.leadsFechados), sortValue: (r) => r.leadsFechados },
  { key: "valorFechado", label: "Valor fechado", align: "right", format: (r) => formatCurrency(r.valorFechado), sortValue: (r) => r.valorFechado },
];

function SortIcon({ column, sortKey, sortDir }: { column: ColumnKey; sortKey: ColumnKey; sortDir: "asc" | "desc" }) {
  if (column !== sortKey) return <ArrowUpDown className="h-3 w-3 text-[rgb(var(--slate-7))]" />;
  return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

const LEVEL_OPTIONS: Array<{ key: Level; label: string }> = [
  { key: "campanha", label: "Por campanha" },
  { key: "conjunto", label: "Por conjunto" },
  { key: "anuncio", label: "Por anúncio" },
];

export default function CampaignTableTab({
  hierarchy,
  selectedCampaignId,
  selectedAdsetId,
  onCampaignChange,
  onAdsetChange,
}: CampaignTableTabProps) {
  const [level, setLevel] = useState<Level>("anuncio");
  const [sortKey, setSortKey] = useState<ColumnKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const scopedCampaigns = useMemo(
    () => hierarchy.filter((campaign) => !selectedCampaignId || campaign.campaignId === selectedCampaignId),
    [hierarchy, selectedCampaignId]
  );

  const rows: TableRow[] = useMemo(() => {
    if (level === "campanha") {
      return scopedCampaigns.map((campaign) => ({
        id: campaign.campaignId,
        name: readableCampaignName(campaign.campaignName),
        status: campaign.status,
        spend: campaign.totals.spend,
        impressions: campaign.totals.impressions,
        clicks: campaign.totals.clicks,
        leadsMeta: campaign.totals.leadsMeta,
        cadastrosCrm: campaign.totals.cadastrosCrm,
        leadsCrm: campaign.totals.leadsCrm,
        leadsQualificados: campaign.totals.leadsQualificados,
        leadsFechados: campaign.totals.leadsFechados,
        valorFechado: campaign.totals.valorFechado,
        ...deriveRates(campaign.totals),
      }));
    }

    if (level === "conjunto") {
      return scopedCampaigns.flatMap((campaign) =>
        campaign.adsets
          .filter((adset) => !selectedAdsetId || adset.adsetId === selectedAdsetId)
          .map((adset) => ({
            id: adset.adsetId,
            name: readableAdsetName(adset.adsetName),
            status: adset.status,
            spend: adset.totals.spend,
            impressions: adset.totals.impressions,
            clicks: adset.totals.clicks,
            leadsMeta: adset.totals.leadsMeta,
            cadastrosCrm: adset.totals.cadastrosCrm,
            leadsCrm: adset.totals.leadsCrm,
            leadsQualificados: adset.totals.leadsQualificados,
            leadsFechados: adset.totals.leadsFechados,
            valorFechado: adset.totals.valorFechado,
            ...deriveRates(adset.totals),
          }))
      );
    }

    return scopedCampaigns.flatMap((campaign) =>
      campaign.adsets
        .filter((adset) => !selectedAdsetId || adset.adsetId === selectedAdsetId)
        .flatMap((adset) =>
          adset.ads.map((ad) => ({
            id: ad.adId,
            name: ad.adName,
            status: ad.effectiveStatus ?? ad.status,
            spend: ad.spend,
            impressions: ad.impressions,
            clicks: ad.clicks,
            ctr: ad.ctr,
            cpc: ad.cpc,
            cpm: ad.cpm,
            leadsMeta: ad.leadsMeta,
            cadastrosCrm: ad.cadastrosCrm,
            leadsCrm: ad.leadsCrm,
            cplReal: ad.cplReal,
            leadsQualificados: ad.leadsQualificados,
            leadsFechados: ad.leadsFechados,
            valorFechado: ad.valorFechado,
          }))
        )
    );
  }, [level, scopedCampaigns, selectedAdsetId]);

  const sortedRows = useMemo(() => {
    const column = COLUMNS.find((c) => c.key === sortKey);
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = column ? column.sortValue(a) : a.name;
      const vb = column ? column.sortValue(b) : b.name;
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), "pt-BR");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortDir, sortKey]);

  function handleSort(key: ColumnKey) {
    if (key === sortKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <section aria-labelledby="campaign-table-heading" className="space-y-4">
      <div>
        <h2 id="campaign-table-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
          Tabela
        </h2>
        <p className="text-sm text-[rgb(var(--slate-10))]">
          Números frios pra comparar: clique num cabeçalho de coluna pra ordenar.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1" aria-label="Nível de agregação da tabela">
          {LEVEL_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={level === option.key}
              onClick={() => setLevel(option.key)}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition ${
                level === option.key
                  ? "bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-12))] shadow-sm"
                  : "text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <CampaignScopeSelect
          hierarchy={hierarchy}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          onCampaignChange={onCampaignChange}
          onAdsetChange={onAdsetChange}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
        <table className="w-full min-w-[1200px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))]">
              <th className="sticky left-0 z-10 bg-[rgb(var(--slate-2))] px-3 py-2.5 text-left">
                <button
                  type="button"
                  onClick={() => handleSort("name")}
                  className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
                >
                  Nome <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} />
                </button>
              </th>
              {COLUMNS.map((column) => (
                <th key={column.key} className={`px-3 py-2.5 ${column.align === "right" ? "text-right" : "text-left"}`}>
                  <button
                    type="button"
                    onClick={() => handleSort(column.key)}
                    className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))] ${
                      column.align === "right" ? "ml-auto flex-row-reverse" : ""
                    }`}
                  >
                    {column.label} <SortIcon column={column.key} sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const gap = row.leadsMeta > row.cadastrosCrm;
              return (
                <tr key={row.id} className="border-b border-[rgb(var(--border-weak))] last:border-0 hover:bg-[rgb(var(--slate-2))]">
                  <td className="sticky left-0 z-10 max-w-[280px] truncate bg-[rgb(var(--surface-1))] px-3 py-2 font-medium text-[rgb(var(--slate-12))]" title={row.name}>
                    {row.name}
                  </td>
                  <td className="px-3 py-2 text-[rgb(var(--slate-11))]">{statusLabel(row.status)}</td>
                  {COLUMNS.slice(1).map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-2 tabular-nums ${column.align === "right" ? "text-right" : ""} ${
                        column.key === "leadsMeta" && gap ? "font-semibold text-[rgb(139_94_0)]" : "text-[rgb(var(--slate-12))]"
                      }`}
                    >
                      {column.key === "leadsMeta" && gap ? (
                        <span className="inline-flex items-center justify-end gap-1" title="Meta marcou mais do que o CRM confirmou">
                          <AlertTriangle className="h-3 w-3" />
                          {column.format(row)}
                        </span>
                      ) : (
                        column.format(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-10 text-center text-sm text-[rgb(var(--slate-10))]">
                  Nenhuma linha pra esse recorte no período selecionado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
