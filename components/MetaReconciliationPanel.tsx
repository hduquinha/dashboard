"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, RefreshCw } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/campaignFormat";
import type { MetaReconciliation, ReconciliationLine } from "@/types/metaAds";

/**
 * Conferência da tela contra o gerenciador da Meta, sempre visível.
 *
 * A régua é diferente dos dois lados e isso é intencional: gasto, impressões,
 * cliques e "leads marcados" vêm da Meta e TÊM que bater — divergiu, a janela é
 * ressincronizada sozinha. Já cadastro é PESSOA no CRM, enquanto lead na Meta é
 * ENVIO de formulário; a mesma pessoa preenchendo duas vezes são dois leads lá e
 * uma pessoa aqui. Por isso o painel abre a ponte entre os dois números em vez
 * de tentar igualá-los.
 */
export default function MetaReconciliationPanel({ data }: { data: MetaReconciliation }) {
  const [open, setOpen] = useState(false);

  const tone =
    data.status === "divergente"
      ? { border: "border-amber-300", bg: "bg-amber-50", text: "text-amber-900" }
      : data.status === "indisponivel"
        ? { border: "border-[rgb(var(--border-weak))]", bg: "bg-[rgb(var(--slate-2))]", text: "text-[rgb(var(--slate-11))]" }
        : { border: "border-emerald-200", bg: "bg-emerald-50", text: "text-emerald-900" };

  // Dia em andamento nunca fecha ao centavo — dizer isso é diferente de dizer
  // que está tudo idêntico, e evita que a pessoa desconfie do painel à toa.
  const sufixoParcial = data.parcial ? " O dia de hoje ainda está sendo contabilizado pela Meta." : "";
  const resumo =
    data.status === "ok"
      ? `Confere com o gerenciador da Meta: gasto, impressões, cliques e leads idênticos.${sufixoParcial}`
      : data.status === "ajustado"
        ? `Havia diferença; a janela foi ressincronizada agora e voltou a bater com a Meta.${sufixoParcial}`
        : data.status === "indisponivel"
          ? "Não deu para falar com a Meta agora — números do último sincronismo."
          : `Diferença em relação à Meta que a ressincronização não resolveu. Veja abaixo.${sufixoParcial}`;

  return (
    <section className={`rounded-xl border ${tone.border} ${tone.bg} px-4 py-3 print:hidden`} aria-label="Conferência com a Meta">
      <div className="flex flex-wrap items-center gap-3">
        {data.status === "divergente" ? (
          <AlertTriangle className={`h-4 w-4 flex-none ${tone.text}`} />
        ) : data.status === "ajustado" ? (
          <RefreshCw className={`h-4 w-4 flex-none ${tone.text}`} />
        ) : (
          <CheckCircle2 className={`h-4 w-4 flex-none ${tone.text}`} />
        )}
        <p className={`text-sm font-medium ${tone.text}`}>{resumo}</p>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={`ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${tone.text} hover:underline`}
        >
          {open ? "Fechar" : "Ver a conferência"}
          <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open ? (
        <div className="mt-3 grid gap-4 border-t border-[rgb(var(--border-weak))] pt-3 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">
              Mídia — tem que bater com a Meta
            </h3>
            <table className="mt-2 w-full text-xs">
              <thead className="text-[rgb(var(--slate-9))]">
                <tr>
                  <th scope="col" className="py-1 text-left font-medium">Métrica</th>
                  <th scope="col" className="py-1 text-right font-medium">Meta</th>
                  <th scope="col" className="py-1 text-right font-medium">Nesta tela</th>
                  <th scope="col" className="py-1 text-right font-medium">Diferença</th>
                </tr>
              </thead>
              <tbody className="text-[rgb(var(--slate-12))]">
                <Linha rotulo="Investimento" linha={data.spend} money />
                <Linha rotulo="Impressões" linha={data.impressions} />
                <Linha rotulo="Cliques" linha={data.clicks} />
                <Linha rotulo="Leads marcados pela Meta" linha={data.leads} />
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">
              Do lead da Meta à pessoa no CRM
            </h3>
            <ul className="mt-2 space-y-1 text-xs text-[rgb(var(--slate-11))]">
              <li className="flex justify-between gap-3">
                <span>Leads marcados pela Meta</span>
                <strong className="tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(data.leads.meta)}</strong>
              </li>
              <li className="flex justify-between gap-3 border-t border-[rgb(var(--border-weak))] pt-1 font-semibold text-[rgb(var(--slate-12))]">
                <span>Envios que chegaram aqui com anúncio identificado</span>
                <strong className="tabular-nums">{formatNumber(data.crm.envios)}</strong>
              </li>
              <li className="flex justify-between gap-3 pl-3">
                <span>− Descartados à mão (teste/lixo)</span>
                <strong className="tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(data.crm.excluidos)}</strong>
              </li>
              <li className="flex justify-between gap-3 pl-3">
                <span>− Mesma pessoa preencheu de novo no período</span>
                <strong className="tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(data.crm.duplicados)}</strong>
              </li>
              <li className="flex justify-between gap-3 pl-3">
                <span>Já era da base e voltou pelo anúncio</span>
                <strong className="tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(data.crm.recontatos)}</strong>
              </li>
              <li className="flex justify-between gap-3 pl-3">
                <span>Pessoas inéditas no CRM</span>
                <strong className="tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(data.crm.novos)}</strong>
              </li>
              <li className="flex justify-between gap-3 border-t border-[rgb(var(--border-weak))] pt-1 font-semibold text-[rgb(var(--slate-12))]">
                <span>= Cadastros na tela (inéditas + voltaram)</span>
                <strong className="tabular-nums">{formatNumber(data.crm.pessoas)}</strong>
              </li>
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-[rgb(var(--slate-9))]">
              É <strong>Envios</strong> que se compara com o número da Meta — os dois contam preenchimento de
              formulário. <strong>Cadastros</strong> conta pessoa, e por isso é menor. A folga que sobra entre os dois
              primeiros números são os envios que a Meta atribui pelo clique de até 7 dias antes, que podem cair em
              outro período aqui.
              {data.crm.semAnuncio > 0
                ? ` Fora isso, ${formatNumber(data.crm.semAnuncio)} cadastro(s) do período vieram com marca de anúncio que não é anúncio pago (link da bio, por exemplo) e ficam fora desta conta.`
                : ""}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Linha({ rotulo, linha, money = false }: { rotulo: string; linha: ReconciliationLine; money?: boolean }) {
  const fmt = (value: number) => (money ? formatCurrency(value) : formatNumber(value));
  return (
    <tr className="border-t border-[rgb(var(--border-weak))]">
      <th scope="row" className="py-1 text-left font-normal">{rotulo}</th>
      <td className="py-1 text-right tabular-nums">{fmt(linha.meta)}</td>
      <td className="py-1 text-right tabular-nums">{fmt(linha.dash)}</td>
      <td className={`py-1 text-right tabular-nums ${linha.ok ? "text-emerald-700" : "font-semibold text-amber-700"}`}>
        {linha.ok ? "—" : `${linha.diff > 0 ? "+" : ""}${fmt(linha.diff)}`}
      </td>
    </tr>
  );
}
