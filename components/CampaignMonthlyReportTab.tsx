"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCopy,
  Download,
  Info,
  Minus,
  Printer,
} from "lucide-react";
import { formatCurrency, formatDayShort, formatNullableCurrency, formatNumber, formatPercent } from "@/lib/campaignFormat";
import { buildReportText, monthLabel, type MonthlyReport, type ReportCampaignLine, type ReportDelta } from "@/lib/monthlyReport";
import type { FunnelStageDef } from "@/types/metaAds";

/** Azul = conversão, teal = engajamento. O par foi validado para daltonismo e
 * é o mesmo usado na aba Horários; âmbar fica reservado para aviso e sempre
 * vem com rótulo escrito, nunca sozinho. */
const COLOR_CONVERSION = "#2781F6";
const COLOR_ENGAGEMENT = "#12A594";
const COLOR_AXIS = "#60646c";

interface CampaignMonthlyReportTabProps {
  report: MonthlyReport;
  months: string[];
  stageDefs: FunnelStageDef[];
  ticketMedio: number | null;
  saleStageKey: string | null;
  onMonthChange: (month: string) => void;
}

function ChartFrame({ children, height }: { children: React.ReactElement; height: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  if (!mounted) return <div className="w-full rounded-md bg-[rgb(var(--slate-3))]" style={{ height }} />;
  return (
    <div className="w-full break-inside-avoid" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    // Bloco grande NÃO leva break-inside-avoid: quando não cabe no resto da
    // folha, o navegador joga o bloco inteiro para a próxima e deixa meia
    // página em branco. A quebra é evitada nas unidades pequenas (cartão,
    // linha, tópico) e o título é preso ao que vem depois dele.
    <section className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <header className="mb-3 break-inside-avoid break-after-avoid">
        <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-[rgb(var(--slate-9))]">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: ReportDelta | null;
  tone?: "neutral" | "conversion" | "engagement";
}) {
  const accent =
    tone === "conversion" ? COLOR_CONVERSION : tone === "engagement" ? COLOR_ENGAGEMENT : "rgb(var(--slate-8))";
  return (
    <div className="break-inside-avoid rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 flex-none rounded-full" style={{ background: accent }} aria-hidden="true" />
        <span className="text-[11px] font-medium text-[rgb(var(--slate-10))]">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold leading-tight text-[rgb(var(--slate-12))]">{value}</p>
      {delta ? <DeltaBadge delta={delta} /> : null}
      {hint ? <p className="mt-1 text-[11px] leading-snug text-[rgb(var(--slate-9))]">{hint}</p> : null}
    </div>
  );
}

function DeltaBadge({ delta }: { delta: ReportDelta }) {
  if (delta.deltaPct === null) {
    return <p className="mt-1 text-[11px] text-[rgb(var(--slate-9))]">sem mês anterior para comparar</p>;
  }
  const up = delta.deltaPct >= 0;
  const good = delta.lowerIsBetter ? !up : up;
  const Icon = delta.deltaPct === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <p
      className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${
        good ? "text-[rgb(var(--teal-9))]" : "text-[rgb(180_98_6)]"
      }`}
    >
      <Icon className="h-3 w-3" />
      {up ? "+" : ""}
      {formatPercent(delta.deltaPct)} vs. mês anterior
    </p>
  );
}

function Bullets({ items }: { items: Array<{ text: string; tone: "neutral" | "good" | "warn" }> }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => {
        const Icon = item.tone === "good" ? CheckCircle2 : item.tone === "warn" ? AlertTriangle : Info;
        const color =
          item.tone === "good"
            ? "text-[rgb(var(--teal-9))]"
            : item.tone === "warn"
              ? "text-[rgb(180_98_6)]"
              : "text-[rgb(var(--blue-9))]";
        return (
          <li key={index} className="flex break-inside-avoid gap-2 text-sm leading-relaxed text-[rgb(var(--slate-12))]">
            <Icon className={`mt-0.5 h-4 w-4 flex-none ${color}`} aria-hidden="true" />
            <span>{item.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Lista de pontos simples dentro de um bloco — o formato que a pessoa lê em
 * voz alta na reunião. */
function PointList({ points }: { points: Array<{ label: string; value: string; note?: string }> }) {
  return (
    <ul className="space-y-1.5">
      {points.map((point) => (
        <li key={point.label} className="flex break-inside-avoid flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-[rgb(var(--slate-11))]">•</span>
          <span className="text-[rgb(var(--slate-11))]">{point.label}:</span>
          <span className="font-semibold text-[rgb(var(--slate-12))]">{point.value}</span>
          {point.note ? <span className="text-xs text-[rgb(var(--slate-9))]">{point.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function csvCell(value: string | number): string {
  if (typeof value === "number") return value.toFixed(2).replace(".", ",");
  return `"${value.replace(/"/g, '""')}"`;
}

function buildCsv(report: MonthlyReport): string {
  const header = [
    "Campanha",
    "Tipo",
    "Investimento",
    "Impressoes",
    "Cliques",
    "Cadastros",
    "Pessoas novas",
    "Custo por cadastro",
    "Interacoes",
    "Custo por interacao",
  ];
  const lines = [...report.conversion.campanhas, ...report.engagement.campanhas].map((line) =>
    [
      csvCell(line.label),
      csvCell(line.purpose === "engajamento" ? "Engajamento" : "Conversao"),
      csvCell(line.spend),
      csvCell(line.impressions),
      csvCell(line.clicks),
      csvCell(line.cadastros),
      csvCell(line.pessoas),
      line.custoPorCadastro === null ? '""' : csvCell(line.custoPorCadastro),
      csvCell(line.interacoes),
      line.custoPorInteracao === null ? '""' : csvCell(line.custoPorInteracao),
    ].join(";")
  );
  return `﻿${header.join(";")}\n${lines.join("\n")}`;
}

export default function CampaignMonthlyReportTab({
  report,
  months,
  stageDefs,
  ticketMedio,
  saleStageKey,
  onMonthChange,
}: CampaignMonthlyReportTabProps) {
  const router = useRouter();
  const [ticketInput, setTicketInput] = useState(ticketMedio ? String(ticketMedio) : "");
  const [stageInput, setStageInput] = useState(saleStageKey ?? report.financial.potencial.stageKey ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { investment, conversion, engagement, financial, financeContext, comparison } = report;

  const campaignChartData = useMemo(
    () =>
      [...conversion.campanhas, ...engagement.campanhas]
        .filter((line) => line.spend > 0)
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 10)
        .map((line) => ({
          name: line.label.length > 34 ? `${line.label.slice(0, 33)}…` : line.label,
          spend: line.spend,
          purpose: line.purpose,
          cadastros: line.cadastros,
        })),
    [conversion.campanhas, engagement.campanhas]
  );

  const funnelChartData = useMemo(
    () => conversion.funnel.filter((stage) => stage.kind !== "lost").map((stage) => ({ name: stage.label, count: stage.count })),
    [conversion.funnel]
  );

  async function saveSettings() {
    setSaving(true);
    setError(null);
    try {
      const parsed = Number.parseFloat(ticketInput.replace(/\./g, "").replace(",", "."));
      const response = await fetch("/api/ui-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "campanhas",
          prefs: {
            ticketMedio: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
            saleStageKey: stageInput || null,
          },
        }),
      });
      if (!response.ok) throw new Error("Não deu para salvar agora.");
      setSavedAt(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      // O relatório é montado no servidor (o ticket entra no texto dos tópicos),
      // então salvar sozinho não muda a tela — o refresh refaz o cálculo.
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não deu para salvar agora.");
    } finally {
      setSaving(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(buildReportText(report));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("O navegador bloqueou a cópia. Use Imprimir/PDF.");
    }
  }

  function downloadCsv() {
    const blob = new Blob([buildCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-midia-${report.month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Controles: some na impressão, para o PDF sair só com o relatório. */}
      <section
        data-print-hidden="true"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3 print:hidden"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-[rgb(var(--slate-10))]">Mês do relatório</span>
          <select
            value={report.month}
            onChange={(event) => onMonthChange(event.target.value)}
            className="min-h-9 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5 py-1.5 text-sm"
          >
            {months.map((item) => (
              <option key={item} value={item}>
                {monthLabel(item)}
              </option>
            ))}
            {months.includes(report.month) ? null : <option value={report.month}>{monthLabel(report.month)}</option>}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-[rgb(var(--slate-10))]">Ticket médio (R$)</span>
          <input
            inputMode="decimal"
            value={ticketInput}
            onChange={(event) => setTicketInput(event.target.value)}
            placeholder={
              financial.potencial.ticketOrigem === "financeiro"
                ? String(Math.round(financial.potencial.ticketMedio ?? 0))
                : "5000"
            }
            className="min-h-9 w-32 rounded-md border border-[rgb(var(--border-weak))] px-2.5 py-1.5 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span
            className="text-[11px] font-semibold text-[rgb(var(--slate-10))]"
            title="Usada só para dimensionar o potencial em aberto; o retorno medido vem das matrículas do Financeiro."
          >
            Etapa de oportunidade fechada
          </span>
          <select
            value={stageInput}
            onChange={(event) => setStageInput(event.target.value)}
            className="min-h-9 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5 py-1.5 text-sm"
          >
            {stageDefs
              .filter((stage) => stage.kind !== "entry" && stage.kind !== "lost")
              .map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}
                </option>
              ))}
          </select>
        </label>

        <button
          type="button"
          onClick={saveSettings}
          disabled={saving}
          className="min-h-9 rounded-md bg-[rgb(var(--blue-9))] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Salvando…" : "Aplicar"}
        </button>

        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copyText}
            className="flex min-h-9 items-center gap-1.5 rounded-md border border-[rgb(var(--border-weak))] px-3 py-1.5 text-sm font-semibold text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))]"
          >
            <ClipboardCopy className="h-4 w-4" />
            {copied ? "Copiado!" : "Copiar tópicos"}
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            className="flex min-h-9 items-center gap-1.5 rounded-md border border-[rgb(var(--border-weak))] px-3 py-1.5 text-sm font-semibold text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))]"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex min-h-9 items-center gap-1.5 rounded-md border border-[rgb(var(--border-weak))] px-3 py-1.5 text-sm font-semibold text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))]"
          >
            <Printer className="h-4 w-4" />
            Imprimir / PDF
          </button>
        </div>

        {error ? <p className="w-full text-xs text-[rgb(180_98_6)]">{error}</p> : null}
        {savedAt && !error ? <p className="w-full text-xs text-[rgb(var(--slate-9))]">Salvo às {savedAt}.</p> : null}
      </section>

      <header className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4">
        <h2 className="text-lg font-semibold text-[rgb(var(--slate-12))]">
          Relatório de mídia — {report.monthLabel}
        </h2>
        <p className="mt-1 text-xs text-[rgb(var(--slate-10))]">
          Período de {formatDayShort(report.from)} a {formatDayShort(report.to)} · Meta Ads, conta inteira (inclui
          campanhas pausadas){report.parcial ? " · mês ainda em andamento" : ""}.
        </p>
      </header>

      <Section title="Os pontos do mês" subtitle="Cada linha sai de um número apurado abaixo — nada aqui é estimativa sem aviso.">
        <Bullets items={report.highlights} />
      </Section>

      <Section
        title="1. Quanto investimos"
        subtitle="Conversão e engajamento aparecem somados e separados; nenhuma média mistura os dois."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Investimento total"
            value={formatCurrency(investment.total)}
            delta={comparison?.investimento}
            hint={`${formatNumber(investment.diasComEntrega)} dias com entrega`}
          />
          <Stat
            label="Conversão"
            tone="conversion"
            value={formatCurrency(investment.conversao)}
            delta={comparison?.investimentoConversao}
            hint="Campanhas com formulário"
          />
          <Stat
            label="Engajamento"
            tone="engagement"
            value={formatCurrency(investment.engajamento)}
            delta={comparison?.investimentoEngajamento}
            hint={`${formatPercent(investment.shareEngajamentoPct)} da verba`}
          />
          <Stat
            label="Média por dia"
            value={formatNullableCurrency(investment.mediaDiaria)}
            hint={
              investment.maiorDia
                ? `Maior dia: ${formatDayShort(investment.maiorDia.date)} (${formatCurrency(investment.maiorDia.spend)})`
                : undefined
            }
          />
        </div>

        {investment.gastoSemCadastro > 0 ? (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-[rgb(217_119_6/0.35)] bg-[rgb(217_119_6/0.06)] p-2.5 text-xs text-[rgb(180_98_6)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <span>
              Atenção: {formatNumber(investment.diasSemCadastro)} dias tiveram gasto e nenhum cadastro, somando{" "}
              {formatCurrency(investment.gastoSemCadastro)}.
            </span>
          </p>
        ) : null}

        {campaignChartData.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-[rgb(var(--slate-10))]">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_CONVERSION }} />
                Conversão
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_ENGAGEMENT }} />
                Engajamento
              </span>
            </div>
            <ChartFrame height={Math.max(180, campaignChartData.length * 34)}>
              <BarChart data={campaignChartData} layout="vertical" margin={{ top: 4, right: 78, bottom: 4, left: 4 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={210}
                  tick={{ fontSize: 11, fill: COLOR_AXIS }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(39,129,246,0.06)" }}
                  formatter={(value: unknown) => [formatCurrency(Number(value)), "Investimento"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="spend" radius={[0, 4, 4, 0]} barSize={16}>
                  {campaignChartData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={entry.purpose === "engajamento" ? COLOR_ENGAGEMENT : COLOR_CONVERSION}
                    />
                  ))}
                  <LabelList
                    dataKey="spend"
                    position="right"
                    formatter={(value: unknown) => formatCurrency(Number(value))}
                    style={{ fontSize: 11, fill: COLOR_AXIS }}
                  />
                </Bar>
              </BarChart>
            </ChartFrame>
          </div>
        ) : null}
      </Section>

      <Section
        title="2. Retorno das campanhas de conversão"
        subtitle="Campanhas com formulário — as únicas que podem ser cobradas por custo por lead."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Investido" tone="conversion" value={formatCurrency(conversion.spend)} />
          <Stat
            label="Cadastros"
            value={formatNumber(conversion.cadastros)}
            delta={comparison?.cadastros}
            hint="Formulários enviados, incluindo quem já existia"
          />
          <Stat
            label="Pessoas novas no CRM"
            value={formatNumber(conversion.pessoas)}
            delta={comparison?.pessoas}
            hint="Contatos primários, sem os retornos mesclados"
          />
          <Stat
            label="Custo por cadastro"
            value={formatNullableCurrency(conversion.custoPorCadastro)}
            delta={comparison?.custoPorCadastro}
            hint={`Por pessoa nova: ${formatNullableCurrency(conversion.custoPorPessoa)}`}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-[rgb(var(--slate-10))]">
              Até onde essas pessoas chegaram no funil
            </p>
            <ChartFrame height={Math.max(160, funnelChartData.length * 30)}>
              <BarChart data={funnelChartData} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fontSize: 11, fill: COLOR_AXIS }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(39,129,246,0.06)" }}
                  formatter={(value: unknown) => [formatNumber(Number(value)), "Pessoas"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="count" fill={COLOR_CONVERSION} radius={[0, 4, 4, 0]} barSize={14}>
                  <LabelList
                    dataKey="count"
                    position="right"
                    formatter={(value: unknown) => formatNumber(Number(value))}
                    style={{ fontSize: 11, fill: COLOR_AXIS }}
                  />
                </Bar>
              </BarChart>
            </ChartFrame>
            <p className="mt-1 text-[11px] text-[rgb(var(--slate-9))]">
              Contagem cumulativa: quem passou pela etapa conta nela, mesmo tendo avançado depois.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-[rgb(var(--slate-10))]">Leitura em tópicos</p>
            <PointList
              points={[
                { label: "Leads que a Meta marcou", value: formatNumber(conversion.leadsMeta) },
                {
                  label: `Chegaram a "${conversion.agendadoLabel ?? "Agendado"}"`,
                  value: formatNumber(conversion.agendados),
                  note: `${formatPercent(conversion.taxaAgendamento)} das pessoas novas`,
                },
                {
                  label: `Chegaram a "${conversion.ganhoLabel ?? "Ganho"}"`,
                  value: formatNumber(conversion.ganhos),
                  note: `${formatPercent(conversion.taxaGanho)} das pessoas novas`,
                },
                { label: "Impressões", value: formatNumber(conversion.impressions) },
                { label: "Cliques", value: formatNumber(conversion.clicks), note: `CTR ${formatPercent(conversion.ctr)}` },
                { label: "Custo por mil impressões", value: formatNullableCurrency(conversion.cpm) },
              ]}
            />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-xs">
            <thead className="text-[rgb(var(--slate-10))]">
              <tr className="border-b border-[rgb(var(--border-weak))]">
                <th className="py-2 pr-3 font-medium">Campanha</th>
                <th className="py-2 pr-3 text-right font-medium">Investido</th>
                <th className="py-2 pr-3 text-right font-medium">Fatia</th>
                <th className="py-2 pr-3 text-right font-medium">Cadastros</th>
                <th className="py-2 pr-3 text-right font-medium">Pessoas</th>
                <th className="py-2 text-right font-medium">Custo/cadastro</th>
              </tr>
            </thead>
            <tbody>
              {conversion.campanhas.map((line) => (
                <CampaignRow key={line.campaignId} line={line} />
              ))}
              {conversion.campanhas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-[rgb(var(--slate-9))]">
                    Nenhuma campanha de conversão com entrega no mês.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="3. Retorno das campanhas de engajamento"
        subtitle="Campanhas para aparecer: não têm formulário, então são cobradas por alcance e interação — nunca por custo por lead."
      >
        {engagement.spend > 0 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Investido" tone="engagement" value={formatCurrency(engagement.spend)} />
              <Stat
                label="Pessoas alcançadas"
                tone="engagement"
                value={formatNumber(engagement.reach)}
                hint={`Frequência ${engagement.frequency === null ? "—" : engagement.frequency.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`}
              />
              <Stat
                label="Interações"
                tone="engagement"
                value={formatNumber(engagement.interacoes)}
                delta={comparison?.interacoes}
                hint={`${formatNullableCurrency(engagement.custoPorInteracao)} por interação`}
              />
              <Stat
                label="Visualizações de vídeo"
                tone="engagement"
                value={formatNumber(engagement.videoViews)}
                hint={`${formatNullableCurrency(engagement.custoPorVideoView)} por visualização`}
              />
            </div>
            <div className="mt-3">
              <PointList
                points={[
                  { label: "Impressões", value: formatNumber(engagement.impressions) },
                  { label: "Custo por mil impressões", value: formatNullableCurrency(engagement.cpm) },
                  { label: "Custo por mil pessoas alcançadas", value: formatNullableCurrency(engagement.custoPorMilPessoas) },
                  { label: "Reações", value: formatNumber(engagement.reactions) },
                  { label: "Comentários", value: formatNumber(engagement.comments) },
                  { label: "Compartilhamentos", value: formatNumber(engagement.shares) },
                  { label: "Salvamentos", value: formatNumber(engagement.saves) },
                  { label: "Conversas iniciadas no direct", value: formatNumber(engagement.messagingStarted) },
                ]}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-[rgb(var(--slate-10))]">
            Nenhuma campanha de engajamento rodou em {report.monthLabel.toLocaleLowerCase("pt-BR")}.
          </p>
        )}
      </Section>

      <Section
        title="4. Retorno em reais"
        subtitle="Só conta como retorno a matrícula registrada no Financeiro que foi conciliada com um lead vindo de anúncio. Etapa do CRM não é receita."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Matrículas vindas de anúncio"
            value={`${formatNumber(financial.matriculasDeAnuncio)} de ${formatNumber(financial.matriculasNoMes)}`}
            hint="Conciliação por nome entre Financeiro e CRM"
          />
          <Stat
            label="Retorno medido"
            value={financial.retorno === null ? formatCurrency(0) : formatCurrency(financial.retorno)}
            hint={
              financial.basis === "matricula"
                ? "Valor contratado das matrículas de anúncio"
                : financial.basis === "crm"
                  ? "Valor de fechamento registrado no CRM"
                  : "Nenhuma matrícula do mês foi atribuída a anúncio"
            }
          />
          <Stat
            label="Retorno por real investido"
            value={financial.roas === null ? "—" : `${financial.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`}
            hint={financial.roiPct === null ? "Sem retorno medido, não há ROI a calcular" : `ROI de ${formatPercent(financial.roiPct)}`}
          />
          <Stat
            label="Custo de mídia por matrícula"
            value={formatNullableCurrency(financial.custoPorMatricula)}
            hint={
              financial.custoPorMatricula === null
                ? `${formatCurrency(financial.investimento)} investidos sem matrícula atribuída`
                : "Investimento em captação ÷ matrículas de anúncio"
            }
          />
        </div>

        {financial.divergenciaCrmFinanceiro ? (
          <p className="mt-3 flex items-start gap-2 break-inside-avoid rounded-md border border-[rgb(217_119_6/0.35)] bg-[rgb(217_119_6/0.06)] p-2.5 text-xs text-[rgb(180_98_6)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <span>
              Divergência entre CRM e Financeiro: {formatNumber(financial.potencial.oportunidades)}{" "}
              {financial.potencial.oportunidades === 1 ? "lead de anúncio chegou" : "leads de anúncio chegaram"}
              {" à etapa "}
              &quot;{financial.potencial.stageLabel}&quot;, mas nenhuma matrícula correspondente foi registrada no
              Financeiro. Ou a venda não fechou de fato, ou não foi lançada — vale conferir antes de apresentar.
            </span>
          </p>
        ) : null}

        {financial.potencial.valor !== null ? (
          <div className="mt-3 break-inside-avoid rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] p-3">
            <p className="text-xs font-semibold text-[rgb(var(--slate-11))]">Potencial em aberto (cenário, não receita)</p>
            <p className="mt-1 text-sm text-[rgb(var(--slate-12))]">
              {formatNumber(financial.potencial.oportunidades)}{" "}
              {financial.potencial.oportunidades === 1 ? "oportunidade de anúncio" : "oportunidades de anúncio"}
              {" na etapa "}
              &quot;{financial.potencial.stageLabel}&quot; × ticket de{" "}
              {formatCurrency(financial.potencial.ticketMedio ?? 0)} ={" "}
              <strong>{formatCurrency(financial.potencial.valor)}</strong> se todas virarem matrícula.
            </p>
            <p className="mt-1 text-[11px] text-[rgb(var(--slate-9))]">
              Ticket{" "}
              {financial.potencial.ticketOrigem === "informado"
                ? "informado nesta tela"
                : "calculado a partir das matrículas do Financeiro"}
              . Este número não entra em nenhum total de retorno acima.
            </p>
          </div>
        ) : null}

        <p className="mt-3 flex items-start gap-2 break-inside-avoid rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] p-2.5 text-xs text-[rgb(var(--slate-11))]">
          <Info className="mt-0.5 h-4 w-4 flex-none text-[rgb(var(--blue-9))]" />
          <span>
            A conciliação é feita pelo nome do aluno, porque o Financeiro ainda não guarda de qual lead veio a
            matrícula. Uma matrícula de anúncio lançada com o nome escrito diferente do cadastro aparece como &quot;sem
            cadastro&quot; — para acabar com a dúvida, a receita precisa ser lançada a partir do lead no CRM. O
            investimento usado nesta conta é o de captação ({formatCurrency(financial.investimento)}); o engajamento é
            cobrado pelos números do bloco 3.
          </span>
        </p>
      </Section>

      {financeContext ? (
        <Section
          title="5. O que o Financeiro registrou no mês"
          subtitle="Contexto do negócio — inclui vendas de todas as origens, não só de anúncio."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Matrículas no mês" value={formatNumber(financeContext.matriculas)} />
            <Stat label="Valor contratado" value={formatCurrency(financeContext.valorContratado)} />
            <Stat
              label="Recebido no mês"
              value={formatCurrency(financeContext.recebido)}
              hint={`Previsto (competência): ${formatCurrency(financeContext.previsto)}`}
            />
            <Stat
              label="Ticket médio das matrículas"
              value={formatNullableCurrency(financeContext.ticketMedioMatricula)}
              hint="Valor contratado ÷ matrículas do mês"
            />
          </div>
          {financeContext.origens && financeContext.origens.total > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold text-[rgb(var(--slate-10))]">De onde vieram essas matrículas</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <OriginCard
                  label="De anúncio"
                  bucket={financeContext.origens.anuncio}
                  total={financeContext.origens.total}
                  hint="Aluno casou com um lead que veio de campanha"
                />
                <OriginCard
                  label="De lead do CRM, sem anúncio"
                  bucket={financeContext.origens.crmSemAnuncio}
                  total={financeContext.origens.total}
                  hint="Entrou por formulário orgânico, aula experimental ou indicação já cadastrada"
                />
                <OriginCard
                  label="Sem cadastro no CRM"
                  bucket={financeContext.origens.semCadastro}
                  total={financeContext.origens.total}
                  hint="Venda fora do funil digital: indicação, boca a boca, presencial"
                />
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-xs">
                  <thead className="text-[rgb(var(--slate-10))]">
                    <tr className="border-b border-[rgb(var(--border-weak))]">
                      <th className="py-2 pr-3 font-medium">Aluno</th>
                      <th className="py-2 pr-3 font-medium">Venda</th>
                      <th className="py-2 pr-3 font-medium">Origem apurada</th>
                      <th className="py-2 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {financeContext.origens.rows.map((row) => (
                      <tr key={`${row.student}-${row.saleDate}`} className="border-b border-[rgb(var(--border-weak))] last:border-0">
                        <td className="py-2 pr-3 text-[rgb(var(--slate-12))]">{row.student}</td>
                        <td className="py-2 pr-3 text-[rgb(var(--slate-10))]">{formatDayShort(row.saleDate)}</td>
                        <td className="py-2 pr-3 text-[rgb(var(--slate-11))]">
                          {row.kind === "anuncio"
                            ? `Anúncio${row.campaignName ? ` · ${row.campaignName}` : ""}`
                            : row.kind === "crm_sem_anuncio"
                              ? `Lead do CRM${row.leadOrigem ? ` · ${row.leadOrigem}` : ""}`
                              : "Sem cadastro no CRM"}
                        </td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <p className="mt-3 flex items-start gap-2 break-inside-avoid rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] p-2.5 text-xs text-[rgb(var(--slate-11))]">
            <Info className="mt-0.5 h-4 w-4 flex-none text-[rgb(var(--blue-9))]" />
            <span>
              A origem acima é apurada cruzando o nome do aluno com os cadastros do CRM — é o melhor possível hoje,
              porque o Financeiro não guarda o lead de origem da matrícula. Nome escrito de forma diferente cai em
              &quot;sem cadastro&quot;. Para essa conta ficar exata, a receita precisa ser lançada a partir do lead no
              CRM.
            </span>
          </p>
        </Section>
      ) : null}

      <Section title="Como ler estes números" subtitle="As regras que valem em todo o relatório.">
        <ul className="space-y-1.5 text-xs leading-relaxed text-[rgb(var(--slate-11))]">
          <li>• Fonte: Meta Ads (sincronização automática) cruzada com os leads do CRM VozUP. Google Ads não entra.</li>
          <li>
            • O relatório sempre cobre o mês inteiro e a conta inteira, inclusive campanhas pausadas — por isso o total
            pode ser maior que o das outras abas, que abrem filtradas em &quot;Ativas&quot;.
          </li>
          <li>
            • Leads são contados pela data em que a pessoa se cadastrou, não pela data em que avançou de etapa.
          </li>
          <li>
            • &quot;Cadastros&quot; são formulários enviados (inclui quem já existia no CRM); &quot;pessoas novas&quot;
            são só os contatos inéditos.
          </li>
          <li>• Campanha de engajamento nunca entra em custo por lead, e campanha de conversão nunca é julgada por interação.</li>
        </ul>
      </Section>
    </div>
  );
}

function OriginCard({
  label,
  bucket,
  total,
  hint,
}: {
  label: string;
  bucket: { count: number; amount: number };
  total: number;
  hint: string;
}) {
  return (
    <div className="break-inside-avoid rounded-lg border border-[rgb(var(--border-weak))] p-3">
      <p className="text-[11px] font-medium text-[rgb(var(--slate-10))]">{label}</p>
      <p className="mt-1 text-base font-semibold text-[rgb(var(--slate-12))]">
        {formatNumber(bucket.count)} de {formatNumber(total)}
      </p>
      <p className="text-xs text-[rgb(var(--slate-11))]">{formatCurrency(bucket.amount)} contratados</p>
      <p className="mt-1 text-[11px] leading-snug text-[rgb(var(--slate-9))]">{hint}</p>
    </div>
  );
}

function CampaignRow({ line }: { line: ReportCampaignLine }) {
  return (
    <tr className="border-b border-[rgb(var(--border-weak))] last:border-0">
      <td className="py-2 pr-3 text-[rgb(var(--slate-12))]" title={line.rawName}>
        {line.label}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(line.spend)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-[rgb(var(--slate-10))]">
        {formatPercent(line.sharePct)}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(line.cadastros)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(line.pessoas)}</td>
      <td className="py-2 text-right tabular-nums font-semibold">{formatNullableCurrency(line.custoPorCadastro)}</td>
    </tr>
  );
}
