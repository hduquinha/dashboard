"use client";

import { useState } from "react";
import { CalendarCheck2, MessageCircle, RotateCcw, UserRound } from "lucide-react";
import CreativeLightbox from "@/components/CreativeLightbox";
import CreativeThumb from "@/components/CreativeThumb";
import { useOpenLeadProfile } from "@/components/LeadProfileLauncher";
import { formatHourLabel, SCHEDULED_STAGE_KEY } from "@/lib/leadArrivalAnalysis";
import { readableCampaignName } from "@/lib/metaAdsLabels";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";
import type { AdLeadDetail, CreativeVisual, FunnelStageKind } from "@/types/metaAds";

const STAGE_KIND_STYLE: Record<FunnelStageKind, string> = {
  entry: "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]",
  normal: "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]",
  won: "bg-[rgb(224_248_243)] text-[rgb(var(--teal-9))]",
  lost: "bg-[rgb(var(--ruby-3))] text-[rgb(var(--ruby-11))]",
};

/** "2026-07-30" → "30/07". Trabalha na string porque a data já vem no fuso da
 * conta de anúncios — passar pelo `Date` do navegador poderia voltar um dia. */
function formatDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

function minuteOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

interface AdLeadListProps {
  leads: AdLeadDetail[];
  /** Mensagem quando a lista está vazia. */
  emptyLabel?: string;
  /** Esconde a hora de chegada — usar onde a própria lista JÁ é de uma hora só. */
  hideHour?: boolean;
}

/**
 * Lista de pessoas por trás de um número ("cadastros: 9"). É o mesmo bloco na
 * aba Horários (quem chegou naquela hora) e na aba Grupos (quem veio daquela
 * página), então vive num componente só — o gestor lê a mesma linha nos dois
 * lugares.
 */
export default function AdLeadList({ leads, emptyLabel = "Nenhum lead aqui.", hideHour }: AdLeadListProps) {
  const [lightboxCreative, setLightboxCreative] = useState<CreativeVisual | null>(null);
  const openLead = useOpenLeadProfile();

  if (leads.length === 0) {
    return <p className="px-4 py-3 text-xs text-[rgb(var(--slate-9))]">{emptyLabel}</p>;
  }

  return (
    <>
      <ul className="divide-y divide-[rgb(var(--border-weak))]">
        {leads.map((lead) => {
          const agendou = lead.etapasAlcancadas.includes(SCHEDULED_STAGE_KEY);
          return (
            <li
              key={lead.id}
              className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                {hideHour ? null : (
                  <span className="w-12 flex-shrink-0 rounded-md bg-[rgb(var(--slate-3))] px-1.5 py-1 text-center text-xs font-semibold tabular-nums text-[rgb(var(--slate-11))]">
                    {formatHourLabel(lead.hora)}
                  </span>
                )}
                <CreativeThumb creative={lead} onOpen={() => setLightboxCreative(lead)} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
                    {lead.bucket !== "novo" ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                          lead.bucket === "recontato"
                            ? "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
                            : "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]"
                        }`}
                        title={
                          lead.bucket === "recontato"
                            ? "Já era da base antes deste período e voltou por este anúncio — conta em Cadastros, não em Novos."
                            : "Mesma pessoa preencheu de novo dentro deste período — não conta duas vezes."
                        }
                      >
                        <RotateCcw className="h-3 w-3" /> {lead.bucket === "recontato" ? "Já existia" : "Repetido"}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className="truncate text-[11px] text-[rgb(var(--slate-9))]"
                    title={`${lead.campaignName} → ${lead.adsetName} → ${lead.adName}`}
                  >
                    {formatDay(lead.dia)} às {minuteOf(lead.criadoEm)} ·{" "}
                    <span className="text-[rgb(var(--slate-10))]">{lead.adName}</span> ·{" "}
                    {readableCampaignName(lead.campaignName)}
                  </p>
                </div>
              </div>

              <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                {agendou ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-md bg-[rgb(224_248_243)] px-2 py-0.5 text-xs font-medium text-[rgb(var(--teal-9))]"
                    title="Passou pela etapa Agendado em algum momento."
                  >
                    <CalendarCheck2 className="h-3 w-3" /> Agendou
                  </span>
                ) : null}
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
                    aria-label={`Abrir WhatsApp de ${humanizeName(lead.nome) || "lead"}`}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {lightboxCreative ? (
        <CreativeLightbox
          key={lightboxCreative.adName}
          ad={lightboxCreative}
          onClose={() => setLightboxCreative(null)}
        />
      ) : null}
    </>
  );
}
