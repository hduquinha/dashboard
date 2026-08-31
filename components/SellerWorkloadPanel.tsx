"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Users } from "lucide-react";

export interface SellerInsight {
  sellerId: number;
  total: number;
  repique: number;
  byStage: Array<{ key: string; label: string; count: number }>;
  byOrigin: Array<{ key: string; label: string; count: number }>;
}

interface SellerWorkloadPanelProps {
  sellers: Array<{ chatwootUserId: number; name: string; email: string | null }>;
  insights: SellerInsight[];
}

/**
 * Carga da equipe, acima da lista de leads a distribuir.
 *
 * Existe para o distribuidor parar de decidir de cabeça: mostra quantos leads
 * ativos cada um tem, como estão divididos por etapa e por origem, quantos
 * estão em cada etapa e quantos estão parados no repique.
 */
export function SellerWorkloadPanel({ sellers, insights }: SellerWorkloadPanelProps) {
  const [open, setOpen] = useState(true);
  const [expandido, setExpandido] = useState<number | null>(null);

  const byId = new Map(insights.map((item) => [item.sellerId, item]));
  // Menor carteira primeiro facilita equilibrar a distribuição sem inferir se
  // alguém está disponível ou não a partir de um status manual.
  const ordenado = [...sellers].sort(
    (a, b) =>
      (byId.get(a.chatwootUserId)?.total ?? 0) - (byId.get(b.chatwootUserId)?.total ?? 0)
  );

  return (
    <section className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-[rgb(var(--slate-12))]">
          <Users className="h-4 w-4" />
          Equipe
          <span className="rounded-full bg-[rgb(var(--slate-2))] px-2 py-0.5 text-[11px] font-semibold text-[rgb(var(--slate-10))]">
            {sellers.length} vendedor(es)
          </span>
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-[rgb(var(--slate-10))]" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[rgb(var(--slate-10))]" />
        )}
      </button>

      {open && (
        <div className="grid gap-2 border-t border-[rgb(var(--border-weak))] p-3 sm:grid-cols-2 xl:grid-cols-3">
          {ordenado.map((seller) => {
            const info = byId.get(seller.chatwootUserId);
            const aberto = expandido === seller.chatwootUserId;

            return (
              <div
                key={seller.chatwootUserId}
                className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))] p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-[rgb(var(--slate-12))]">{seller.name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-base font-black leading-none text-[rgb(var(--slate-12))]">
                      {info?.total ?? 0}
                    </p>
                    <p className="text-[9px] font-semibold uppercase text-[rgb(var(--slate-10))]">
                      ativos
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {(info?.repique ?? 0) > 0 && (
                    <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                      {info?.repique} em repique
                    </span>
                  )}
                  {(info?.byStage ?? []).slice(0, 3).map((stage) => (
                    <span
                      key={stage.key}
                      className="rounded-md bg-[rgb(var(--slate-2))] px-1.5 py-0.5 text-[10px] font-semibold text-[rgb(var(--slate-11))]"
                    >
                      {stage.label} {stage.count}
                    </span>
                  ))}
                </div>

                {((info?.byStage.length ?? 0) > 3 || (info?.byOrigin.length ?? 0) > 0) && (
                  <button
                    type="button"
                    onClick={() => setExpandido(aberto ? null : seller.chatwootUserId)}
                    className="mt-1.5 text-[10px] font-semibold text-[rgb(var(--blue-11))] hover:underline"
                  >
                    {aberto ? "menos" : "ver etapas e origens"}
                  </button>
                )}

                {aberto && (
                  <div className="mt-1.5 space-y-1.5 border-t border-[rgb(var(--border-weak))] pt-1.5">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">
                        Por etapa
                      </p>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {(info?.byStage ?? []).map((stage) => (
                          <span
                            key={stage.key}
                            className="rounded bg-[rgb(var(--slate-2))] px-1.5 py-0.5 text-[10px] text-[rgb(var(--slate-11))]"
                          >
                            {stage.label} {stage.count}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">
                        Por origem
                      </p>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {(info?.byOrigin ?? []).slice(0, 8).map((origin) => (
                          <span
                            key={origin.key}
                            className="max-w-full truncate rounded bg-[rgb(var(--blue-3))] px-1.5 py-0.5 text-[10px] text-[rgb(var(--blue-11))]"
                            title={origin.label}
                          >
                            {origin.label} {origin.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
