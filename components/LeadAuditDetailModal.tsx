"use client";

import { useEffect, useRef } from "react";
import { MessageCircle, UserRound, X } from "lucide-react";
import { LeadTimeline } from "@/components/LeadTimeline";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";

interface LeadAuditDetailModalProps {
  leadId: number;
  leadName: string | null;
  leadPhone: string | null;
  sellerName: string | null;
  onClose: () => void;
}

/**
 * Detalhe do lead a partir do Registro de Auditoria: identidade + a linha do
 * tempo COMPLETA daquele lead (sem o formulário de registro manual — aqui é só
 * leitura de auditoria). Reaproveita o mesmo LeadTimeline da ficha do CRM.
 */
export default function LeadAuditDetailModal({
  leadId,
  leadName,
  leadPhone,
  sellerName,
  onClose,
}: LeadAuditDetailModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Histórico do lead ${humanizeName(leadName ?? "") || `#${leadId}`}`}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-[rgb(var(--surface-1))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border-weak))] p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[rgb(var(--slate-12))]">
              {humanizeName(leadName ?? "") || `Lead #${leadId}`}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[rgb(var(--slate-9))]">
              <span>Lead #{leadId}</span>
              <span className="inline-flex items-center gap-1">
                <UserRound className="h-3 w-3" />
                {sellerName ?? "Sem vendedor"}
              </span>
              {leadPhone ? (
                <a
                  href={buildWhatsAppWebUrl(leadPhone)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => openWhatsAppOnMobile(e, leadPhone)}
                  className="inline-flex items-center gap-1 text-[rgb(var(--teal-9))] hover:underline"
                >
                  <MessageCircle className="h-3 w-3" /> WhatsApp
                </a>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1.5 text-[rgb(var(--slate-9))] hover:bg-[rgb(var(--slate-3))] hover:text-[rgb(var(--slate-12))]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          <h4 className="mb-3 text-sm font-semibold text-[rgb(var(--slate-12))]">Linha do tempo completa</h4>
          <LeadTimeline leadId={leadId} canLog={false} />
        </div>
      </div>
    </div>
  );
}
