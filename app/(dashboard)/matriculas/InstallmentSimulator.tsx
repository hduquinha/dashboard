"use client";

import { useState } from "react";
import { Calculator, ChevronDown } from "lucide-react";
import type { FinanceCatalog } from "@/types/finance";

/**
 * Simulador de parcelamento — quanto fica cada parcela, com a taxa da bandeira
 * descontada.
 *
 * Vive ao lado das matrículas porque é ferramenta de VENDA: serve para montar a
 * proposta antes de existir contrato. Ficava na aba Matrículas da Gestão
 * Financeira, ocupando o topo de uma tela que é de fechamento contábil.
 * Aqui entra recolhido, para não empurrar a carteira para baixo.
 */

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function parseNumber(value: string) {
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Mesma divisão do servidor: centavos exatos, com a última parcela absorvendo o resto. */
function splitCents(total: number, count: number): number[] {
  const parts = Math.max(1, Math.trunc(count));
  const cents = Math.max(0, Math.round(total * 100));
  const base = Math.floor(cents / parts);
  const remainder = cents - base * parts;
  return Array.from({ length: parts }, (_, index) => (base + (index === parts - 1 ? remainder : 0)) / 100);
}

export default function InstallmentSimulator({ catalog }: { catalog: FinanceCatalog }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(3000);
  const [installments, setInstallments] = useState(4);
  const [brandId, setBrandId] = useState<number | null>(null);

  const parts = splitCents(amount, installments);
  const rate = catalog.installmentRates.find((item) => item.installments === installments && item.brandId === brandId)?.ratePct ?? 0;
  const liquidoTotal = parts.reduce((sum, part) => sum + (part - (part * rate) / 100), 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50"
      >
        <span className="flex items-center gap-3">
          <Calculator className="text-cyan-700" size={19} />
          <span>
            <span className="block text-base font-black text-slate-950">Simulador de parcelamento</span>
            <span className="block text-sm text-slate-500">Valor, taxa da bandeira e quanto sobra líquido por parcela.</span>
          </span>
        </span>
        <ChevronDown className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} size={20} />
      </button>

      {open ? (
        <div className="grid gap-5 border-t border-slate-100 p-5 lg:grid-cols-[320px_1fr]">
          <div className="grid gap-3">
            <label>
              <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Valor do curso</span>
              <input
                defaultValue={amount}
                onChange={(event) => setAmount(Math.max(0, parseNumber(event.target.value)))}
                inputMode="decimal"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-500"
              />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Bandeira do cartão</span>
              <select
                value={brandId ?? ""}
                onChange={(event) => setBrandId(event.target.value ? Number(event.target.value) : null)}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-500"
              >
                <option value="">Padrão (sem bandeira)</option>
                {catalog.cardBrands.filter((item) => item.active).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <input type="range" min={1} max={24} value={installments} onChange={(event) => setInstallments(Number(event.target.value))} />
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
              <span>{installments}x</span>
              <span>Taxa {rate.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAmount((value) => Math.max(0, value - 500))} className="h-10 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">− R$ 500</button>
              <button type="button" onClick={() => setAmount((value) => value + 500)} className="h-10 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">+ R$ 500</button>
            </div>
            <div className="rounded-lg border border-cyan-100 bg-cyan-50 p-3">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-cyan-700">Líquido total</p>
              <p className="mt-1 text-xl font-black text-cyan-950">{money(liquidoTotal)}</p>
            </div>
          </div>
          <div className="grid max-h-[360px] gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-4">
            {parts.map((part, index) => (
              <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Parcela {index + 1}</p>
                <p className="mt-2 text-xl font-black text-slate-950">{money(part)}</p>
                <p className="mt-1 text-xs text-slate-500">Líquido {money(part - (part * rate) / 100)}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
