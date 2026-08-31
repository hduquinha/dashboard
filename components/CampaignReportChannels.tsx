"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/campaignFormat";
import type { ReportNarrative } from "@/lib/reportNarrative";
import type { ReportSegmentsData } from "@/lib/reportSegments";

const URGENCY_LABEL: Record<string, string> = {
  agora: "Fazer agora",
  "esta-semana": "Esta semana",
  testar: "Teste A/B",
  habilitar: "Habilitar",
};

interface Props {
  segments: ReportSegmentsData;
  periodLabel: string;
  /** Números de mídia já renderizados na tela, enviados à análise para ela não
   * ter que adivinhar investimento (foi a lacuna que a própria IA apontou). */
  media: Record<string, number | null>;
  /** Controlado pelo pai (CampaignMonthlyReportTab): o documento impresso usa
   * a mesma análise gerada aqui, em vez de cada um guardar a sua. */
  narrative: ReportNarrative | null;
  onNarrativeChange: (narrative: ReportNarrative) => void;
}

export default function CampaignReportChannels({ segments, periodLabel, media, narrative, onNarrativeChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { rows, totals, revenueLink } = segments;

  async function gerar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/campanhas/report-narrative", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: segments.from, to: segments.to, periodLabel, media }),
      });
      const data = (await res.json()) as { narrative?: ReportNarrative; error?: string };
      if (!res.ok || !data.narrative) {
        setError(data.error ?? "Não consegui gerar a análise.");
        return;
      }
      onNarrativeChange(data.narrative);
    } catch {
      setError("Falha de rede ao gerar a análise.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="canais-heading" className="space-y-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--slate-9))]">Canais</p>
          <h2 id="canais-heading" className="text-xl font-bold text-[rgb(var(--slate-12))]">
            Do cadastro ao fechamento, por origem
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[rgb(var(--slate-10))]">
            Só quem entrou no Kanban. Lead que nunca foi para o funil não diz nada sobre a qualidade do canal — ele
            aparece na coluna &quot;fora&quot; e fica fora de todas as taxas. Compare canais pela coluna{" "}
            <strong>agenda/atendido</strong>: ela isola a qualidade do lead do esforço da equipe.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] text-[11px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Origem</th>
                <th className="px-3 py-2 text-right font-semibold">No funil</th>
                <th className="px-3 py-2 text-right font-semibold">Fora</th>
                <th className="px-3 py-2 text-right font-semibold">Atendidos</th>
                <th className="px-3 py-2 text-right font-semibold">Agendaram</th>
                <th className="px-3 py-2 text-right font-semibold">Fecharam</th>
                <th className="px-3 py-2 text-right font-semibold">Revertidos</th>
                <th className="px-3 py-2 text-right font-semibold">Agenda/atendido</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-[rgb(var(--border-weak))] last:border-0">
                  <td className="px-3 py-2 font-medium text-[rgb(var(--slate-12))]">
                    {row.emoji} {row.label}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatNumber(row.cadastros)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--slate-9))]">
                    {row.foraDoKanban > 0 ? formatNumber(row.foraDoKanban) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.atendidos)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.agendaram)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatNumber(row.fecharam)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.fechamentoRevertido > 0 ? (
                      <span className="rounded bg-[rgb(255_247_224)] px-1.5 py-0.5 font-semibold text-[rgb(139_94_0)]">
                        {formatNumber(row.fechamentoRevertido)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {formatPercent(row.taxaAgendamentoAtendidos)}
                  </td>
                </tr>
              ))}
              <tr className="bg-[rgb(var(--slate-2))] font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.cadastros)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.foraDoKanban)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.atendidos)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.agendaram)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.fecharam)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.fechamentoRevertido)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPercent(totals.taxaAgendamentoAtendidos)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {totals.fechamentoRevertido > 0 && (
          <div className="rounded-xl border border-[rgb(240_224_170)] bg-[rgb(255_247_224)] p-4">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-[rgb(139_94_0)]" />
              <p className="text-sm leading-relaxed text-[rgb(120_82_0)]">
                <strong>
                  {formatNumber(totals.fechamentoRevertido)} passagem(ns) pela etapa Fechado foram desfeitas
                </strong>{" "}
                — o lead voltou para Perdido, Novo ou Compra Futura. Fechamento aqui conta pela etapa atual, não pelo
                histórico: venda que voltou atrás não aconteceu. Enquanto a etapa Fechado for usada como rascunho,
                contagem de venda pelo Kanban não fecha com o Financeiro.
              </p>
            </div>
          </div>
        )}

        <p className="text-xs text-[rgb(var(--slate-9))]">
          Receita atribuível no período: {formatCurrency(revenueLink.valorComLead)} de{" "}
          {formatCurrency(revenueLink.valorTotal)} ({formatPercent(revenueLink.coberturaPct)} das matrículas têm lead
          vinculado). Matrícula lançada direto no Financeiro, sem passar pela etapa Fechado, não tem origem e fica fora
          de qualquer leitura por canal.
        </p>
      </section>

      <section aria-labelledby="analise-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--slate-9))]">Leitura</p>
            <h2 id="analise-heading" className="text-xl font-bold text-[rgb(var(--slate-12))]">
              Análise do período
            </h2>
          </div>
          <button
            type="button"
            onClick={gerar}
            disabled={loading}
            data-print-hidden="true"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[rgb(var(--blue-7))] bg-[rgb(var(--blue-3))] px-3 py-2 text-sm font-semibold text-[rgb(var(--blue-11))] transition hover:brightness-105 disabled:opacity-60 print:hidden"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Escrevendo… (~1 min)" : narrative ? "Gerar de novo" : "Gerar análise"}
          </button>
        </div>

        {error && (
          <p className="rounded-xl border border-[rgb(235_195_186)] bg-[rgb(252_239_236)] p-3 text-sm text-[rgb(163_55_42)]">
            {error}
          </p>
        )}

        {!narrative && !loading && !error && (
          <p className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] p-4 text-sm text-[rgb(var(--slate-9))]">
            Os números acima e do resto do relatório são calculados aqui, em SQL. A análise escrita é gerada por IA
            sobre esses números — ela não calcula nada, só interpreta. Leva cerca de um minuto.
          </p>
        )}

        {narrative && (
          <div className="space-y-5">
            <p className="text-base leading-relaxed text-[rgb(var(--slate-12))]">{narrative.lede}</p>

            {narrative.sections.map((section) => (
              <div key={`${section.eyebrow}-${section.title}`} className="border-l-2 border-[rgb(var(--blue-7))] pl-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--slate-9))]">
                  {section.eyebrow}
                </p>
                <h3 className="mt-0.5 text-base font-bold text-[rgb(var(--slate-12))]">{section.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--slate-11))]">{section.body}</p>
              </div>
            ))}

            {narrative.actions.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-base font-bold text-[rgb(var(--slate-12))]">O que fazer</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {narrative.actions.map((action) => (
                    <div
                      key={action.title}
                      className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3"
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="rounded bg-[rgb(var(--slate-3))] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-11))]">
                          {URGENCY_LABEL[action.urgency] ?? action.urgency}
                        </span>
                        <span className="text-sm font-semibold text-[rgb(var(--slate-12))]">{action.title}</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--slate-10))]">{action.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {narrative.blindSpots.length > 0 && (
              <div>
                <h3 className="text-base font-bold text-[rgb(var(--slate-12))]">O que estes dados não respondem</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[rgb(var(--slate-10))]">
                  {narrative.blindSpots.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-[rgb(var(--slate-9))]">
              Análise escrita por {narrative.model} em{" "}
              {new Date(narrative.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Os números
              vêm do banco; a IA só os interpreta.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
