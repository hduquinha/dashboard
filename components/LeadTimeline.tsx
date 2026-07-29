"use client";

import { useEffect, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { describeCommercialEvent } from "@/lib/commercialEventDisplay";
import type { CommercialTimelineEvent } from "@/lib/commercial";

interface LeadTimelineProps {
  leadId: number;
  /** Permite registrar atividade manual (WhatsApp, ligacao...). */
  canLog?: boolean;
}

const ACTIVITY_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "ligacao", label: "Ligação" },
  { value: "email", label: "E-mail" },
  { value: "anotacao", label: "Anotação" },
] as const;

/** Atalhos de 1 clique para os contatos mais comuns do dia a dia do vendedor. */
const QUICK_LOG_ACTIONS: Array<{
  kind: (typeof ACTIVITY_OPTIONS)[number]["value"];
  label: string;
  description: string;
}> = [
  { kind: "whatsapp", label: "💬 Mandei mensagem", description: "Mensagem enviada no WhatsApp" },
  { kind: "whatsapp", label: "✅ Cliente respondeu", description: "Cliente respondeu no WhatsApp" },
  { kind: "ligacao", label: "📞 Liguei", description: "Ligação feita" },
  { kind: "ligacao", label: "🔇 Não atendeu", description: "Ligação não atendida" },
];

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Linha do tempo do lead: passo a passo de tudo que aconteceu — repasses,
 * trocas de etapa, fechamento/reabertura (automáticos) e contatos registrados
 * manualmente pelo vendedor.
 */
export function LeadTimeline({ leadId, canLog = true }: LeadTimelineProps) {
  const [events, setEvents] = useState<CommercialTimelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof ACTIVITY_OPTIONS)[number]["value"]>("whatsapp");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);
    fetch(`/api/commercial/leads/${leadId}/timeline`)
      .then((res) => res.json())
      .then((data: { events?: CommercialTimelineEvent[]; error?: string }) => {
        if (cancelled) return;
        if (data.events) setEvents(data.events);
        else setError(data.error ?? "Falha ao carregar a linha do tempo.");
      })
      .catch(() => {
        if (!cancelled) setError("Falha ao carregar a linha do tempo.");
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  async function logActivity(activityKind: string, activityDescription: string) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/leads/${leadId}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: activityKind, description: activityDescription }),
      });
      const data = (await response.json()) as { events?: CommercialTimelineEvent[]; error?: string };
      if (!response.ok || !data.events) {
        throw new Error(data.error ?? "Falha ao registrar atividade.");
      }
      setEvents(data.events);
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar atividade.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await logActivity(kind, description.trim());
  }

  return (
    <div className="space-y-3">
      {canLog && (
        <form onSubmit={handleSubmit} className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-100">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Entrou em contato? Registre aqui
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_LOG_ACTIONS.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={saving}
                onClick={() => logActivity(action.kind, action.description)}
                title={action.description}
                className="h-8 rounded-full border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 transition hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-40"
              >
                {action.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
              className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-xs font-semibold text-neutral-700"
              aria-label="Tipo de atividade"
            >
              {ACTIVITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="O que aconteceu? Ex.: mandei mensagem, cliente pediu retorno amanhã…"
              className="h-8 min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-cyan-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={saving}
              className="h-8 rounded-lg bg-neutral-900 px-4 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              {saving ? "Salvando…" : "Registrar"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      {events === null && !error ? (
        <p className="flex items-center gap-2 px-1 py-3 text-xs text-neutral-400">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando linha do tempo…
        </p>
      ) : null}

      {events && events.length === 0 ? (
        <p className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-400">
          Nenhum evento registrado ainda para este lead.
        </p>
      ) : null}

      {events && events.length > 0 && (
        <ol className="relative space-y-0">
          {events.map((event, index) => {
            const info = describeCommercialEvent(event);
            const Icon = info.icon;
            const isLast = index === events.length - 1;
            return (
              <li key={event.id} className="relative flex gap-3 pb-4">
                {!isLast && (
                  <span className="absolute left-[13px] top-7 h-[calc(100%-16px)] w-px bg-neutral-200" aria-hidden />
                )}
                <span className={`z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${info.iconClass}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-semibold text-neutral-800">{info.title}</p>
                  {info.detail ? (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-neutral-600">{info.detail}</p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    {formatDateTime(event.createdAt)}
                    {event.actorName ? ` · por ${event.actorName}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
