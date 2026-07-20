"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, Layers, Mail, MessageCircle, RotateCcw, X } from "lucide-react";
import { AdDestination } from "@/components/AdDestination";
import { readableAdsetName } from "@/lib/metaAdsLabels";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";
import type { AdLeadSummary, AdRow, FunnelStageDef, MetaAdsFilters } from "@/types/metaAds";

interface AdDetailModalProps {
  /** Criativo agregado (soma dos `ad_id` de mesmo nome). */
  ad: AdRow;
  /** Anúncios reais que compõem o criativo — quando há mais de um, o mesmo
   * criativo roda em vários conjuntos e mostramos a distribuição. Ausente/1 =
   * anúncio único (visão granular por conjunto). */
  members?: AdRow[];
  filters: Pick<MetaAdsFilters, "from" | "to">;
  stageDefs: FunnelStageDef[];
  onClose: () => void;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: string) {
  const isActive = status === "ACTIVE";
  const label =
    status === "ACTIVE"
      ? "Em veiculação"
      : status === "CAMPAIGN_PAUSED"
        ? "Campanha pausada"
        : status === "ADSET_PAUSED"
          ? "Conjunto pausado"
          : status === "PAUSED"
            ? "Anúncio pausado"
            : status.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold uppercase ${
        isActive ? "bg-[rgb(224_248_243)] text-[rgb(var(--teal-9))]" : "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-10))]"
      }`}
    >
      {label}
    </span>
  );
}

const STAGE_BADGE_COLOR: Record<string, string> = {
  won: "bg-[rgb(224_248_243)] text-[rgb(var(--teal-9))]",
  lost: "bg-[rgb(var(--ruby-3))] text-[rgb(var(--ruby-11))]",
};

function stageBadge(label: string | null, kind: string | null) {
  if (!label) return <span className="text-xs text-[rgb(var(--slate-9))]">—</span>;
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
        (kind && STAGE_BADGE_COLOR[kind]) || "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]"
      }`}
    >
      {label}
    </span>
  );
}

export default function AdDetailModal({ ad, members, filters, stageDefs, onClose }: AdDetailModalProps) {
  const [leads, setLeads] = useState<AdLeadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Um card é um criativo; busca os cadastros de TODOS os `ad_id` que ele roda.
  const adIdsKey = useMemo(
    () => (members && members.length > 0 ? members : [ad]).map((m) => m.adId).join(","),
    [members, ad]
  );
  const breakdown = useMemo(
    () =>
      members && members.length > 1
        ? [...members].sort((a, b) => b.leadsMeta - a.leadsMeta || b.cadastrosCrm - a.cadastrosCrm)
        : null,
    [members]
  );

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ adId: adIdsKey, from: filters.from, to: filters.to });
    fetch(`/api/campanhas/leads?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setLeads(data.leads ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Falha ao carregar leads.");
      });

    return () => {
      cancelled = true;
    };
  }, [adIdsKey, filters.from, filters.to]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const nonEntryStages = stageDefs.filter((s) => s.kind !== "entry");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ad-detail-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-[rgb(var(--surface-1))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border-weak))] p-4">
          <div className="flex items-start gap-3">
            {ad.imageUrl ?? ad.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- imagem vem direto do CDN do Meta
              <img
                src={ad.imageUrl ?? ad.thumbnailUrl ?? ""}
                alt={`Criativo do anúncio ${ad.adName}`}
                className="h-28 w-24 flex-shrink-0 rounded-lg bg-[rgb(var(--slate-2))] object-contain sm:h-36 sm:w-44"
              />
            ) : (
              <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--slate-3))]">
                <ImageOff className="h-6 w-6 text-[rgb(var(--slate-8))]" />
              </div>
            )}
            <div>
              <h3 id="ad-detail-title" className="text-base font-semibold text-[rgb(var(--slate-12))]">{ad.adName}</h3>
              <p className="text-xs text-[rgb(var(--slate-9))]">
                {breakdown ? (
                  <span className="inline-flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    Roda em {breakdown.length} conjuntos
                  </span>
                ) : (
                  `${ad.campaignName} → ${ad.adsetName}`
                )}
              </p>
              <div className="mt-1">{statusBadge(ad.effectiveStatus ?? ad.status)}</div>
            </div>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            className="rounded-md p-1.5 text-[rgb(var(--slate-9))] hover:bg-[rgb(var(--slate-3))] hover:text-[rgb(var(--slate-12))]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          <AdDestination landingUrl={ad.landingUrl} />

          {/* Métricas */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg bg-[rgb(var(--slate-2))] p-3">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">Gasto</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{formatCurrency(ad.spend)}</p>
            </div>
            <div className="rounded-lg bg-[rgb(var(--slate-2))] p-3">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">Cliques</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{ad.clicks}</p>
            </div>
            <div className="rounded-lg bg-[rgb(var(--slate-2))] p-3" title="Percentual das exibições que gerou algum clique; não é quantidade de leads.">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">CTR</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{formatPercent(ad.ctr)}</p>
            </div>
            <div className="rounded-lg bg-[rgb(var(--slate-2))] p-3">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">Meta marcou</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{ad.leadsMeta}</p>
            </div>
            <div className="rounded-lg bg-[rgb(var(--slate-2))] p-3">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">Cadastros salvos</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{ad.cadastrosCrm}</p>
            </div>
            <div className="rounded-lg bg-[rgb(var(--slate-2))] p-3">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">Contatos novos</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{ad.leadsCrm}</p>
            </div>
          </div>

          {/* Etapas do funil */}
          <div className="mb-4 flex flex-wrap gap-2">
            {nonEntryStages.map((stage) => (
              <span
                key={stage.key}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
                  STAGE_BADGE_COLOR[stage.kind] ?? "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]"
                }`}
              >
                {stage.label}: <strong>{ad.stageCounts[stage.key] ?? 0}</strong>
              </span>
            ))}
          </div>

          {/* Distribuição por conjunto — só quando o criativo roda em vários.
              Torna visível por que "Meta marcou" e "Cadastros" não batem por
              conjunto (atribuições diferentes) mas fecham no total do criativo. */}
          {breakdown && (
            <div className="mb-4">
              <h4 className="mb-1 text-sm font-semibold text-[rgb(var(--slate-12))]">Distribuição por conjunto</h4>
              <p className="mb-2 text-xs leading-relaxed text-[rgb(var(--slate-9))]">
                A Meta divide os Leads entre os conjuntos com a atribuição dela; o CRM credita cada cadastro ao conjunto que a
                pessoa realmente clicou. Por isso um conjunto pode ter &ldquo;Meta&rdquo; sem &ldquo;Cadastro&rdquo; e o vizinho o
                contrário — no total do criativo acima os números se encontram.
              </p>
              <div className="overflow-x-auto rounded-lg border border-[rgb(var(--border-weak))]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[rgb(var(--slate-2))] text-[rgb(var(--slate-9))]">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Conjunto</th>
                      <th className="px-3 py-2 text-right font-semibold">Meta marcou</th>
                      <th className="px-3 py-2 text-right font-semibold">Cadastros</th>
                      <th className="px-3 py-2 text-right font-semibold">Contatos novos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgb(var(--border-weak))]">
                    {breakdown.map((member) => (
                      <tr key={member.adId}>
                        <td className="max-w-[16rem] truncate px-3 py-2 text-[rgb(var(--slate-11))]" title={member.adsetName}>
                          {readableAdsetName(member.adsetName)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--slate-12))]">{member.leadsMeta}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--slate-12))]">{member.cadastrosCrm}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--slate-12))]">{member.leadsCrm}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] font-semibold text-[rgb(var(--slate-12))]">
                    <tr>
                      <td className="px-3 py-2">Total do criativo</td>
                      <td className="px-3 py-2 text-right tabular-nums">{ad.leadsMeta}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{ad.cadastrosCrm}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{ad.leadsCrm}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Lista de leads */}
          <h4 className="mb-2 text-sm font-semibold text-[rgb(var(--slate-12))]">
            Cadastros recebidos por este {breakdown ? "criativo" : "anúncio"} {leads ? `(${leads.length})` : ""}
          </h4>
          {error && <p className="text-sm text-[rgb(var(--ruby-11))]">{error}</p>}
          {!error && leads === null && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-[rgb(var(--slate-3))]" />
              ))}
            </div>
          )}
          {leads !== null && leads.length === 0 && !error && (
            <p className="text-sm text-[rgb(var(--slate-10))]">Nenhum cadastro salvo associado a este anúncio nesse período.</p>
          )}
          {leads !== null && leads.length > 0 && (
            <ul className="divide-y divide-[rgb(var(--border-weak))] rounded-lg border border-[rgb(var(--border-weak))]">
              {leads.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[rgb(var(--slate-12))]">
                      {humanizeName(lead.nome) || "Sem nome"}
                    </p>
                    <p className="text-xs text-[rgb(var(--slate-9))]">{formatDate(lead.criadoEm)}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {lead.isReturning ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-[rgb(var(--blue-3))] px-2 py-0.5 text-xs font-medium text-[rgb(var(--blue-11))]">
                        <RotateCcw className="h-3 w-3" /> Já existia
                      </span>
                    ) : null}
                    {stageBadge(lead.stageLabel, lead.stageKind)}
                    {lead.telefone && (
                      <a
                        href={buildWhatsAppWebUrl(lead.telefone)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => openWhatsAppOnMobile(e, lead.telefone)}
                        className="rounded-md p-1.5 text-[rgb(var(--teal-9))] hover:bg-[rgb(var(--slate-3))]"
                        aria-label="Abrir WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    )}
                    {lead.email && (
                      <a
                        href={`mailto:${lead.email}`}
                        className="rounded-md p-1.5 text-[rgb(var(--slate-9))] hover:bg-[rgb(var(--slate-3))]"
                        aria-label="Enviar e-mail"
                      >
                        <Mail className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
