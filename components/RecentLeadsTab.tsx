"use client";

import { useMemo, useState } from "react";
import { Clock, Mail, MessageCircle, RotateCcw, UserRound } from "lucide-react";
import { readableCampaignName } from "@/lib/metaAdsLabels";
import CreativeLightbox from "@/components/CreativeLightbox";
import CreativeThumb from "@/components/CreativeThumb";
import { useOpenLeadProfile } from "@/components/LeadProfileLauncher";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";
import type { CreativeVisual, FunnelStageKind, RecentAdLead } from "@/types/metaAds";

interface RecentLeadsTabProps {
  leads: RecentAdLead[];
  scoped: boolean;
}

const STAGE_KIND_STYLE: Record<FunnelStageKind, string> = {
  entry: "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]",
  normal: "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]",
  won: "bg-[rgb(224_248_243)] text-[rgb(var(--teal-9))]",
  lost: "bg-[rgb(var(--ruby-3))] text-[rgb(var(--ruby-11))]",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function initials(name: string | null): string {
  const clean = humanizeName(name ?? "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toLocaleUpperCase("pt-BR");
}

export default function RecentLeadsTab({ leads, scoped }: RecentLeadsTabProps) {
  const withoutSeller = useMemo(() => leads.filter((l) => !l.sellerName).length, [leads]);
  const [lightboxCreative, setLightboxCreative] = useState<CreativeVisual | null>(null);
  const openLead = useOpenLeadProfile();

  return (
    <section aria-labelledby="recent-leads-heading" className="space-y-4">
      <div>
        <h2 id="recent-leads-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
          Últimos leads que chegaram
        </h2>
        <p className="text-sm text-[rgb(var(--slate-10))]">
          Quem se cadastrou pelos anúncios{scoped ? " deste recorte" : ""} no período, do mais recente pro mais antigo — com o
          anúncio de origem, a etapa atual e o vendedor responsável.
        </p>
      </div>

      {leads.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-[rgb(var(--slate-3))] px-3 py-1 font-semibold text-[rgb(var(--slate-11))]">
              {leads.length.toLocaleString("pt-BR")} cadastro{leads.length === 1 ? "" : "s"}
            </span>
            {withoutSeller > 0 ? (
              <span className="rounded-full bg-[rgb(255_247_224)] px-3 py-1 font-semibold text-[rgb(139_94_0)]">
                {withoutSeller.toLocaleString("pt-BR")} sem vendedor
              </span>
            ) : null}
          </div>

          <ul className="divide-y divide-[rgb(var(--border-weak))] overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
            {leads.map((lead) => (
              <li key={lead.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--blue-3))] text-xs font-semibold text-[rgb(var(--blue-11))]">
                    {initials(lead.nome)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {openLead ? (
                        <button
                          type="button"
                          onClick={() => openLead(lead.id)}
                          className="truncate text-left text-sm font-semibold text-[rgb(var(--slate-12))] underline-offset-2 hover:text-[rgb(var(--blue-11))] hover:underline"
                          title="Abrir a ficha completa deste lead"
                        >
                          {humanizeName(lead.nome) || "Sem nome"}
                        </button>
                      ) : (
                        <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">
                          {humanizeName(lead.nome) || "Sem nome"}
                        </p>
                      )}
                      {lead.bucket !== "novo" ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                            lead.bucket === "recontato"
                              ? "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
                              : "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]"
                          }`}
                          title={
                            lead.bucket === "recontato"
                              ? "Já era da base e voltou por este anúncio."
                              : "Mesma pessoa preencheu de novo dentro deste período."
                          }
                        >
                          <RotateCcw className="h-3 w-3" /> {lead.bucket === "recontato" ? "Já existia" : "Repetido"}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[rgb(var(--slate-9))]" title={fullDate(lead.criadoEm)}>
                      <Clock className="h-3 w-3" /> {timeAgo(lead.criadoEm)}
                    </p>
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                      <CreativeThumb creative={lead} onOpen={() => setLightboxCreative(lead)} />
                      <p
                        className="min-w-0 truncate text-xs text-[rgb(var(--slate-10))]"
                        title={`${lead.campaignName} → ${lead.adsetName} → ${lead.adName}`}
                      >
                        <span className="font-medium text-[rgb(var(--slate-11))]">{lead.adName}</span>
                        <span className="text-[rgb(var(--slate-8))]"> · {readableCampaignName(lead.campaignName)}</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-shrink-0 flex-wrap items-center gap-2 pl-12 sm:pl-0">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                      STAGE_KIND_STYLE[lead.stageKind ?? "entry"]
                    }`}
                  >
                    {lead.stageLabel ?? "Novo"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-[rgb(var(--slate-2))] px-2 py-0.5 text-xs text-[rgb(var(--slate-11))]">
                    <UserRound className="h-3 w-3 text-[rgb(var(--slate-9))]" />
                    {lead.sellerName ?? "Sem vendedor"}
                  </span>
                  {lead.telefone ? (
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
                  ) : null}
                  {lead.email ? (
                    <a
                      href={`mailto:${lead.email}`}
                      className="rounded-md p-1.5 text-[rgb(var(--slate-9))] hover:bg-[rgb(var(--slate-3))]"
                      aria-label="Enviar e-mail"
                    >
                      <Mail className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
          Nenhum lead de anúncio chegou neste recorte e período.
        </div>
      )}

      {lightboxCreative ? (
        <CreativeLightbox
          key={lightboxCreative.adName}
          ad={lightboxCreative}
          onClose={() => setLightboxCreative(null)}
        />
      ) : null}
    </section>
  );
}
