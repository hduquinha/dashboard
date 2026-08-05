"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarCheck2, ChevronRight, Clock, Sunrise, Users } from "lucide-react";
import AdLeadList from "@/components/AdLeadList";
import CampaignScopeSelect from "@/components/CampaignScopeSelect";
import { classifyAdDestination } from "@/lib/adDestinationGroups";
import { formatNumber, formatPercent } from "@/lib/campaignFormat";
import {
  bestSchedulingBlock,
  buildBlockArrival,
  buildHourlyArrival,
  buildWeekdayArrival,
  buildWeekdayBlockMatrix,
  groupLeadsByDestination,
  HOUR_BLOCKS,
  peakHour,
  summarizeArrival,
  type HourArrival,
} from "@/lib/leadArrivalAnalysis";
import type { AdLeadDetail, CampaignGroup } from "@/types/metaAds";

interface CampaignHoursTabProps {
  leads: AdLeadDetail[];
  hierarchy: CampaignGroup[];
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

// Uma medida (leads que chegaram), partida em duas categorias: os que chegaram
// a agendar e os demais. Par validado para daltonismo (ΔE 19.5 protan) e já em
// uso na tela: azul = cadastro, verde-água = resultado bom.
const COLOR_LEADS = "#2781F6"; // --blue-9
const COLOR_AGENDARAM = "#12A594"; // --teal-9
const COLOR_AXIS = "#60646c";
const COLOR_GRID = "#f0f0f3";
const COLOR_SURFACE = "#ffffff";

const ALL = "all";

/** Rampa sequencial de uma cor só (clara → escura), tirada dos tokens da tela.
 * O valor também é escrito na célula: cor sozinha nunca carrega o número. */
const HEAT_STEPS = [
  { bg: "rgb(var(--slate-2))", text: "text-[rgb(var(--slate-9))]" },
  { bg: "rgb(var(--blue-3))", text: "text-[rgb(var(--slate-12))]" },
  { bg: "rgb(var(--blue-5))", text: "text-[rgb(var(--slate-12))]" },
  { bg: "rgb(var(--blue-7))", text: "text-[rgb(var(--slate-12))]" },
  { bg: "rgb(var(--blue-9))", text: "text-white" },
];

function heatStep(value: number, max: number): (typeof HEAT_STEPS)[number] {
  if (value <= 0 || max <= 0) return HEAT_STEPS[0];
  const ratio = value / max;
  if (ratio <= 0.25) return HEAT_STEPS[1];
  if (ratio <= 0.5) return HEAT_STEPS[2];
  if (ratio <= 0.75) return HEAT_STEPS[3];
  return HEAT_STEPS[4];
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Clock;
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

interface HourChartPoint {
  label: string;
  agendaram: number;
  naoAgendaram: number;
  cadastros: number;
}

function HourlyChart({ points }: { points: HourChartPoint[] }) {
  // Recharts mede o container no DOM real; renderizar só depois do mount evita
  // divergência entre o HTML do servidor e o primeiro paint (mesmo padrão das
  // outras abas).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return <div className="h-[260px] w-full rounded-md bg-[rgb(var(--slate-3))]" />;

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 5, right: 16, left: 4, bottom: 5 }}>
          <CartesianGrid vertical={false} stroke={COLOR_GRID} />
          <XAxis dataKey="label" stroke={COLOR_AXIS} fontSize={11} tickLine={false} axisLine={false} interval={0} />
          <YAxis
            stroke={COLOR_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={32}
          />
          <Tooltip
            cursor={{ fill: "rgba(39,129,246,0.06)" }}
            contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea", fontSize: 12 }}
            labelFormatter={(label) => `Chegaram às ${label}`}
            formatter={(value: number, name) => [formatNumber(value), name]}
          />
          <Legend verticalAlign="top" height={28} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="agendaram"
            name="Agendaram"
            stackId="leads"
            fill={COLOR_AGENDARAM}
            stroke={COLOR_SURFACE}
            strokeWidth={2}
            maxBarSize={26}
          />
          <Bar
            dataKey="naoAgendaram"
            name="Não agendaram"
            stackId="leads"
            fill={COLOR_LEADS}
            stroke={COLOR_SURFACE}
            strokeWidth={2}
            radius={[4, 4, 0, 0]}
            maxBarSize={26}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HourRow({ hour }: { hour: HourArrival }) {
  const [open, setOpen] = useState(false);
  const empty = hour.cadastros === 0;

  return (
    <>
      <tr className={empty ? "text-[rgb(var(--slate-9))]" : ""}>
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            disabled={empty}
            aria-expanded={open}
            className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))] disabled:cursor-default disabled:text-[rgb(var(--slate-9))]"
          >
            {empty ? (
              <span className="h-4 w-4" />
            ) : (
              <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
            )}
            {hour.label}
          </button>
        </td>
        <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">{formatNumber(hour.cadastros)}</td>
        <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(hour.contatosNovos)}</td>
        <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-[rgb(var(--teal-9))]">
          {formatNumber(hour.agendaram)}
        </td>
        <td className="px-3 py-2 text-right text-sm tabular-nums">{formatPercent(hour.taxaAgendamento)}</td>
        <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(hour.ganhos)}</td>
        <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(hour.perdidos)}</td>
        <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(hour.semDono)}</td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={8} className="bg-[rgb(var(--slate-1))] p-0">
            <AdLeadList leads={hour.leads} hideHour emptyLabel="Nenhum lead nesta hora." />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function CampaignHoursTab({
  leads,
  hierarchy,
  selectedCampaignId,
  selectedAdsetId,
  onCampaignChange,
  onAdsetChange,
}: CampaignHoursTabProps) {
  const [destinationKey, setDestinationKey] = useState<string>(ALL);

  // Opções do filtro de destino: os grupos que realmente trouxeram lead neste
  // recorte (nada de listar landing page sem cadastro no período).
  const destinationOptions = useMemo(() => {
    const groups = groupLeadsByDestination(leads);
    return Array.from(groups.values())
      .map((group) => ({
        key: group.key,
        label: group.destination.detail
          ? `${group.destination.label} · ${group.destination.detail}`
          : group.destination.label,
        cadastros: group.cadastros,
      }))
      .sort((a, b) => b.cadastros - a.cadastros);
  }, [leads]);

  const filteredLeads = useMemo(
    () =>
      destinationKey === ALL
        ? leads
        : leads.filter((lead) => classifyAdDestination(lead.landingUrl).key === destinationKey),
    [destinationKey, leads]
  );

  const totals = useMemo(() => summarizeArrival(filteredLeads), [filteredLeads]);
  const hours = useMemo(() => buildHourlyArrival(filteredLeads), [filteredLeads]);
  const blocks = useMemo(() => buildBlockArrival(filteredLeads), [filteredLeads]);
  const weekdays = useMemo(() => buildWeekdayArrival(filteredLeads), [filteredLeads]);
  const matrix = useMemo(() => buildWeekdayBlockMatrix(filteredLeads), [filteredLeads]);
  const peak = useMemo(() => peakHour(hours), [hours]);
  const bestBlock = useMemo(() => bestSchedulingBlock(blocks), [blocks]);
  const busiestBlock = useMemo(
    () => blocks.reduce<(typeof blocks)[number] | null>((best, block) => (!best || block.cadastros > best.cadastros ? block : best), null),
    [blocks]
  );

  const chartPoints = useMemo<HourChartPoint[]>(
    () =>
      hours.map((hour) => ({
        label: hour.label,
        agendaram: hour.agendaram,
        naoAgendaram: hour.cadastros - hour.agendaram,
        cadastros: hour.cadastros,
      })),
    [hours]
  );

  const matrixMax = useMemo(() => matrix.reduce((max, cell) => Math.max(max, cell.cadastros), 0), [matrix]);
  const cellAt = (diaSemana: number, blockKey: string) =>
    matrix.find((cell) => cell.diaSemana === diaSemana && cell.blockKey === blockKey) ?? null;

  return (
    <section aria-labelledby="campaign-hours-heading" className="space-y-5">
      <div>
        <h2 id="campaign-hours-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
          Horários em que os leads chegam
        </h2>
        <p className="text-sm text-[rgb(var(--slate-10))]">
          A que horas as pessoas se cadastram pelos anúncios e o que aconteceu com cada uma depois. Horário de Brasília,
          o mesmo fuso da conta de anúncios. &quot;Agendaram&quot; conta quem passou pela etapa Agendado em algum
          momento — inclusive quem já fechou ou foi perdido depois. Cada envio de formulário conta uma pessoa, inclusive
          quem já existia no CRM e voltou (esses retornos ficam de fora da coluna Cadastros das outras abas).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CampaignScopeSelect
          hierarchy={hierarchy}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          onCampaignChange={onCampaignChange}
          onAdsetChange={onAdsetChange}
        />
        <label className="sr-only" htmlFor="hours-destination-select">
          Filtrar por grupo de destino
        </label>
        <select
          id="hours-destination-select"
          value={destinationKey}
          onChange={(event) => setDestinationKey(event.target.value)}
          className="min-h-9 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5 py-1.5 text-xs font-medium text-[rgb(var(--slate-12))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))]"
        >
          <option value={ALL}>Todos os destinos</option>
          {destinationOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label} ({option.cadastros})
            </option>
          ))}
        </select>
      </div>

      {totals.cadastros === 0 ? (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
          Nenhum lead de anúncio chegou neste recorte e período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Pessoas que chegaram"
              value={formatNumber(totals.cadastros)}
              hint={`${formatNumber(totals.contatosNovos)} novos · ${formatNumber(totals.semDono)} sem vendedor`}
              icon={Users}
            />
            <KpiCard
              label="Horário de pico"
              value={peak ? peak.label : "—"}
              hint={peak ? `${formatNumber(peak.cadastros)} pessoas chegaram nesta hora` : "sem chegadas no recorte"}
              icon={Clock}
            />
            <KpiCard
              label="Faixa que mais traz"
              value={busiestBlock && busiestBlock.cadastros > 0 ? busiestBlock.label : "—"}
              hint={
                busiestBlock && busiestBlock.cadastros > 0
                  ? `${busiestBlock.range} · ${formatNumber(busiestBlock.cadastros)} pessoas (${Math.round(
                      busiestBlock.participacao
                    )}% do total)`
                  : "sem chegadas no recorte"
              }
              icon={Sunrise}
            />
            <KpiCard
              label="Agendamentos"
              value={`${formatNumber(totals.agendaram)} · ${formatPercent(totals.taxaAgendamento)}`}
              hint={
                bestBlock
                  ? `melhor faixa: ${bestBlock.label} (${formatPercent(bestBlock.taxaAgendamento)} de ${formatNumber(
                      bestBlock.cadastros
                    )} pessoas)`
                  : "nenhuma faixa tem chegadas suficientes para eleger a melhor"
              }
              icon={CalendarCheck2}
            />
          </div>

          <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
            <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Chegadas por hora do dia</h3>
            <p className="mb-3 text-xs text-[rgb(var(--slate-9))]">
              Altura total = pessoas que chegaram naquela hora; a parte verde é quantas delas chegaram a agendar.
            </p>
            <HourlyChart points={chartPoints} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {blocks.map((block) => (
              <div
                key={block.key}
                className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">{block.label}</h3>
                  <span className="text-[11px] text-[rgb(var(--slate-9))]">{block.range}</span>
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-[rgb(var(--slate-12))]">
                  {formatNumber(block.cadastros)}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--slate-4))]">
                    <div
                      className="h-full rounded-full bg-[rgb(var(--blue-9))]"
                      style={{ width: `${Math.max(Math.round(block.participacao), 1)}%` }}
                    />
                  </div>
                  <span className="flex-shrink-0 text-[11px] tabular-nums text-[rgb(var(--slate-10))]">
                    {Math.round(block.participacao)}%
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-[rgb(var(--border-weak))] pt-2.5">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Agendaram</dt>
                    <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--teal-9))]">
                      {formatNumber(block.agendaram)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Taxa</dt>
                    <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
                      {formatPercent(block.taxaAgendamento)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
            <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Dia da semana × faixa do dia</h3>
            <p className="mb-3 text-xs text-[rgb(var(--slate-9))]">
              Pessoas em cada cruzamento (o número está escrito na célula; a cor só reforça). Entre parênteses, quantas
              agendaram.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-separate border-spacing-1 text-center">
                <caption className="sr-only">Pessoas que chegaram por dia da semana e faixa de horário</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-24 text-left text-[11px] font-medium text-[rgb(var(--slate-9))]">
                      Dia
                    </th>
                    {HOUR_BLOCKS.map((block) => (
                      <th key={block.key} scope="col" className="text-[11px] font-medium text-[rgb(var(--slate-9))]">
                        {block.label}
                        <span className="block font-normal text-[rgb(var(--slate-8))]">{block.range}</span>
                      </th>
                    ))}
                    <th scope="col" className="text-[11px] font-medium text-[rgb(var(--slate-9))]">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {weekdays.map((weekday) => (
                    <tr key={weekday.diaSemana}>
                      <th scope="row" className="text-left text-xs font-medium text-[rgb(var(--slate-11))]">
                        {weekday.label}
                      </th>
                      {HOUR_BLOCKS.map((block) => {
                        const cell = cellAt(weekday.diaSemana, block.key);
                        const step = heatStep(cell?.cadastros ?? 0, matrixMax);
                        return (
                          <td key={block.key} className="p-0">
                            <div
                              className={`rounded-md px-2 py-2 text-sm font-semibold tabular-nums ${step.text}`}
                              style={{ backgroundColor: step.bg }}
                              title={`${weekday.label}, ${block.label} (${block.range}): ${formatNumber(
                                cell?.cadastros ?? 0
                              )} pessoas, ${formatNumber(cell?.agendaram ?? 0)} agendaram`}
                            >
                              {formatNumber(cell?.cadastros ?? 0)}
                              {cell && cell.agendaram > 0 ? (
                                <span className="ml-1 text-[11px] font-medium">({formatNumber(cell.agendaram)})</span>
                              ) : null}
                            </div>
                          </td>
                        );
                      })}
                      <td className="p-0">
                        <div className="rounded-md px-2 py-2 text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
                          {formatNumber(weekday.cadastros)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
            <div className="border-b border-[rgb(var(--border-weak))] px-4 py-3">
              <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Hora a hora, com as pessoas</h3>
              <p className="text-xs text-[rgb(var(--slate-9))]">
                Clique na hora para ver exatamente quem chegou nela, de qual anúncio veio e em que etapa está.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem]">
                <thead className="bg-[rgb(var(--slate-2))] text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Hora
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Pessoas
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Novos
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Agendaram
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Taxa
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Ganhos
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Perdidos
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Sem dono
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border-weak))]">
                  {hours.map((hour) => (
                    <HourRow key={hour.hora} hour={hour} />
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))]">
                  <tr>
                    <th scope="row" className="px-3 py-2 text-left text-xs font-semibold text-[rgb(var(--slate-11))]">
                      Total
                    </th>
                    <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                      {formatNumber(totals.cadastros)}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(totals.contatosNovos)}</td>
                    <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-[rgb(var(--teal-9))]">
                      {formatNumber(totals.agendaram)}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">
                      {formatPercent(totals.taxaAgendamento)}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(totals.ganhos)}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(totals.perdidos)}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(totals.semDono)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
