"use client";

import { formatCurrency, formatDayShort, formatNullableCurrency, formatNumber, formatPercent } from "@/lib/campaignFormat";
import type { MonthlyReport, ReportDelta } from "@/lib/monthlyReport";
import type { GoogleAdsReport } from "@/lib/googleAdsReport";
import type { ReportNarrative } from "@/lib/reportNarrative";
import type { ReportSegmentsData } from "@/lib/reportSegments";

/**
 * O relatório de campanha em formato documento — o que sai no Imprimir/PDF.
 *
 * É deliberadamente um componente separado da aba interativa
 * (CampaignMonthlyReportTab), não um tema de impressão por cima dela. A tela
 * interativa existe para explorar (filtros, período, campanhas incluídas); o
 * documento existe para ser lido e compartilhado — títulos grandes, um achado
 * por seção, tabelas com a leitura já feita. Tentar servir os dois objetivos
 * com o mesmo layout produz o que este componente substitui: um print de
 * dashboard, com card cinza e fonte de sistema, sem hierarquia nenhuma.
 *
 * Este componente só aparece na impressão (`hidden print:block` no
 * container pai) — em tela, quem usa o relatório usa a aba interativa.
 */

// ─── Paleta ──────────────────────────────────────────────────────────────
// As cores reais da marca VozUP (ver app/globals.css: --dashboard-navy,
// --dashboard-accent*), não uma paleta nova inventada para o documento.
const NAVY = "#041a30";
const INK = "#12202b";
const INK_SOFT = "#4d6070";
const CYAN = "#06a8d8";
const CYAN_STRONG = "#0086b8";
const CYAN_WASH = "#e5f8ff";
const LINE = "#dce8f2";
const PAPER = "#fbfdfe";
const GOOD = "#0f8a6f";
const GOOD_WASH = "#e5f6f1";
const WARN_TEXT = "#8b5e00";
const WARN_WASH = "#fff7e0";
const WARN_LINE = "#f0e0aa";
const BAD_TEXT = "#a3372a";
const BAD_WASH = "#fcefec";
const BAD_LINE = "#ebc3ba";

/** Complemento de rótulo por origem: a pasta do CRM tem o nome interno, o
 * relatório precisa do nome que o leitor reconhece. */
const ORIGIN_HINT: Record<string, string> = {
  "landing-pages": " (orgânico)",
  "aula-experimental": " (aula exclusiva)",
  meta: " (pago)",
  "google-ads": " (pago)",
};

const URGENCY_TAG: Record<string, { label: string; text: string; wash: string }> = {
  agora: { label: "FAZER AGORA", text: BAD_TEXT, wash: BAD_WASH },
  "esta-semana": { label: "ESTA SEMANA", text: WARN_TEXT, wash: WARN_WASH },
  testar: { label: "TESTE A/B", text: CYAN_STRONG, wash: CYAN_WASH },
  habilitar: { label: "HABILITAR", text: GOOD, wash: GOOD_WASH },
};

interface Props {
  report: MonthlyReport;
  segments: ReportSegmentsData | null;
  narrative: ReportNarrative | null;
  google: GoogleAdsReport | null;
}

// ─── Peças pequenas reutilizadas no documento ──────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{ color: CYAN_STRONG, letterSpacing: "0.14em" }}
      className="font-poppins text-[10px] font-bold uppercase"
    >
      {children}
    </p>
  );
}

function DocHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: NAVY }} className="font-poppins mt-1 text-[19px] font-extrabold leading-tight text-balance">
      {children}
    </h2>
  );
}

/** Uma seção de documento: eyebrow + título grande + o resto. Mesmo padrão em
 * toda a peça, para o olho aprender o ritmo depois da segunda seção. */
function DocSection({
  eyebrow,
  title,
  subtitle,
  children,
  breakBefore,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  breakBefore?: boolean;
}) {
  return (
    <section className={`mt-8 ${breakBefore ? "break-before-page" : "break-inside-avoid-page"}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <DocHeading>{title}</DocHeading>
      {subtitle && (
        <p style={{ color: INK_SOFT }} className="mt-1.5 max-w-[46rem] text-[12px] leading-relaxed">
          {subtitle}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Card de KPI do cabeçalho — número grande, legenda pequena. */
function HeroStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ borderColor: LINE }} className="border-t-2 pt-2.5" >
      <p style={{ color: INK_SOFT, letterSpacing: "0.08em" }} className="text-[9px] font-bold uppercase">
        {label}
      </p>
      <p style={{ color: NAVY }} className="font-poppins mt-0.5 text-[22px] font-extrabold leading-none tabular-nums">
        {value}
      </p>
      {hint && (
        <p style={{ color: INK_SOFT }} className="mt-1 text-[10px] leading-snug">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A escada "onde cada real parou": barra horizontal com o valor dentro e o
 * custo do degrau ao lado — o mesmo gráfico que ancorou o relatório original. */
function Waterfall({ steps }: { steps: MonthlyReport["ladder"] }) {
  const max = Math.max(...steps.map((step) => step.value), 1);
  return (
    <div className="space-y-1.5">
      {steps.map((step) => {
        const widthPct = Math.max((step.value / max) * 100, 1);
        // O valor fica numa coluna própria, nunca dentro da barra: nos degraus
        // de baixo (1 fechamento contra 39 mil impressões) a barra tem poucos
        // pixels e o número dentro dela saía cortado pela metade.
        return (
          <div key={step.label} className="flex items-center gap-2">
            <span style={{ color: INK }} className="w-[104px] flex-none text-[10.5px] font-semibold">
              {step.label}
            </span>
            <span style={{ color: NAVY }} className="w-[54px] flex-none text-right text-[10.5px] font-bold tabular-nums">
              {formatNumber(step.value)}
            </span>
            <div className="h-[14px] flex-1" style={{ background: "#f1f6f9" }}>
              <div
                style={{ width: `${widthPct}%`, background: `linear-gradient(90deg, ${NAVY}, ${CYAN_STRONG})` }}
                className="h-full"
              />
            </div>
            <span style={{ color: INK_SOFT }} className="w-[148px] flex-none text-right text-[9.5px] leading-tight">
              {step.costLabel ?? ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Barras verticais dia a dia: gasto (barra) e cadastros (número embaixo). */
function DailyChart({ series }: { series: MonthlyReport["series"] }) {
  const days = series.filter((point) => point.spend > 0 || point.cadastrosCrm > 0);
  if (days.length === 0) return null;
  const maxSpend = Math.max(...days.map((d) => d.spend), 1);
  const maxLeads = Math.max(...days.map((d) => d.cadastrosCrm), 1);
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: 110 }}>
        {days.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col justify-end" style={{ height: "100%" }}>
            <div
              title={`${d.date}: ${formatCurrency(d.spend)}`}
              style={{ height: `${Math.max((d.spend / maxSpend) * 100, 2)}%`, background: CYAN_STRONG }}
            />
          </div>
        ))}
      </div>
      <div className="mt-[3px] flex items-start gap-[3px]" style={{ height: 46 }}>
        {days.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col">
            <div
              title={`${d.date}: ${d.cadastrosCrm} cadastros`}
              style={{ height: `${Math.max((d.cadastrosCrm / maxLeads) * 34, 1)}px`, background: "#f5a524" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {days.map((d) => (
          <span
            key={d.date}
            style={{ color: INK_SOFT }}
            className="flex-1 text-center text-[7.5px] tabular-nums"
          >
            {d.date.slice(8, 10)}
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-4 text-[9px]" style={{ color: INK_SOFT }}>
        <span>
          <span style={{ background: CYAN_STRONG }} className="mr-1 inline-block h-2 w-2 align-middle" /> gasto por dia
          (pico {formatCurrency(maxSpend)})
        </span>
        <span>
          <span style={{ background: "#f5a524" }} className="mr-1 inline-block h-2 w-2 align-middle" /> cadastros (pico{" "}
          {formatNumber(maxLeads)})
        </span>
      </div>
    </div>
  );
}

/** Uma linha de comparação com o período anterior. A cor da variação segue
 * `lowerIsBetter`: custo por cadastro caindo é verde, não vermelho. */
function DeltaRow({
  label,
  delta,
  format,
}: {
  label: string;
  delta: ReportDelta | undefined;
  format: (value: number) => string;
}) {
  if (!delta) return null;
  const subiu = (delta.deltaPct ?? 0) >= 0;
  const bom = delta.lowerIsBetter ? !subiu : subiu;
  return (
    <div style={{ borderColor: LINE }} className="flex items-baseline justify-between border-b py-1.5 last:border-0">
      <span style={{ color: INK }} className="text-[11px] font-medium">
        {label}
      </span>
      <span className="flex items-baseline gap-2.5 text-[11px] tabular-nums">
        {delta.previous !== null && (
          <span style={{ color: INK_SOFT }}>
            {format(delta.previous)} →
          </span>
        )}
        <span style={{ color: NAVY }} className="font-bold">
          {format(delta.current)}
        </span>
        {delta.deltaPct !== null ? (
          <span style={{ color: bom ? GOOD : BAD_TEXT }} className="w-[62px] text-right font-bold">
            {subiu ? "▲" : "▼"} {formatPercent(Math.abs(delta.deltaPct))}
          </span>
        ) : (
          <span style={{ color: INK_SOFT }} className="w-[62px] text-right">
            sem base
          </span>
        )}
      </span>
    </div>
  );
}

/** Composição da verba: uma barra empilhada com rótulos. */
function BudgetSplit({ parts, total }: { parts: Array<{ label: string; value: number; color: string }>; total: number }) {
  const visible = parts.filter((part) => part.value > 0);
  if (visible.length === 0 || total <= 0) return null;
  return (
    <div>
      <div className="flex h-[22px] w-full overflow-hidden">
        {visible.map((part) => (
          <div
            key={part.label}
            style={{ width: `${(part.value / total) * 100}%`, background: part.color }}
            title={`${part.label}: ${formatCurrency(part.value)}`}
          />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
        {visible.map((part) => (
          <div key={part.label} className="flex items-baseline justify-between text-[10.5px]">
            <span style={{ color: INK }}>
              <span style={{ background: part.color }} className="mr-1.5 inline-block h-2 w-2 align-middle" />
              {part.label}
            </span>
            <span style={{ color: NAVY }} className="font-bold tabular-nums">
              {formatCurrency(part.value)} · {formatPercent((part.value / total) * 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Caixa de destaque com barra lateral colorida — para o achado que dói, o
 * aviso, ou qualquer parágrafo que precise se destacar do corpo do texto. */
function Callout({
  tone,
  eyebrow,
  title,
  children,
}: {
  tone: "warn" | "bad" | "good" | "navy";
  eyebrow?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const palette = {
    warn: { text: WARN_TEXT, wash: WARN_WASH, line: WARN_LINE },
    bad: { text: BAD_TEXT, wash: BAD_WASH, line: BAD_LINE },
    good: { text: GOOD, wash: GOOD_WASH, line: "#c7e8dd" },
    navy: { text: NAVY, wash: CYAN_WASH, line: "#bfe7f4" },
  }[tone];
  return (
    <div
      style={{ background: palette.wash, borderColor: palette.line, borderLeftColor: palette.text, borderLeftWidth: 3 }}
      className="break-inside-avoid-page border border-l-[3px] p-3.5"
    >
      {eyebrow && (
        <p style={{ color: palette.text, letterSpacing: "0.1em" }} className="text-[9px] font-bold uppercase">
          {eyebrow}
        </p>
      )}
      {title && (
        <p style={{ color: palette.text }} className="font-poppins mt-0.5 text-[13px] font-bold">
          {title}
        </p>
      )}
      <div style={{ color: INK }} className="mt-1 text-[11.5px] leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function DocTable({
  columns,
  rows,
}: {
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, React.ReactNode>>;
}) {
  return (
    <table className="w-full border-collapse text-[10.5px]">
      <thead>
        <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
          {columns.map((col) => (
            <th
              key={col.key}
              style={{ color: NAVY, textAlign: col.align ?? "left" }}
              className="pb-1.5 pr-3 text-[9px] font-bold uppercase tracking-wide"
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: `1px solid ${LINE}` }} className="break-inside-avoid">
            {columns.map((col) => (
              <td
                key={col.key}
                style={{ textAlign: col.align ?? "left", color: INK }}
                className="py-1.5 pr-3 tabular-nums"
              >
                {row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HorizontalBars({
  items,
  totalLabel,
}: {
  items: Array<{ label: string; value: number; sharePct: number }>;
  totalLabel: string;
}) {
  const max = Math.max(...items.map((item) => item.sharePct), 1);
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span style={{ color: INK }} className="w-[92px] flex-none text-[10px] font-medium">
            {item.label}
          </span>
          <div className="h-[13px] flex-1" style={{ background: "#f1f6f9" }}>
            <div
              style={{ width: `${Math.max((item.sharePct / max) * 100, 2)}%`, background: CYAN }}
              className="h-full"
            />
          </div>
          <span style={{ color: NAVY }} className="w-[80px] flex-none text-right text-[10px] font-bold tabular-nums">
            {formatPercent(item.sharePct)} · {formatNumber(item.value)}
          </span>
        </div>
      ))}
      <p style={{ color: INK_SOFT }} className="pt-0.5 text-[9.5px]">
        {totalLabel}
      </p>
    </div>
  );
}

// ─── O documento ────────────────────────────────────────────────────────

export default function CampaignReportDocument({ report, segments, narrative, google }: Props) {
  const { investment, conversion, financial, creatives, arrival, blindSpots } = report;

  const topCreatives = creatives.melhores.slice(0, 6);
  const worstDestination = [...report.destinations].filter((d) => d.cadastros > 0).sort(
    (a, b) => (b.custoPorCadastro ?? 0) - (a.custoPorCadastro ?? 0)
  )[0];
  const bestDestination = [...report.destinations].filter((d) => d.cadastros > 0).sort(
    (a, b) => (a.custoPorCadastro ?? Infinity) - (b.custoPorCadastro ?? Infinity)
  )[0];

  return (
    <div style={{ background: PAPER, color: INK }} className="font-sans mx-auto max-w-[880px]">
      {/* @page é uma regra global de folha de estilo, mas só existe no DOM
          enquanto este componente está montado — ou seja, só quando a aba
          Relatórios está aberta. Outros consumidores de window.print() no
          app (RelatoriosClient, ExportMenu, TaskPdfReport, RankingClient)
          continuam na paisagem A4 padrão do globals.css; este documento é
          retrato, como o relatório editorial que ele imita. */}
      <style>{`@media print { @page { size: A4 portrait; margin: 14mm 12mm; } }`}</style>

      {/* ── Capa ── */}
      <header style={{ borderBottom: `3px solid ${NAVY}` }} className="pb-4">
        <div className="flex items-baseline justify-between">
          <Eyebrow>VozUP · Escola de Oratória · Relatório de Mídia Paga</Eyebrow>
          <span style={{ color: INK_SOFT }} className="text-[9.5px]">
            {formatDayShort(report.from)} a {formatDayShort(report.to)}
          </span>
        </div>
        <h1
          style={{ color: NAVY }}
          className="font-poppins mt-2 text-[32px] font-extrabold leading-[1.08] text-balance"
        >
          {narrative?.titulo?.trim()
            ? narrative.titulo
            : `${formatCurrency(investment.total)} investidos, ${formatNumber(conversion.cadastros)} cadastros no período`}
        </h1>
        {narrative?.lede && (
          <p style={{ color: INK_SOFT }} className="mt-2 max-w-[52rem] text-[12.5px] leading-relaxed">
            {narrative.lede}
          </p>
        )}
      </header>

      {/* ── KPIs ── */}
      <div className="mt-5 grid grid-cols-4 gap-4">
        <HeroStat label="Investido" value={formatCurrency(investment.total)} hint={`${investment.diasComEntrega} dias com entrega`} />
        <HeroStat
          label="Cadastros"
          value={formatNumber(conversion.cadastros)}
          hint={`${formatNullableCurrency(conversion.custoPorCadastro)} por cadastro`}
        />
        <HeroStat
          label="Agendamentos"
          value={formatNumber(conversion.agendados)}
          hint={conversion.agendados > 0 ? `${formatNullableCurrency(
            conversion.custoPorCadastro && conversion.agendados
              ? investment.conversao / conversion.agendados
              : null
          )} cada` : "nenhum no período"}
        />
        <HeroStat
          label="Retorno medido"
          value={financial.retorno !== null ? formatCurrency(financial.retorno) : "sem base"}
          hint={
            financial.roas !== null
              ? `${financial.roas.toFixed(2)}× o investido em captação`
              : "nenhuma matrícula vinculada"
          }
        />
      </div>

      {/* ── Onde cada real parou ── */}
      <DocSection
        eyebrow="O retrato"
        title="Onde cada real parou"
        subtitle="Cada degrau mostra o custo de chegar até ali. O último é o que precisa de atenção."
      >
        <Waterfall steps={report.ladder} />
      </DocSection>

      {/* ── Dia a dia ── */}
      {report.series.length > 0 && (
        <DocSection
          eyebrow="Evolução"
          title="Dia a dia: gasto e cadastros"
          subtitle="A barra azul é o gasto do dia; a laranja embaixo, os cadastros que entraram nele."
        >
          <DailyChart series={report.series} />
        </DocSection>
      )}

      {/* ── Comparação com o período anterior ── */}
      {report.comparison && (
        <DocSection
          eyebrow="Comparação"
          title={`Contra ${report.comparison.previousLabel}`}
          subtitle="Verde é melhora, vermelho é piora — já considerando que custo caindo é bom."
        >
          <div style={{ borderColor: LINE }} className="border px-3.5 py-1">
            <DeltaRow label="Investimento total" delta={report.comparison.investimento} format={formatCurrency} />
            <DeltaRow label="Investimento em conversão" delta={report.comparison.investimentoConversao} format={formatCurrency} />
            <DeltaRow label="Cadastros" delta={report.comparison.cadastros} format={formatNumber} />
            <DeltaRow label="Pessoas novas" delta={report.comparison.pessoas} format={formatNumber} />
            <DeltaRow label="Custo por cadastro" delta={report.comparison.custoPorCadastro} format={formatCurrency} />
            <DeltaRow label="Impressões" delta={report.comparison.impressoes} format={formatNumber} />
            <DeltaRow label="Vendas registradas" delta={report.comparison.ganhos} format={formatNumber} />
          </div>
        </DocSection>
      )}

      {/* ── Para onde foi a verba ── */}
      <DocSection
        eyebrow="Orçamento"
        title="Para onde foi cada real"
        subtitle="Primeiro entre plataformas, depois entre formatos dentro do Meta."
      >
        <div className="space-y-4">
          <div>
            <p style={{ color: NAVY, letterSpacing: "0.08em" }} className="mb-1.5 text-[9px] font-bold uppercase">
              Por plataforma · total {formatCurrency(investment.total + (google?.totals.costBrl ?? 0))}
            </p>
            <BudgetSplit
              total={investment.total + (google?.totals.costBrl ?? 0)}
              parts={[
                { label: "Meta · conversão", value: investment.conversao, color: NAVY },
                { label: "Meta · engajamento", value: investment.engajamento, color: CYAN },
                { label: "Google Ads", value: google?.totals.costBrl ?? 0, color: "#f5a524" },
              ]}
            />
          </div>
          {creatives.formatos.length > 0 && (
            <div>
              <p style={{ color: NAVY, letterSpacing: "0.08em" }} className="mb-1.5 text-[9px] font-bold uppercase">
                Dentro do Meta, por formato — e o que cada um rendeu
              </p>
              <BudgetSplit
                total={creatives.formatos.reduce((sum, f) => sum + f.spend, 0)}
                parts={creatives.formatos.map((f, i) => ({
                  label: f.label,
                  value: f.spend,
                  color: i === 0 ? CYAN_STRONG : "#8bb8cc",
                }))}
              />
              <div className="mt-2">
                <DocTable
                  columns={[
                    { key: "f", label: "Formato" },
                    { key: "pecas", label: "Peças", align: "right" },
                    { key: "verba", label: "% da verba", align: "right" },
                    { key: "cad", label: "Cadastros", align: "right" },
                    { key: "share", label: "% dos cadastros", align: "right" },
                    { key: "cpl", label: "Custo/cadastro", align: "right" },
                  ]}
                  rows={creatives.formatos.map((f) => ({
                    f: <span style={{ fontWeight: 600 }}>{f.label}</span>,
                    pecas: formatNumber(f.pecas),
                    verba: formatPercent(f.sharePct),
                    cad: formatNumber(f.cadastros),
                    share: formatPercent(f.cadastrosSharePct),
                    cpl: <span style={{ fontWeight: 700 }}>{formatNullableCurrency(f.custoPorCadastro)}</span>,
                  }))}
                />
              </div>
            </div>
          )}
        </div>
      </DocSection>

      {/* ── Achado principal (callout, estilo "O número que dói") ── */}
      {narrative?.sections?.[0] && (
        <div className="mt-5">
          <Callout tone="warn" eyebrow={narrative.sections[0].eyebrow} title={narrative.sections[0].title}>
            {narrative.sections[0].body}
          </Callout>
        </div>
      )}

      {/* ── Meta × Google, quando os dois existem ── */}
      {google && google.hasData && (
        <DocSection eyebrow="Mídia" title="Meta e Google, lado a lado">
          <div className="grid grid-cols-2 gap-4">
            <div style={{ borderColor: LINE }} className="border p-3">
              <p style={{ color: NAVY }} className="font-poppins text-[13px] font-bold">
                Meta
              </p>
              <p style={{ color: INK }} className="mt-1 text-[11px] leading-relaxed">
                {formatCurrency(investment.total)} · {formatNumber(conversion.impressions)} impressões ·{" "}
                {formatNumber(conversion.clicks)} cliques · CTR {formatPercent(conversion.ctr)} ·{" "}
                {formatNullableCurrency(conversion.custoPorCadastro)} por cadastro
              </p>
            </div>
            <div style={{ borderColor: LINE }} className="border p-3">
              <p style={{ color: NAVY }} className="font-poppins text-[13px] font-bold">
                Google Ads
              </p>
              <p style={{ color: INK }} className="mt-1 text-[11px] leading-relaxed">
                {formatCurrency(google.totals.costBrl)} · {formatNumber(google.totals.impressions)} impressões ·{" "}
                {formatNumber(google.totals.clicks)} cliques · CTR {formatPercent(google.totals.ctr)} ·{" "}
                {formatNullableCurrency(google.totals.costPerCrmLeadBrl)} por lead real
              </p>
            </div>
          </div>
        </DocSection>
      )}

      {/* ── Destino: nativo × landing pages ── */}
      {report.destinations.length > 0 && (
        <DocSection
          eyebrow="A virada"
          title="Formulário nativo × landing page"
          subtitle="Mesma conta, mesma equipe — o destino é a única variável."
        >
          <DocTable
            columns={[
              { key: "dest", label: "Destino" },
              { key: "inv", label: "Investido", align: "right" },
              { key: "ctr", label: "CTR", align: "right" },
              { key: "cad", label: "Cadastros", align: "right" },
              { key: "cpl", label: "Custo/cadastro", align: "right" },
              { key: "ag", label: "Agendaram", align: "right" },
            ]}
            rows={report.destinations.map((d) => ({
              dest: <span style={{ fontWeight: 600 }}>{d.label}</span>,
              inv: formatCurrency(d.spend),
              ctr: formatPercent(d.ctr),
              cad: formatNumber(d.cadastros),
              cpl: (
                <span
                  style={{
                    fontWeight: 700,
                    color: d.key === bestDestination?.key ? GOOD : d.key === worstDestination?.key ? BAD_TEXT : INK,
                  }}
                >
                  {formatNullableCurrency(d.custoPorCadastro)}
                </span>
              ),
              ag: formatNumber(d.agendados),
            }))}
          />
        </DocSection>
      )}

      {/* ── Públicos ── */}
      {report.audiences.length > 0 && (
        <DocSection eyebrow="Públicos" title="Quais conjuntos respondem mais barato">
          <DocTable
            columns={[
              { key: "pub", label: "Conjunto" },
              { key: "inv", label: "Investido", align: "right" },
              { key: "cpm", label: "CPM", align: "right" },
              { key: "ctr", label: "CTR", align: "right" },
              { key: "cad", label: "Cadastros", align: "right" },
              { key: "cpl", label: "Custo/cadastro", align: "right" },
            ]}
            rows={[...report.audiences]
              .sort((a, b) => (a.custoPorCadastro ?? Infinity) - (b.custoPorCadastro ?? Infinity))
              .slice(0, 12)
              .map((a) => ({
                pub: a.label,
                inv: formatCurrency(a.spend),
                cpm: formatNullableCurrency(a.cpm),
                ctr: formatPercent(a.ctr),
                cad: formatNumber(a.cadastros),
                cpl: <span style={{ fontWeight: 700 }}>{formatNullableCurrency(a.custoPorCadastro)}</span>,
              }))}
          />
        </DocSection>
      )}

      {/* ── Formato e criativo ── */}
      {creatives.formatos.length > 0 && (
        <DocSection eyebrow="Formato e criativo" title="Vídeo × imagem, e as peças que se pagaram" breakBefore>
          <div className="grid grid-cols-2 gap-4">
            {creatives.formatos.map((f) => (
              <div key={f.label} style={{ background: CYAN_WASH }} className="p-3">
                <p style={{ color: CYAN_STRONG, letterSpacing: "0.08em" }} className="text-[9px] font-bold uppercase">
                  {f.label} · {f.pecas} peças
                </p>
                <p style={{ color: NAVY }} className="font-poppins mt-0.5 text-[20px] font-extrabold tabular-nums">
                  {formatNullableCurrency(f.custoPorCadastro)}
                </p>
                <p style={{ color: INK_SOFT }} className="text-[10px]">
                  por cadastro
                </p>
                <p style={{ color: INK }} className="mt-1.5 text-[10px] leading-snug">
                  {formatPercent(f.sharePct)} da verba · {formatPercent(f.cadastrosSharePct)} dos cadastros · CPM{" "}
                  {formatNullableCurrency(f.cpm)} · CTR {formatPercent(f.ctr)}
                </p>
              </div>
            ))}
          </div>

          {topCreatives.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {topCreatives.map((c) => (
                <div key={c.label} style={{ borderColor: LINE }} className="break-inside-avoid-page border">
                  <div style={{ background: "#0a1620" }} className="flex aspect-[4/3] items-center justify-center overflow-hidden">
                    {c.thumbnailUrl ? (
                      // Imagem externa (Meta CDN) — <img> puro, mesmo padrão de CampaignAdsGallery.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnailUrl} alt={c.label} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[9px] text-white/40">sem miniatura</span>
                    )}
                  </div>
                  <div className="p-2">
                    <p style={{ color: NAVY }} className="truncate text-[10px] font-bold">
                      {c.label}
                    </p>
                    <p style={{ color: INK_SOFT }} className="text-[9px]">
                      {c.formato} · {formatNumber(c.cadastros)} cadastro{c.cadastros === 1 ? "" : "s"}
                    </p>
                    <p style={{ color: GOOD }} className="text-[11px] font-bold tabular-nums">
                      {formatNullableCurrency(c.custoPorCadastro)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {creatives.desperdicio && creatives.desperdicio.pecas > 0 && (
            <div className="mt-3">
              <Callout
                tone="bad"
                eyebrow={`${formatCurrency(creatives.desperdicio.spend)} · ${creatives.desperdicio.pecas} peça${
                  creatives.desperdicio.pecas === 1 ? "" : "s"
                }`}
              >
                {creatives.desperdicio.labels.slice(0, 9).join(", ")}{" "}
                {creatives.desperdicio.pecas === 1 ? "consumiu" : "consumiram"}{" "}
                {formatPercent(creatives.desperdicio.sharePct)} do investimento para{" "}
                {formatNumber(creatives.desperdicio.cadastros)} cadastro{creatives.desperdicio.cadastros === 1 ? "" : "s"} a{" "}
                {formatNullableCurrency(creatives.desperdicio.custoPorCadastro)} cada — sem nenhum agendamento.
              </Callout>
            </div>
          )}
        </DocSection>
      )}

      {/* ── Funil comercial por origem ── */}
      {segments && segments.rows.length > 0 && (
        <DocSection
          eyebrow="Funil comercial"
          title="Do cadastro ao fechamento, por origem"
          subtitle="Só quem entrou no Kanban. Compare canais pela coluna agenda/atendido: ela isola a qualidade do lead do esforço da equipe."
          breakBefore
        >
          <DocTable
            columns={[
              { key: "origem", label: "Origem" },
              { key: "funil", label: "No funil", align: "right" },
              { key: "atend", label: "Atendidos", align: "right" },
              { key: "agend", label: "Agendaram", align: "right" },
              { key: "fech", label: "Fecharam", align: "right" },
              { key: "taxa", label: "Agenda/atendido", align: "right" },
            ]}
            rows={segments.rows.map((row) => ({
              // "Landing Pages VozUP" é o nome da pasta no CRM, mas quem lê o
              // relatório precisa saber que aquilo é tráfego orgânico (link na
              // bio, busca), não uma campanha paga.
              origem: `${row.emoji} ${row.label}${ORIGIN_HINT[row.key] ?? ""}`,
              funil: formatNumber(row.cadastros),
              atend: formatNumber(row.atendidos),
              agend: formatNumber(row.agendaram),
              fech: formatNumber(row.fecharam),
              taxa: <span style={{ fontWeight: 700 }}>{formatPercent(row.taxaAgendamentoAtendidos)}</span>,
            }))}
          />
          {segments.totals.fechamentoRevertido > 0 && (
            <div className="mt-3">
              <Callout tone="warn" eyebrow="Sinal de alerta">
                {formatNumber(segments.totals.fechamentoRevertido)}{" "}
                passagem(ns) pela etapa Fechado foram desfeitas no período — venda que voltou atrás não conta como
                fechamento. Fica fora do que a tabela acima chama de &quot;fecharam&quot;.
              </Callout>
            </div>
          )}
        </DocSection>
      )}

      {/* ── Seções da análise (IA), como corpo do documento ── */}
      {narrative && narrative.sections.length > 1 && (
        <>
          {narrative.sections.slice(1).map((section) => (
            <DocSection key={section.title} eyebrow={section.eyebrow} title={section.title}>
              <p style={{ color: INK }} className="max-w-[52rem] text-[12px] leading-relaxed">
                {section.body}
              </p>
            </DocSection>
          ))}
        </>
      )}

      {/* ── Quando o lead chega ── */}
      {arrival && arrival.total > 0 && (
        <DocSection
          eyebrow="Operação"
          title="Quando o lead chega"
          subtitle="O anúncio roda 24 horas; o atendimento, não. O pico de chegada é o horário que a escala precisa cobrir."
          breakBefore
        >
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p style={{ color: NAVY, letterSpacing: "0.08em" }} className="mb-1.5 text-[9px] font-bold uppercase">
                Por período do dia
              </p>
              <HorizontalBars
                items={arrival.blocos.map((b) => ({ label: b.label, value: b.leads, sharePct: b.sharePct }))}
                totalLabel={`${arrival.total} leads com horário registrado`}
              />
            </div>
            <div>
              <p style={{ color: NAVY, letterSpacing: "0.08em" }} className="mb-1.5 text-[9px] font-bold uppercase">
                Por dia da semana
              </p>
              <HorizontalBars
                items={arrival.dias.map((d) => ({ label: d.label, value: d.leads, sharePct: d.sharePct }))}
                totalLabel={
                  arrival.foraDoComercialPct !== null
                    ? `${formatPercent(arrival.foraDoComercialPct)} chegam fora do horário comercial`
                    : ""
                }
              />
            </div>
          </div>
        </DocSection>
      )}

      {/* ── Vendedores × origem ── */}
      {segments && segments.vendedores.length > 0 && (
        <DocSection
          eyebrow="Equipe"
          title="Quem recebeu o quê, e de qual origem"
          subtitle="Todos os responsáveis, com a origem de cada lead. Diferente da tabela do Meta, aqui entram também os leads orgânicos, de aula exclusiva e do Google."
          breakBefore
        >
          <div className="space-y-2.5">
            {segments.vendedores.map((seller) => (
              <div key={seller.sellerName} style={{ borderColor: LINE }} className="break-inside-avoid-page border p-3">
                <div className="flex items-baseline justify-between">
                  <span style={{ color: NAVY }} className="font-poppins text-[13px] font-bold">
                    {seller.sellerName}
                  </span>
                  <span className="text-[10.5px] tabular-nums" style={{ color: INK }}>
                    <strong>{formatNumber(seller.leads)}</strong> leads ·{" "}
                    <strong>{formatNumber(seller.agendaram)}</strong> agendaram ({formatPercent(seller.taxaAgendamento)}) ·{" "}
                    <strong>{formatNumber(seller.fecharam)}</strong> fecharam
                    {seller.valorFechado > 0 && (
                      <span style={{ color: GOOD }}> · {formatCurrency(seller.valorFechado)}</span>
                    )}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {seller.porOrigem.map((origem) => (
                    <span
                      key={origem.originKey}
                      style={{ background: CYAN_WASH, color: INK }}
                      className="px-2 py-1 text-[9.5px] tabular-nums"
                    >
                      {origem.originEmoji} {origem.originLabel}: <strong>{formatNumber(origem.leads)}</strong>
                      {origem.agendaram > 0 && <span style={{ color: GOOD }}> · {origem.agendaram} ag</span>}
                      {origem.fecharam > 0 && <span style={{ color: GOOD }}> · {origem.fecharam} fe</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DocSection>
      )}

      {/* ── Venda a venda ── */}
      {report.sales && report.sales.linhas.length > 0 && (
        <DocSection
          eyebrow="Receita"
          title="As vendas do período, uma a uma"
          subtitle="Só matrícula registrada no Financeiro. Etapa do CRM não é receita."
        >
          <DocTable
            columns={[
              { key: "aluno", label: "Aluno" },
              { key: "data", label: "Data" },
              { key: "curso", label: "Curso" },
              { key: "origem", label: "Veio de" },
              { key: "vendedor", label: "Vendedor" },
              { key: "valor", label: "Valor", align: "right" },
            ]}
            rows={report.sales.linhas.map((linha) => ({
              aluno: <span style={{ fontWeight: 600 }}>{linha.student}</span>,
              data: formatDayShort(linha.saleDate),
              curso: linha.course ?? "—",
              origem: (
                <span style={{ color: INK_SOFT }} className="text-[9.5px]">
                  {linha.origemLabel}
                  {linha.adName ? ` · ${linha.adName}` : ""}
                  {linha.linkKind === "nome" && (
                    <span style={{ color: WARN_TEXT }}> (conciliado por nome)</span>
                  )}
                </span>
              ),
              vendedor: linha.seller ?? "—",
              valor: <span style={{ fontWeight: 700, color: GOOD }}>{formatCurrency(linha.amount)}</span>,
            }))}
          />
          <p style={{ color: INK_SOFT }} className="mt-2 text-[9.5px] leading-relaxed">
            {formatNumber(report.sales.vinculoDireto)} venda(s) com vínculo declarado a partir do lead e{" "}
            {formatNumber(report.sales.vinculoPorNome)} conciliada(s) por nome do aluno.{" "}
            {formatNumber(report.sales.campanhasSemVenda)} campanha(s) gastaram no período sem fechar nenhuma venda.
          </p>
        </DocSection>
      )}

      {/* ── Ações ── */}
      {narrative && narrative.actions.length > 0 && (
        <DocSection eyebrow="Plano" title="O que fazer com o próximo real" breakBefore>
          <div className="grid grid-cols-2 gap-3">
            {narrative.actions.map((action) => {
              const tag = URGENCY_TAG[action.urgency] ?? URGENCY_TAG.testar;
              return (
                <div key={action.title} style={{ borderColor: LINE }} className="break-inside-avoid-page border p-3">
                  <span
                    style={{ background: tag.wash, color: tag.text, letterSpacing: "0.06em" }}
                    className="inline-block px-1.5 py-0.5 text-[8.5px] font-bold uppercase"
                  >
                    {tag.label}
                  </span>
                  <p style={{ color: NAVY }} className="font-poppins mt-1.5 text-[12px] font-bold leading-snug">
                    {action.title}
                  </p>
                  <p style={{ color: INK_SOFT }} className="mt-1 text-[10.5px] leading-relaxed">
                    {action.rationale}
                  </p>
                </div>
              );
            })}
          </div>
        </DocSection>
      )}

      {/* ── Pontos cegos ── */}
      {(blindSpots.length > 0 || (narrative?.blindSpots?.length ?? 0) > 0) && (
        <DocSection
          eyebrow="Pontos cegos"
          title="O que estes dados ainda não conseguem responder"
          subtitle="Dito aqui para ninguém concluir além do que foi medido."
        >
          <div style={{ borderColor: LINE }} className="space-y-2.5 border p-3.5">
            {/* A narrativa, quando existe, já reescreve os pontos cegos
                determinísticos com o contexto do período — mostrar as duas
                listas juntas repetia o mesmo texto duas vezes na mesma caixa. */}
            {narrative && narrative.blindSpots.length > 0
              ? narrative.blindSpots.map((text, i) => (
                  <p key={`n-${i}`} style={{ color: INK }} className="text-[11px] leading-relaxed">
                    {text}
                  </p>
                ))
              : blindSpots.map((spot) => (
                  <p key={spot.label} style={{ color: INK }} className="text-[11px] leading-relaxed">
                    <span
                      style={{ background: WARN_WASH, color: WARN_TEXT }}
                      className="mr-1.5 inline-block px-1.5 py-0.5 text-[8.5px] font-bold uppercase"
                    >
                      {spot.label}
                    </span>
                    {spot.text}
                  </p>
                ))}
          </div>
        </DocSection>
      )}

      {/* ── Rodapé metodológico ── */}
      <footer style={{ borderTop: `1px solid ${LINE}`, color: INK_SOFT }} className="mt-8 pt-3 text-[9px] leading-relaxed">
        <p>
          Fonte: Meta Ads (sincronização automática){google?.hasData ? " e Google Ads" : ""} cruzados com os leads do
          CRM VozUP. Cadastros são formulários enviados (inclui quem já existia); pessoas novas são só os contatos
          inéditos. Agendamento é a passagem pela etapa Agendado no histórico do funil — quem agendou e depois foi
          para outra etapa continua contando. Fechamento, ao contrário, conta pela etapa atual: passagem revertida
          não é venda. {report.parcial ? "Período ainda em andamento — números sujeitos a mudar." : ""}
        </p>
        {narrative && (
          <p className="mt-1.5">
            Análise escrita por {narrative.model} em{" "}
            {new Date(narrative.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Os números
            vêm do banco; a IA só os interpreta.
          </p>
        )}
      </footer>
    </div>
  );
}
