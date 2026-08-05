"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, Layers, Mail, MessageCircle, Play, RotateCcw, X } from "lucide-react";
import { AdDestination } from "@/components/AdDestination";
import { costPer } from "@/lib/adDestinationGroups";
import { formatCurrency, formatNullableCurrency, formatPercent } from "@/lib/campaignFormat";
import { readableAdsetName } from "@/lib/metaAdsLabels";
import { useOpenLeadProfile } from "@/components/LeadProfileLauncher";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";
import type { AdLeadSummary, AdRow, FunnelStageDef, LeadBucket, MetaAdsFilters } from "@/types/metaAds";

interface AdDetailModalProps {
  /** Criativo agregado (soma dos `ad_id` de mesmo nome). */
  ad: AdRow;
  /** Anúncios reais que compõem o criativo — quando há mais de um, o mesmo
   * criativo roda em vários conjuntos e mostramos a distribuição. Ausente/1 =
   * anúncio único (visão granular por conjunto). */
  members?: AdRow[];
  filters: Pick<MetaAdsFilters, "from" | "to">;
  stageDefs: FunnelStageDef[];
  /** Abre o criativo (imagem plena / vídeo) em tela cheia. */
  onOpenCreative: () => void;
  onClose: () => void;
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

/** "Já existia" cobria dois casos que significam coisas opostas para quem
 * compra mídia: quem preencheu duas vezes agora (não é contato a mais) e quem
 * é da base antiga e voltou (é gente de verdade). Separar os rótulos é o que
 * torna a coluna "Cadastros" auditável olho a olho. */
function BucketBadge({ bucket }: { bucket: LeadBucket }) {
  if (bucket === "novo") return null;
  const isRecontato = bucket === "recontato";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
        isRecontato
          ? "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
          : "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]"
      }`}
      title={
        isRecontato
          ? "Já era da base antes deste período e voltou por este anúncio — conta em Cadastros, não em Novos."
          : "Mesma pessoa preencheu de novo dentro deste período — não conta duas vezes."
      }
    >
      <RotateCcw className="h-3 w-3" /> {isRecontato ? "Já existia" : "Repetido"}
    </span>
  );
}

export default function AdDetailModal({ ad, members, filters, stageDefs, onOpenCreative, onClose }: AdDetailModalProps) {
  const [leads, setLeads] = useState<AdLeadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openLead = useOpenLeadProfile();

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
              <button
                type="button"
                onClick={onOpenCreative}
                aria-label={`Ver criativo do anúncio ${ad.adName} em tela cheia`}
                className="group relative h-28 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-[rgb(var(--slate-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))] sm:h-36 sm:w-44"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- imagem vem direto do CDN do Meta */}
                <img
                  src={ad.imageUrl ?? ad.thumbnailUrl ?? ""}
                  alt={`Criativo do anúncio ${ad.adName}`}
                  className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                />
                <span className="absolute inset-0 bg-black/0 transition group-hover:bg-black/20" />
                {ad.videoId ? (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white">
                      <Play className="h-4 w-4 translate-x-0.5" fill="currentColor" />
                    </span>
                  </span>
                ) : null}
              </button>
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
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
            <div className="rounded-lg bg-[rgb(var(--slate-2))] p-3" title="A Meta conta ENVIO de formulário, não pessoa.">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">Meta marcou</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{ad.leadsMeta}</p>
            </div>
            <div className="rounded-lg bg-[rgb(var(--slate-2))] p-3" title="Preenchimentos que chegaram aqui, inclusive repetido e descartado — a régua comparável com a Meta.">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">Envios</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{ad.envios}</p>
            </div>
            <div className="rounded-lg bg-[rgb(var(--slate-2))] p-3" title="Pessoas que este anúncio trouxe: inéditas + as que já eram da base.">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">Cadastros</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{ad.cadastrosCrm}</p>
            </div>
            <div className="rounded-lg bg-[rgb(var(--slate-2))] p-3" title="Pessoas inéditas no CRM.">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">Novos</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{ad.novos}</p>
            </div>
            <div className="rounded-lg bg-[rgb(var(--blue-2))] p-3" title="Gasto ÷ cadastros salvos deste criativo no período.">
              <p className="text-[10px] font-semibold uppercase text-[rgb(var(--blue-11))]">Custo/lead</p>
              <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">
                {formatNullableCurrency(costPer(ad.spend, ad.cadastrosCrm))}
              </p>
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
                      <th className="px-3 py-2 text-right font-semibold">Novos</th>
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
                        <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--slate-12))]">{member.novos}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] font-semibold text-[rgb(var(--slate-12))]">
                    <tr>
                      <td className="px-3 py-2">Total do criativo</td>
                      <td className="px-3 py-2 text-right tabular-nums">{ad.leadsMeta}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{ad.cadastrosCrm}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{ad.novos}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Lista de leads: mostra TODO envio que chegou (menos os descartados
              à mão), com o rótulo de cada um. Contar só as pessoas aqui
              esconderia justamente a linha que explica por que "Envios" é maior
              que "Cadastros" — que é o que a pessoa veio conferir. */}
          <h4 className="mb-2 text-sm font-semibold text-[rgb(var(--slate-12))]">
            Quem chegou por este {breakdown ? "criativo" : "anúncio"} {leads ? `(${leads.length})` : ""}
          </h4>
          {leads && leads.some((lead) => lead.bucket !== "novo") ? (
            <p className="mb-2 text-xs text-[rgb(var(--slate-9))]">
              Os marcados como <strong>Repetido</strong> são a mesma pessoa preenchendo de novo e não entram em
              Cadastros; os marcados como <strong>Já existia</strong> entram em Cadastros, mas não em Novos.
            </p>
          ) : null}
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
                    {openLead ? (
                      <button
                        type="button"
                        onClick={() => openLead(lead.id)}
                        className="truncate text-left text-sm font-medium text-[rgb(var(--slate-12))] underline-offset-2 hover:text-[rgb(var(--blue-11))] hover:underline"
                        title="Abrir a ficha completa deste lead"
                      >
                        {humanizeName(lead.nome) || "Sem nome"}
                      </button>
                    ) : (
                      <p className="truncate text-sm font-medium text-[rgb(var(--slate-12))]">
                        {humanizeName(lead.nome) || "Sem nome"}
                      </p>
                    )}
                    <p className="text-xs text-[rgb(var(--slate-9))]">{formatDate(lead.criadoEm)}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <BucketBadge bucket={lead.bucket} />
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
