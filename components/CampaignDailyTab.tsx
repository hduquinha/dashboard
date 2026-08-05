"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ChevronRight, DollarSign, TrendingDown, TrendingUp, UserPlus, X } from "lucide-react";
import CampaignScopeSelect from "@/components/CampaignScopeSelect";
import CreativeLightbox from "@/components/CreativeLightbox";
import CreativePicker, { type CreativeOption } from "@/components/CreativePicker";
import CreativeThumb from "@/components/CreativeThumb";
import { classifyAdDestination, costPer } from "@/lib/adDestinationGroups";
import {
  formatCurrency,
  formatDayShort,
  formatDayWithWeekday,
  formatNullableCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/campaignFormat";
import { buildDailyAnalysis, summarizeDailyAnalysis, type DailyAnalysisDay } from "@/lib/dailyAdAnalysis";
import { readableAdsetName } from "@/lib/metaAdsLabels";
import type { CampaignGroup, CreativeVisual, DailyAdRow } from "@/types/metaAds";

interface CampaignDailyTabProps {
  rows: DailyAdRow[];
  hierarchy: CampaignGroup[];
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

const COLOR_COST = "#2781F6"; // --blue-9
// Dia que gastou e não trouxe nenhum cadastro: mesma família de âmbar dos avisos
// da tela. Nunca fica só na cor — vem com legenda no gráfico e selo na lista.
const COLOR_NO_LEAD = "#D97706";
const COLOR_AXIS = "#60646c";
const COLOR_GRID = "#f0f0f3";

const ALL = "all";

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof DollarSign;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-4 w-4 text-[rgb(var(--blue-9))]" />
        <span className="text-xs font-medium text-[rgb(var(--slate-10))]">{label}</span>
      </div>
      <p className="text-lg font-semibold tabular-nums text-[rgb(var(--slate-12))]">{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-[rgb(var(--slate-9))]">{hint}</p>
    </div>
  );
}

interface CostPointTooltipPayload {
  date: string;
  custoPorCadastro: number | null;
  spend: number;
  cadastros: number;
}

function DailyCostChart({ points, average }: { points: CostPointTooltipPayload[]; average: number | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Recharts mede o container no DOM real (mesmo padrão da Visão Geral).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return <div className="h-[240px] w-full rounded-md bg-[rgb(var(--slate-3))]" />;

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDayShort}
            stroke={COLOR_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={COLOR_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatCurrency(value)}
          />
          <Tooltip
            labelFormatter={(label) => formatDayWithWeekday(String(label))}
            contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea", fontSize: 12 }}
            formatter={(value: number, _name, item) => {
              const point = item?.payload as CostPointTooltipPayload | undefined;
              return [
                `${formatCurrency(value)} por lead${
                  point ? ` (${formatCurrency(point.spend)} ÷ ${formatNumber(point.cadastros)} cadastros)` : ""
                }`,
                "Custo médio",
              ];
            }}
          />
          {average !== null ? (
            <ReferenceLine
              y={average}
              stroke={COLOR_AXIS}
              strokeDasharray="4 4"
              label={{ value: `média ${formatCurrency(average)}`, position: "insideTopRight", fontSize: 11, fill: COLOR_AXIS }}
            />
          ) : null}
          <Line
            type="linear"
            dataKey="custoPorCadastro"
            stroke={COLOR_COST}
            strokeWidth={2}
            name="Custo médio por lead"
            dot={{ r: 3, strokeWidth: 0, fill: COLOR_COST }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface SpendPoint {
  date: string;
  spend: number;
  cadastros: number;
  /** Dia com investimento e nenhum cadastro — o que a linha de custo por lead
   * não consegue mostrar (não existe custo sem lead). */
  noLead: boolean;
}

/**
 * Investimento por dia, com os dias "gastou e não trouxe lead" destacados. Este
 * gráfico existe justamente porque o de custo por lead fica vazio nesses dias:
 * o dinheiro saiu do mesmo jeito e precisa aparecer.
 */
function DailySpendChart({ points, average }: { points: SpendPoint[]; average: number | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return <div className="h-[240px] w-full rounded-md bg-[rgb(var(--slate-3))]" />;

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid vertical={false} stroke={COLOR_GRID} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDayShort}
            stroke={COLOR_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={COLOR_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatCurrency(value)}
          />
          <Tooltip
            cursor={{ fill: "rgba(39,129,246,0.06)" }}
            labelFormatter={(label) => formatDayWithWeekday(String(label))}
            contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea", fontSize: 12 }}
            formatter={(value: number, _name, item) => {
              const point = item?.payload as SpendPoint | undefined;
              const cadastros = point?.cadastros ?? 0;
              const detail = cadastros === 0 ? "nenhum cadastro nesse dia" : `${formatNumber(cadastros)} cadastros`;
              return [`${formatCurrency(value)} · ${detail}`, "Investido"];
            }}
          />
          {average !== null ? (
            <ReferenceLine
              y={average}
              stroke={COLOR_AXIS}
              strokeDasharray="4 4"
              label={{ value: `média ${formatCurrency(average)}`, position: "insideTopRight", fontSize: 11, fill: COLOR_AXIS }}
            />
          ) : null}
          <Bar dataKey="spend" radius={[4, 4, 0, 0]} maxBarSize={26}>
            {points.map((point) => (
              <Cell key={point.date} fill={point.noLead ? COLOR_NO_LEAD : COLOR_COST} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Faixa de números do dia (e dos grupos dentro dele), em colunas fixas para os
 * dois níveis lerem na mesma vertical. */
function DailyMetrics({
  spend,
  leadsMeta,
  cadastros,
  contatos,
  ctr,
}: {
  spend: number;
  leadsMeta: number;
  cadastros: number;
  contatos: number;
  ctr?: number | null;
}) {
  const cell = "flex flex-col items-end";
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-right sm:grid-cols-6">
      <div className={cell}>
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Investido</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatCurrency(spend)}</span>
      </div>
      <div className={`${cell} hidden sm:flex`} title="Eventos de Lead atribuídos pela Meta.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Meta marcou</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(leadsMeta)}</span>
      </div>
      <div className={cell} title="Pessoas que chegaram no dia: as inéditas mais as que já eram da base e voltaram.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Cadastros</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(cadastros)}</span>
      </div>
      <div className={cell} title="Investimento ÷ cadastros do dia.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Custo/lead</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--blue-11))]">
          {formatNullableCurrency(costPer(spend, cadastros))}
        </span>
      </div>
      <div className={`${cell} hidden sm:flex`} title="Pessoas inéditas no CRM.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">Novos</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--teal-9))]">{formatNumber(contatos)}</span>
      </div>
      <div className={`${cell} hidden sm:flex`} title="Exibições que geraram algum clique.">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">CTR</span>
        <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
          {ctr === undefined ? "—" : formatPercent(ctr)}
        </span>
      </div>
    </div>
  );
}

function DayRow({
  day,
  isBest,
  isWorst,
  onOpenCreative,
}: {
  day: DailyAnalysisDay;
  isBest: boolean;
  isWorst: boolean;
  onOpenCreative: (creative: CreativeVisual) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-3 text-left transition hover:bg-[rgb(var(--slate-2))]"
      >
        <ChevronRight
          className={`h-5 w-5 flex-shrink-0 text-[rgb(var(--slate-10))] transition-transform ${open ? "rotate-90" : ""}`}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[rgb(var(--slate-12))]">{formatDayWithWeekday(day.date)}</span>
            <span className="text-[11px] text-[rgb(var(--slate-9))]">
              {day.adCount} anúncio{day.adCount === 1 ? "" : "s"} · {day.buckets.length} grupo
              {day.buckets.length === 1 ? "" : "s"}
            </span>
            {isBest ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgb(224_248_243)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--teal-9))]">
                <TrendingDown className="h-3 w-3" /> lead mais barato
              </span>
            ) : null}
            {isWorst ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgb(255_247_224)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[rgb(139_94_0)]">
                <TrendingUp className="h-3 w-3" /> lead mais caro
              </span>
            ) : null}
            {day.spend > 0 && day.cadastrosCrm === 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgb(255_247_224)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[rgb(139_94_0)]">
                <AlertTriangle className="h-3 w-3" /> gastou sem cadastro
              </span>
            ) : null}
          </div>
          <DailyMetrics
            spend={day.spend}
            leadsMeta={day.leadsMeta}
            cadastros={day.cadastrosCrm}
            contatos={day.novos}
            ctr={day.ctr}
          />
        </div>
      </button>

      {open ? (
        <div className="border-t border-[rgb(var(--border-weak))]">
          {day.buckets.map((bucket) => (
            <div key={bucket.destination.key} className="border-t border-[rgb(var(--border-weak))] first:border-t-0">
              <div className="flex flex-col gap-2 bg-[rgb(var(--slate-2))] py-2 pl-9 pr-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-[rgb(var(--slate-11))]">
                  {bucket.destination.label}
                  {bucket.destination.detail && bucket.destination.kind === "landing_page"
                    ? ` · ${bucket.destination.detail}`
                    : ""}
                </p>
                <DailyMetrics
                  spend={bucket.spend}
                  leadsMeta={bucket.leadsMeta}
                  cadastros={bucket.cadastrosCrm}
                  contatos={bucket.novos}
                  ctr={bucket.ctr}
                />
              </div>
              {bucket.ads.map((ad) => (
                <div
                  key={`${ad.date}-${ad.adId}`}
                  className="flex flex-col gap-2 border-t border-[rgb(var(--border-weak))] py-2.5 pl-9 pr-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <CreativeThumb creative={ad} onOpen={() => onOpenCreative(ad)} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[rgb(var(--slate-12))]" title={ad.adName}>
                        {ad.adName}
                      </p>
                      <p className="truncate text-[11px] text-[rgb(var(--slate-9))]" title={ad.adsetName}>
                        {readableAdsetName(ad.adsetName)}
                      </p>
                    </div>
                  </div>
                  <DailyMetrics
                    spend={ad.spend}
                    leadsMeta={ad.leadsMeta}
                    cadastros={ad.cadastrosCrm}
                    contatos={ad.novos}
                    ctr={ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : null}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface FilterOption {
  value: string;
  label: string;
  spend: number;
}

export default function CampaignDailyTab({
  rows,
  hierarchy,
  selectedCampaignId,
  selectedAdsetId,
  onCampaignChange,
  onAdsetChange,
}: CampaignDailyTabProps) {
  // Recortes que valem só nesta aba (o de campanha/conjunto mora na URL e é
  // compartilhado com as outras). Grupo de destino e criativo são filtrados no
  // cliente: as linhas (dia × anúncio) do período já estão todas aqui.
  const [groupKey, setGroupKey] = useState<string>(ALL);
  const [adName, setAdName] = useState<string>(ALL);
  const [lightboxCreative, setLightboxCreative] = useState<CreativeVisual | null>(null);

  const groupOptions = useMemo<FilterOption[]>(() => {
    const byKey = new Map<string, FilterOption>();
    for (const row of rows) {
      const destination = classifyAdDestination(row.landingUrl);
      const label =
        destination.detail && destination.kind === "landing_page"
          ? `${destination.label} · ${destination.detail}`
          : destination.label;
      const existing = byKey.get(destination.key);
      if (existing) existing.spend += row.spend;
      else byKey.set(destination.key, { value: destination.key, label, spend: row.spend });
    }
    return Array.from(byKey.values()).sort((a, b) => b.spend - a.spend);
  }, [rows]);

  const groupFilteredRows = useMemo(
    () => (groupKey === ALL ? rows : rows.filter((row) => classifyAdDestination(row.landingUrl).key === groupKey)),
    [groupKey, rows]
  );

  // Um criativo (nome do anúncio) pode ter vários `ad_id` — um por conjunto.
  // Filtrar pelo nome analisa o criativo inteiro, que é o nível em que o gestor
  // pensa "esse anúncio aqui".
  const adOptions = useMemo<CreativeOption[]>(() => {
    const byName = new Map<string, CreativeOption>();
    for (const row of groupFilteredRows) {
      const existing = byName.get(row.adName);
      if (existing) {
        existing.spend += row.spend;
        existing.cadastros += row.cadastrosCrm;
        // Um criativo pode ter linhas de vários dias/conjuntos; guarda a
        // primeira que realmente tem imagem pra miniatura não ficar vazia.
        if (!existing.creative.thumbnailUrl && !existing.creative.imageUrl) existing.creative = row;
      } else {
        byName.set(row.adName, {
          value: row.adName,
          label: row.adName,
          spend: row.spend,
          cadastros: row.cadastrosCrm,
          creative: row,
        });
      }
    }
    return Array.from(byName.values()).sort((a, b) => b.spend - a.spend);
  }, [groupFilteredRows]);

  const adFilterActive = adName !== ALL && adOptions.some((option) => option.value === adName);
  const filteredRows = useMemo(
    () => (adFilterActive ? groupFilteredRows.filter((row) => row.adName === adName) : groupFilteredRows),
    [adFilterActive, adName, groupFilteredRows]
  );

  const days = useMemo(() => buildDailyAnalysis(filteredRows), [filteredRows]);
  const summary = useMemo(() => summarizeDailyAnalysis(days), [days]);

  // Os gráficos leem da esquerda (mais antigo) para a direita; a lista abaixo
  // começa pelo dia mais recente, que é o que o gestor abre primeiro.
  const orderedDays = useMemo(() => [...days].sort((a, b) => a.date.localeCompare(b.date)), [days]);

  const chartPoints = useMemo<CostPointTooltipPayload[]>(
    () =>
      orderedDays.map((day) => ({
        date: day.date,
        custoPorCadastro: day.custoPorCadastro,
        spend: day.spend,
        cadastros: day.cadastrosCrm,
      })),
    [orderedDays]
  );

  const spendPoints = useMemo<SpendPoint[]>(
    () =>
      orderedDays.map((day) => ({
        date: day.date,
        spend: day.spend,
        cadastros: day.cadastrosCrm,
        noLead: day.spend > 0 && day.cadastrosCrm === 0,
      })),
    [orderedDays]
  );

  const daysWithoutLead = spendPoints.filter((point) => point.noLead);
  const spendWithoutLead = daysWithoutLead.reduce((total, point) => total + point.spend, 0);

  const hasScope = Boolean(selectedCampaignId || selectedAdsetId);
  const hasLocalFilter = groupKey !== ALL || adFilterActive;
  const selectedGroupLabel = groupOptions.find((option) => option.value === groupKey)?.label ?? null;

  function handleGroupChange(value: string) {
    setGroupKey(value);
    // O criativo escolhido pode não existir no grupo novo — voltar pra "todos"
    // evita uma tela vazia sem explicação.
    setAdName(ALL);
  }

  function clearLocalFilters() {
    setGroupKey(ALL);
    setAdName(ALL);
  }

  return (
    <section aria-labelledby="campaign-daily-heading" className="space-y-5">
      <div>
        <h2 id="campaign-daily-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
          Dia a dia dos anúncios
        </h2>
        <p className="text-sm text-[rgb(var(--slate-10))]">
          Um bloco por dia com o que foi investido, quantos cadastros entraram e a que custo médio.
          {hasScope ? " Respeitando a campanha/conjunto escolhido nas outras abas." : ""} Abra um dia para ver os grupos
          de destino e cada anúncio daquele dia.
        </p>
      </div>

      {/* Recortes: campanha/conjunto (compartilhado) + grupo de destino e
          criativo (só desta aba) — é o que permite ler o dia a dia de um
          anúncio específico em vez da conta toda. */}
      <div className="space-y-2 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
        <CampaignScopeSelect
          hierarchy={hierarchy}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          onCampaignChange={onCampaignChange}
          onAdsetChange={onAdsetChange}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="daily-group-select">
            Filtrar por grupo de destino
          </label>
          <select
            id="daily-group-select"
            value={groupKey}
            onChange={(event) => handleGroupChange(event.target.value)}
            className="min-h-9 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5 py-1.5 text-xs font-medium text-[rgb(var(--slate-12))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))]"
          >
            <option value={ALL}>Todos os grupos de destino</option>
            {groupOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <CreativePicker
            options={adOptions}
            value={adFilterActive ? adName : null}
            onChange={(next) => setAdName(next ?? ALL)}
            onOpenCreative={setLightboxCreative}
          />

          {hasLocalFilter ? (
            <button
              type="button"
              onClick={clearLocalFilters}
              className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5 py-1.5 text-xs font-medium text-[rgb(var(--slate-10))] hover:bg-[rgb(var(--slate-2))]"
            >
              <X className="h-3.5 w-3.5" />
              Limpar grupo/anúncio
            </button>
          ) : null}

          <p className="text-[11px] text-[rgb(var(--slate-9))]">
            Analisando:{" "}
            <strong className="font-semibold text-[rgb(var(--slate-11))]">
              {adFilterActive ? adName : (selectedGroupLabel ?? "todos os anúncios do recorte")}
            </strong>
            {adFilterActive && selectedGroupLabel ? ` (${selectedGroupLabel})` : ""} ·{" "}
            {formatNumber(summary.dayCount)} dia{summary.dayCount === 1 ? "" : "s"} com movimento
          </p>
        </div>
      </div>

      {days.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
          Nenhum dia com veiculação ou cadastro neste recorte no período selecionado.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard
              label="Custo médio por lead"
              value={formatNullableCurrency(summary.custoPorCadastro)}
              hint={
                summary.custoPorCadastro === null
                  ? "sem cadastros no período"
                  : `${formatCurrency(summary.spend)} ÷ ${formatNumber(summary.cadastrosCrm)} cadastros`
              }
              icon={UserPlus}
            />
            <SummaryCard
              label="Investido no período"
              value={formatCurrency(summary.spend)}
              hint={`${formatNullableCurrency(summary.spendPerDay)} por dia em ${formatNumber(summary.dayCount)} dia${
                summary.dayCount === 1 ? "" : "s"
              } com movimento`}
              icon={DollarSign}
            />
            <SummaryCard
              label="Gasto sem cadastro"
              value={formatCurrency(spendWithoutLead)}
              hint={
                daysWithoutLead.length === 0
                  ? "todo dia com gasto trouxe cadastro"
                  : `${formatNumber(daysWithoutLead.length)} dia${
                      daysWithoutLead.length === 1 ? "" : "s"
                    } gastaram sem nenhum cadastro`
              }
              icon={AlertTriangle}
            />
            <SummaryCard
              label="Dia mais barato"
              value={summary.bestDay ? formatNullableCurrency(summary.bestDay.custoPorCadastro) : "—"}
              hint={
                summary.bestDay
                  ? `${formatDayWithWeekday(summary.bestDay.date)}${
                      summary.worstDay
                        ? ` · mais caro: ${formatDayShort(summary.worstDay.date)} (${formatNullableCurrency(
                            summary.worstDay.custoPorCadastro
                          )})`
                        : ""
                    }`
                  : "nenhum dia teve cadastro"
              }
              icon={TrendingDown}
            />
          </div>

          {/* Dois gráficos de medida única, nunca eixo duplo: gasto e custo por
              lead têm escalas diferentes e o gasto precisa aparecer inclusive
              nos dias em que não entrou lead nenhum. */}
          <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
            <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Investimento por dia</h3>
            <p className="mb-3 text-xs text-[rgb(var(--slate-9))]">
              Todo dia com veiculação aparece aqui, inclusive os que não trouxeram nenhum cadastro. A tracejada é a média
              diária do recorte.
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] text-[rgb(var(--slate-10))]">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLOR_COST }} />
                Dia com cadastro
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLOR_NO_LEAD }} />
                Gastou e não trouxe cadastro
              </span>
            </div>
            <DailySpendChart points={spendPoints} average={summary.spendPerDay} />
          </div>

          <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
            <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Custo médio por lead, dia a dia</h3>
            <p className="mb-4 text-xs text-[rgb(var(--slate-9))]">
              Investimento do dia ÷ cadastros do dia. A linha corta onde o dia teve gasto sem nenhum cadastro — ali não
              existe custo por lead, e o gasto está no gráfico acima. A tracejada é a média do período.
            </p>
            <DailyCostChart points={chartPoints} average={summary.custoPorCadastro} />
          </div>

          <div className="space-y-2.5">
            {days.map((day) => (
              <DayRow
                key={day.date}
                day={day}
                isBest={summary.bestDay?.date === day.date && days.length > 1}
                isWorst={summary.worstDay?.date === day.date && days.length > 1}
                onOpenCreative={setLightboxCreative}
              />
            ))}
          </div>
        </>
      )}

      {lightboxCreative ? (
        <CreativeLightbox
          key={lightboxCreative.adName}
          ad={lightboxCreative}
          onClose={() => setLightboxCreative(null)}
        />
      ) : null}
    </section>
  );
}
