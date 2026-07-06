"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRightLeft,
  BadgeCheck,
  History,
  Mail,
  MessageCircle,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  StickyNote,
  UserRoundCheck,
  UserRoundX,
  XCircle,
} from "lucide-react";
import type { CommercialTimelineEvent } from "@/lib/commercial";

interface LeadTimelineProps {
  leadId: number;
  /** Permite registrar atividade manual (WhatsApp, ligacao...). */
  canLog?: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  novo: "Novo",
  primeiro_contato: "1º Contato",
  em_atendimento: "Em Atendimento",
  agendado: "Agendado",
  fechamento: "Fechamento",
  no_show: "No-show",
  ganho: "Ganho",
  perdido: "Perdido",
};

const ACTIVITY_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "ligacao", label: "Ligação" },
  { value: "email", label: "E-mail" },
  { value: "anotacao", label: "Anotação" },
] as const;

function stageLabel(stage: string | null): string {
  return stage ? STAGE_LABELS[stage] ?? stage : "—";
}

function formatValue(value: unknown): string | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return null;
  return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function describeEvent(event: CommercialTimelineEvent): {
  icon: typeof History;
  iconClass: string;
  title: string;
  detail: string | null;
} {
  const payload = event.payload as Record<string, unknown>;

  switch (event.type) {
    case "assigned":
      return {
        icon: UserRoundCheck,
        iconClass: "bg-cyan-100 text-cyan-700",
        title: `Lead atribuído a ${String(payload.sellerName ?? payload.sellerEmail ?? "vendedor")}`,
        detail: null,
      };
    case "unassigned":
      return {
        icon: UserRoundX,
        iconClass: "bg-amber-100 text-amber-700",
        title: `Atribuição removida${payload.sellerName ? ` — estava com ${String(payload.sellerName)}` : ""}`,
        detail: "Lead voltou a ficar sem vendedor responsável.",
      };
    case "reopened":
      return {
        icon: RotateCcw,
        iconClass: "bg-violet-100 text-violet-700",
        title: "Lead reaberto (redistribuído) — voltou ao Kanban como Novo",
        detail: null,
      };
    case "stage_changed":
      return {
        icon: ArrowRightLeft,
        iconClass: "bg-blue-100 text-blue-700",
        title: `Etapa: ${stageLabel(event.fromStage)} → ${stageLabel(event.toStage)}`,
        detail: null,
      };
    case "closed": {
      if (payload.reason === "curso_fechado") {
        const value = formatValue(payload.value);
        return {
          icon: BadgeCheck,
          iconClass: "bg-emerald-100 text-emerald-700",
          title: `Fechou curso: ${String(payload.courseName ?? "—")}`,
          detail: value ? `Valor pago: ${value}` : null,
        };
      }
      return {
        icon: XCircle,
        iconClass: "bg-rose-100 text-rose-600",
        title: "Lead fechado — não quis dar continuidade",
        detail: null,
      };
    }
    case "activity": {
      const kind = String(payload.kind ?? "anotacao");
      const config: Record<string, { icon: typeof History; iconClass: string; title: string }> = {
        whatsapp: { icon: MessageCircle, iconClass: "bg-emerald-100 text-emerald-700", title: "Contato via WhatsApp" },
        ligacao: { icon: PhoneCall, iconClass: "bg-amber-100 text-amber-700", title: "Ligação" },
        email: { icon: Mail, iconClass: "bg-sky-100 text-sky-700", title: "E-mail" },
        anotacao: { icon: StickyNote, iconClass: "bg-neutral-100 text-neutral-600", title: "Anotação" },
      };
      const entry = config[kind] ?? config.anotacao;
      const description = typeof payload.description === "string" ? payload.description : "";
      return { ...entry, detail: description || null };
    }
    default:
      return {
        icon: History,
        iconClass: "bg-neutral-100 text-neutral-500",
        title: event.type,
        detail: null,
      };
  }
}

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/leads/${leadId}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, description: description.trim() }),
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

  return (
    <div className="space-y-3">
      {canLog && (
        <form onSubmit={handleSubmit} className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-100">
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
            const info = describeEvent(event);
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
