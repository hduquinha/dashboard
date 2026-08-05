"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Crown, Target } from "lucide-react";
import CampaignScopeSelect from "@/components/CampaignScopeSelect";
import { formatCurrency, formatNullableCurrency, formatNumber, formatPercent } from "@/lib/campaignFormat";
import {
  adsetComparisonInputs,
  buildComparison,
  campaignComparisonInputs,
  creativeComparisonInputs,
  destinationComparisonInputs,
  type ComparisonEntity,
} from "@/lib/campaignComparison";
import { scopeAds } from "@/lib/campaignScope";
import type { CampaignGroup } from "@/types/metaAds";

interface CampaignCompareTabProps {
  hierarchy: CampaignGroup[];
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

const COLOR_MAIN = "#2781F6"; // --blue-9
const COLOR_GOOD = "#12A594"; // --teal-9
const COLOR_BAD = "#D97706"; // âmbar dos avisos da tela
const COLOR_ACCUM = "#8E4EC6"; // roxo, série de linha do acumulado
const COLOR_AXIS = "#60646c";
const COLOR_GRID = "#f0f0f3";

type Dimension = "campanhas" | "conjuntos" | "criativos" | "destinos";

const DIMENSIONS: Array<{ key: Dimension; label: string; hint: string; singular: string; plural: string }> = [
  { key: "campanhas", label: "Campanhas", hint: "Compara as campanhas entre si.", singular: "campanha", plural: "Todas as campanhas" },
  { key: "conjuntos", label: "Conjuntos", hint: "Desce um nível: público a público.", singular: "conjunto", plural: "Todos os conjuntos" },
  { key: "criativos", label: "Criativos", hint: "A peça em si, somando os conjuntos em que ela roda.", singular: "criativo", plural: "Todos os criativos" },
  { key: "destinos", label: "Destinos", hint: "Formulário nativo × cada landing page.", singular: "destino", plural: "Todos os destinos" },
];

/** Recharts entrega o valor do tooltip como número|string|array conforme o
 * gráfico; a formatação só precisa do número. */
function toNumber(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Corta rótulo comprido no eixo sem perder o começo, que é o que identifica. */
function shortLabel(label: string, max = 26): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

function ChartFrame({ children, height = 300 }: { children: React.ReactElement; height?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  if (!mounted) return <div className="w-full rounded-md bg-[rgb(var(--slate-3))]" style={{ height }} />;
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function Highlight({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof Crown;
  tone: "good" | "bad" | "neutral";
  label: string;
  value: string;
  hint: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-[rgb(var(--teal-9))]"
      : tone === "bad"
        ? "text-[rgb(180_98_6)]"
        : "text-[rgb(var(--blue-9))]";
  return (
    <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className={`h-4 w-4 ${toneClass}`} />
        <span className="text-xs font-medium text-[rgb(var(--slate-10))]">{label}</span>
      </div>
      <p className="truncate text-base font-semibold text-[rgb(var(--slate-12))]" title={value}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-[rgb(var(--slate-9))]">{hint}</p>
    </div>
  );
}

function EfficiencyBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-[rgb(var(--slate-9))]">—</span>;
  }
  const good = value >= 1;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${
        good ? "bg-[rgb(224_248_243)] text-[rgb(var(--teal-9))]" : "bg-[rgb(255_247_224)] text-[rgb(139_94_0)]"
      }`}
      title={
        good
          ? "Entrega uma fatia de leads maior do que a fatia de orçamento que consome."
          : "Consome uma fatia de orçamento maior do que a fatia de leads que entrega."
      }
    >
      {good ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×
    </span>
  );
}

export default function CampaignCompareTab({
  hierarchy,
  selectedCampaignId,
  selectedAdsetId,
  onCampaignChange,
  onAdsetChange,
}: CampaignCompareTabProps) {
  const [dimension, setDimension] = useState<Dimension>("campanhas");

  const scopedAds = useMemo(
    () => scopeAds(hierarchy, selectedCampaignId, selectedAdsetId),
    [hierarchy, selectedAdsetId, selectedCampaignId]
  );
  const scopedHierarchy = useMemo(
    () =>
      hierarchy
        .filter((campaign) => !selectedCampaignId || campaign.campaignId === selectedCampaignId)
        .map((campaign) => ({
          ...campaign,
          adsets: campaign.adsets.filter((adset) => !selectedAdsetId || adset.adsetId === selectedAdsetId),
        })),
    [hierarchy, selectedAdsetId, selectedCampaignId]
  );

  // Comparação de custo por lead só faz sentido entre quem tem captação como
  // objetivo — a campanha de engajamento é avaliada na aba Alcance.
  const inputs = useMemo(() => {
    const raw =
      dimension === "campanhas"
        ? campaignComparisonInputs(scopedHierarchy)
        : dimension === "conjuntos"
          ? adsetComparisonInputs(scopedHierarchy)
          : dimension === "criativos"
            ? creativeComparisonInputs(scopedAds)
            : destinationComparisonInputs(scopedAds);
    return raw.filter((item) => item.purpose !== "engajamento" && (item.spend > 0 || item.cadastros > 0));
  }, [dimension, scopedAds, scopedHierarchy]);

  const result = useMemo(() => buildComparison(inputs), [inputs]);

  const costPoints = useMemo(
    () =>
      result.entities
        .filter((entity) => entity.custoPorLead !== null)
        .sort((a, b) => (a.custoPorLead ?? 0) - (b.custoPorLead ?? 0))
        .map((entity) => ({
          label: shortLabel(entity.label),
          fullLabel: entity.label,
          custoPorLead: entity.custoPorLead ?? 0,
          spend: entity.spend,
          cadastros: entity.cadastros,
          isBest: entity.key === result.melhorCusto?.key,
          isWorst: entity.key === result.piorCusto?.key,
        })),
    [result]
  );

  const sharePoints = useMemo(
    () =>
      [...result.entities]
        .filter((entity) => entity.spend > 0 || entity.cadastros > 0)
        .sort((a, b) => b.shareLeads - a.shareLeads)
        .map((entity) => ({
          label: shortLabel(entity.label, 20),
          fullLabel: entity.label,
          "Fatia dos leads": Number(entity.shareLeads.toFixed(1)),
          "Fatia do gasto": Number(entity.shareSpend.toFixed(1)),
        })),
    [result]
  );

  const paretoPoints = useMemo(
    () =>
      result.pareto.map((point) => ({
        label: shortLabel(point.label, 20),
        fullLabel: point.label,
        "Fatia dos leads": Number(point.shareLeads.toFixed(1)),
        "Acumulado": Number(point.acumulado.toFixed(1)),
      })),
    [result]
  );

  const sortedTable = useMemo(
    () => [...result.entities].sort((a, b) => b.spend - a.spend),
    [result]
  );

  const dimensionInfo = DIMENSIONS.find((option) => option.key === dimension) ?? DIMENSIONS[0];

  return (
    <section aria-labelledby="campaign-compare-heading" className="space-y-5">
      <div>
        <h2 id="campaign-compare-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
          Comparativos
        </h2>
        <p className="text-sm text-[rgb(var(--slate-10))]">
          Quem traz lead mais barato, quem consome orçamento sem entregar e onde o resultado está concentrado. Só entram
          campanhas de captação — as de engajamento não têm formulário e são avaliadas na aba Alcance.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1" aria-label="O que comparar">
          {DIMENSIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={dimension === option.key}
              title={option.hint}
              onClick={() => setDimension(option.key)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                dimension === option.key
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

      {result.entities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
          Nenhuma campanha de captação neste recorte e período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Highlight
              icon={Crown}
              tone="good"
              label="Lead mais barato"
              value={result.melhorCusto ? result.melhorCusto.label : "—"}
              hint={
                result.melhorCusto
                  ? `${formatNullableCurrency(result.melhorCusto.custoPorLead)} por lead · ${formatNumber(
                      result.melhorCusto.cadastros
                    )} cadastros`
                  : "sem cadastro no recorte"
              }
            />
            <Highlight
              icon={AlertTriangle}
              tone="bad"
              label="Lead mais caro"
              value={result.piorCusto ? result.piorCusto.label : "—"}
              hint={
                result.piorCusto
                  ? `${formatNullableCurrency(result.piorCusto.custoPorLead)} por lead · ${formatNumber(
                      result.piorCusto.cadastros
                    )} cadastros`
                  : "só há uma opção com cadastro"
              }
            />
            <Highlight
              icon={Target}
              tone="neutral"
              label="Traz mais volume"
              value={result.maiorVolume ? result.maiorVolume.label : "—"}
              hint={
                result.maiorVolume
                  ? `${formatNumber(result.maiorVolume.cadastros)} cadastros (${Math.round(
                      result.maiorVolume.shareLeads
                    )}% de tudo)`
                  : "sem cadastro no recorte"
              }
            />
            <Highlight
              icon={ArrowUpRight}
              tone="neutral"
              label="Concentração"
              value={
                result.concentracao
                  ? `${result.concentracao.quantidade} de ${result.concentracao.total}`
                  : "—"
              }
              hint={
                result.concentracao
                  ? `${result.concentracao.quantidade === 1 ? "responde" : "respondem"} por ${Math.round(
                      result.concentracao.share
                    )}% dos leads · média geral ${formatNullableCurrency(result.custoMedio)}`
                  : "sem cadastro para concentrar"
              }
            />
          </div>

          {result.semResultado.length > 0 ? (
            <div className="rounded-xl border border-[rgb(245_183_106)] bg-[rgb(255_247_224)] p-4">
              <div className="mb-1 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-[rgb(139_94_0)]" />
                <h3 className="text-sm font-semibold text-[rgb(139_94_0)]">Gastou e não trouxe lead</h3>
              </div>
              <p className="text-xs text-[rgb(139_94_0)]">
                {result.semResultado
                  .slice(0, 6)
                  .map((entity) => `${entity.label} (${formatCurrency(entity.spend)})`)
                  .join(" · ")}
                {result.semResultado.length > 6 ? ` · +${result.semResultado.length - 6}` : ""}
              </p>
            </div>
          ) : null}

          {costPoints.length > 1 ? (
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
              <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Custo por lead — do mais barato ao mais caro</h3>
              <p className="mb-4 text-xs text-[rgb(var(--slate-9))]">
                Investimento dividido pelos cadastros de cada {dimensionInfo.singular}. A linha tracejada é a média do
                recorte; verde é o melhor, âmbar é o pior.
              </p>
              <ChartFrame height={Math.max(220, costPoints.length * 34 + 40)}>
                <BarChart data={costPoints} layout="vertical" margin={{ top: 5, right: 28, left: 8, bottom: 5 }} barCategoryGap={8}>
                  <CartesianGrid horizontal={false} stroke={COLOR_GRID} />
                  <XAxis
                    type="number"
                    stroke={COLOR_AXIS}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => formatCurrency(value)}
                  />
                  <YAxis type="category" dataKey="label" width={190} stroke={COLOR_AXIS} fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(39,129,246,0.06)" }}
                    contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea", fontSize: 12 }}
                    labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                    formatter={(value: unknown, _name: unknown, item: { payload?: unknown }) => {
                      const point = item?.payload as (typeof costPoints)[number] | undefined;
                      return [
                        `${formatCurrency(toNumber(value))} por lead${
                          point ? ` (${formatCurrency(point.spend)} ÷ ${formatNumber(point.cadastros)})` : ""
                        }`,
                        "Custo",
                      ] as [string, string];
                    }}
                  />
                  {result.custoMedio !== null ? (
                    <ReferenceLine
                      x={result.custoMedio}
                      stroke={COLOR_AXIS}
                      strokeDasharray="4 4"
                      label={{ value: `média ${formatCurrency(result.custoMedio)}`, position: "top", fontSize: 11, fill: COLOR_AXIS }}
                    />
                  ) : null}
                  <Bar dataKey="custoPorLead" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {costPoints.map((point) => (
                      <Cell
                        key={point.fullLabel}
                        fill={point.isBest ? COLOR_GOOD : point.isWorst ? COLOR_BAD : COLOR_MAIN}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartFrame>
            </div>
          ) : null}

          {sharePoints.length > 1 ? (
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
              <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Fatia dos leads × fatia do gasto</h3>
              <p className="mb-4 text-xs text-[rgb(var(--slate-9))]">
                As duas barras são porcentagens do recorte. Barra de leads maior que a de gasto = está entregando acima do
                que custa.
              </p>
              <ChartFrame height={Math.max(240, sharePoints.length * 46 + 50)}>
                <BarChart data={sharePoints} layout="vertical" margin={{ top: 5, right: 24, left: 8, bottom: 5 }} barCategoryGap={12}>
                  <CartesianGrid horizontal={false} stroke={COLOR_GRID} />
                  <XAxis
                    type="number"
                    stroke={COLOR_AXIS}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => `${value}%`}
                  />
                  <YAxis type="category" dataKey="label" width={160} stroke={COLOR_AXIS} fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(39,129,246,0.06)" }}
                    contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea", fontSize: 12 }}
                    labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                    formatter={(value: unknown, name: unknown) =>
                      [`${toNumber(value).toLocaleString("pt-BR")}%`, String(name)] as [string, string]
                    }
                  />
                  <Legend verticalAlign="top" height={28} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Fatia dos leads" fill={COLOR_GOOD} radius={[0, 4, 4, 0]} maxBarSize={14} />
                  <Bar dataKey="Fatia do gasto" fill={COLOR_MAIN} radius={[0, 4, 4, 0]} maxBarSize={14} />
                </BarChart>
              </ChartFrame>
            </div>
          ) : null}

          {paretoPoints.length > 1 ? (
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
              <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Onde estão os leads (curva 80/20)</h3>
              <p className="mb-4 text-xs text-[rgb(var(--slate-9))]">
                Barras = fatia de cada um, da maior para a menor. A linha soma essas fatias: onde ela cruza os 80%, você
                já sabe quantos respondem pela maior parte do resultado.
              </p>
              <ChartFrame height={280}>
                <ComposedChart data={paretoPoints} margin={{ top: 5, right: 20, left: 4, bottom: 5 }}>
                  <CartesianGrid vertical={false} stroke={COLOR_GRID} />
                  <XAxis dataKey="label" stroke={COLOR_AXIS} fontSize={11} tickLine={false} axisLine={false} interval={0} angle={-12} textAnchor="end" height={54} />
                  <YAxis
                    stroke={COLOR_AXIS}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    tickFormatter={(value: number) => `${value}%`}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(39,129,246,0.06)" }}
                    contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea", fontSize: 12 }}
                    labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                    formatter={(value: unknown, name: unknown) =>
                      [`${toNumber(value).toLocaleString("pt-BR")}%`, String(name)] as [string, string]
                    }
                  />
                  <Legend verticalAlign="top" height={28} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={80} stroke={COLOR_AXIS} strokeDasharray="4 4" label={{ value: "80%", position: "right", fontSize: 11, fill: COLOR_AXIS }} />
                  <Bar dataKey="Fatia dos leads" fill={COLOR_MAIN} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Line type="monotone" dataKey="Acumulado" stroke={COLOR_ACCUM} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ChartFrame>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
            <div className="border-b border-[rgb(var(--border-weak))] px-4 py-3">
              <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Tabela comparativa</h3>
              <p className="text-xs text-[rgb(var(--slate-9))]">
                {dimensionInfo.plural} do recorte, do maior investimento para o menor.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[62rem]">
                <thead className="bg-[rgb(var(--slate-2))] text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">#</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Nome</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Investido</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">% do gasto</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Cadastros</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">% dos leads</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Custo/lead</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Eficiência</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Impressões</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">CTR</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Qualificados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border-weak))]">
                  {sortedTable.map((entity: ComparisonEntity) => (
                    <tr key={entity.key}>
                      <td className="px-3 py-2 text-xs tabular-nums text-[rgb(var(--slate-9))]">
                        {entity.rankCusto ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <p className="max-w-[22rem] truncate text-sm font-medium text-[rgb(var(--slate-12))]" title={entity.label}>
                          {entity.label}
                        </p>
                        {entity.sublabel ? (
                          <p className="truncate text-[11px] text-[rgb(var(--slate-9))]">{entity.sublabel}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums">{formatCurrency(entity.spend)}</td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-[rgb(var(--slate-10))]">
                        {Math.round(entity.shareSpend)}%
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                        {formatNumber(entity.cadastros)}
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-[rgb(var(--slate-10))]">
                        {Math.round(entity.shareLeads)}%
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                        {formatNullableCurrency(entity.custoPorLead)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <EfficiencyBadge value={entity.eficiencia} />
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(entity.impressions)}</td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums">{formatPercent(entity.ctr)}</td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-[rgb(var(--teal-9))]">
                        {formatNumber(entity.leadsQualificados)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
