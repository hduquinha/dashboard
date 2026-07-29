"use client";

import { useMemo } from "react";
import { Trophy, Users } from "lucide-react";
import type { SellerAdPerformance } from "@/types/metaAds";

interface SellerPerformanceTabProps {
  sellers: SellerAdPerformance[];
  scoped: boolean;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${((part / whole) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
}

export default function SellerPerformanceTab({ sellers, scoped }: SellerPerformanceTabProps) {
  const { assigned, totals, maxLeads } = useMemo(() => {
    const assignedRows = sellers.filter((s) => s.sellerName);
    const totalsAcc = sellers.reduce(
      (acc, s) => ({
        leads: acc.leads + s.totalLeads,
        qualificados: acc.qualificados + s.qualificados,
        ganhos: acc.ganhos + s.ganhos,
        valor: acc.valor + s.valorFechado,
        semVendedor: acc.semVendedor + (s.sellerName ? 0 : s.totalLeads),
      }),
      { leads: 0, qualificados: 0, ganhos: 0, valor: 0, semVendedor: 0 }
    );
    const max = assignedRows.reduce((m, s) => Math.max(m, s.totalLeads), 0);
    return { assigned: assignedRows, totals: totalsAcc, maxLeads: max };
  }, [sellers]);

  const summary = [
    { label: "Leads de anúncio", value: formatNumber(totals.leads) },
    { label: "Com vendedor", value: formatNumber(totals.leads - totals.semVendedor) },
    { label: "Sem vendedor", value: formatNumber(totals.semVendedor), warn: totals.semVendedor > 0 },
    { label: "Qualificados", value: formatNumber(totals.qualificados) },
  ];

  return (
    <section aria-labelledby="seller-perf-heading" className="space-y-4">
      <div>
        <h2 id="seller-perf-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
          Desempenho por vendedor
        </h2>
        <p className="text-sm text-[rgb(var(--slate-10))]">
          Dos leads que vieram de anúncios{scoped ? " deste recorte" : ""} no período, quantos cada vendedor recebeu e como
          eles avançaram no funil.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.map((item) => (
          <div
            key={item.label}
            className={`rounded-lg border p-3 ${
              item.warn
                ? "border-[rgb(255_233_186)] bg-[rgb(255_247_224)]"
                : "border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]"
            }`}
          >
            <p className={`text-xs font-medium ${item.warn ? "text-[rgb(139_94_0)]" : "text-[rgb(var(--slate-10))]"}`}>{item.label}</p>
            <p className={`mt-0.5 text-xl font-semibold ${item.warn ? "text-[rgb(139_94_0)]" : "text-[rgb(var(--slate-12))]"}`}>
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {assigned.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
          <div className="hidden items-center gap-3 border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))] sm:flex">
            <span className="flex-1">Vendedor</span>
            <span className="w-16 text-right">Leads</span>
            <span className="w-20 text-right">Qualif.</span>
            <span className="w-16 text-right">Ganhos</span>
            <span className="w-20 text-right">Conversão</span>
            <span className="w-24 text-right">Valor</span>
          </div>
          <ul className="divide-y divide-[rgb(var(--border-weak))]">
            {assigned.map((seller, index) => (
              <li key={seller.sellerEmail ?? seller.sellerName} className="px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        index === 0
                          ? "bg-[rgb(255_247_224)] text-[rgb(139_94_0)]"
                          : "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]"
                      }`}
                    >
                      {index === 0 ? <Trophy className="h-4 w-4" /> : index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{seller.sellerName}</p>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--slate-3))]">
                        <div
                          className="h-full rounded-full bg-[rgb(var(--blue-9))]"
                          style={{ width: maxLeads > 0 ? `${(seller.totalLeads / maxLeads) * 100}%` : "0%" }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2 pl-10 text-right tabular-nums sm:flex sm:items-center sm:gap-0 sm:pl-0">
                    <span className="w-16 text-sm font-semibold text-[rgb(var(--slate-12))]">{formatNumber(seller.totalLeads)}</span>
                    <span className="w-20 text-sm text-[rgb(var(--slate-11))]">{formatNumber(seller.qualificados)}</span>
                    <span className="w-16 text-sm text-[rgb(var(--teal-9))]">{formatNumber(seller.ganhos)}</span>
                    <span className="w-20 text-sm text-[rgb(var(--slate-11))]">{formatPercent(seller.ganhos, seller.totalLeads)}</span>
                    <span className="w-24 text-sm font-medium text-[rgb(var(--slate-12))]">{formatCurrency(seller.valorFechado)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
          <Users className="h-8 w-8 text-[rgb(var(--slate-8))]" />
          {totals.semVendedor > 0
            ? "Há leads de anúncio no período, mas nenhum foi distribuído a um vendedor ainda."
            : "Nenhum lead de anúncio para esse recorte e período."}
        </div>
      )}
    </section>
  );
}
