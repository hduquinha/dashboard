import {
  ArrowRightLeft,
  BadgeCheck,
  Flag,
  History,
  Link2,
  Mail,
  MessageCircle,
  Pencil,
  PhoneCall,
  Star,
  StickyNote,
  UserRoundCheck,
  UserRoundX,
  RotateCcw,
  XCircle,
  type LucideIcon,
} from "lucide-react";

/**
 * Descrição visual dos eventos de `commercial_events`, compartilhada pela
 * linha do tempo do lead (LeadTimeline) e pelo Registro de Auditoria global.
 * Manter num só lugar garante que "o que aconteceu" seja descrito igual nas
 * duas telas — a auditoria não pode contar uma história diferente da ficha.
 */

/** Shape mínimo que `describeCommercialEvent` precisa — tanto o evento da
 * timeline quanto o da auditoria satisfazem isto. */
export interface DescribableEvent {
  type: string;
  fromStage: string | null;
  toStage: string | null;
  payload: Record<string, unknown>;
}

export interface EventDescription {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  detail: string | null;
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

const STATUS_LABELS: Record<string, string> = {
  aguardando: "Aguardando",
  aprovado: "Qualificado",
  rejeitado: "Descartado",
};

/** Rótulos amigáveis por tipo de evento — usados nos filtros e agrupamentos
 * da auditoria. A ordem também define a ordem preferida nos seletores. */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  stage_changed: "Mudança de etapa",
  assigned: "Atribuição de vendedor",
  unassigned: "Remoção de atribuição",
  reopened: "Reabertura",
  closed: "Fechamento",
  lead_edited: "Edição de dados",
  lead_status_changed: "Mudança de status",
  lead_stars_changed: "Mudança de temperatura",
  lead_note_added: "Observação interna",
  lead_vinculo_added: "Vínculo adicionado",
  lead_vinculo_replaced: "Vínculo trocado",
  lead_vinculo_removed: "Vínculo removido",
  activity: "Contato registrado",
};

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

function statusLabel(value: unknown): string {
  const key = String(value ?? "");
  return STATUS_LABELS[key] ?? (key || "—");
}

function formatChangeValue(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? `"${text}"` : "(vazio)";
}

function stageLabel(stage: string | null): string {
  return stage ? STAGE_LABELS[stage] ?? stage : "—";
}

function formatCurrencyValue(value: unknown): string | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return null;
  return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function describeCommercialEvent(event: DescribableEvent): EventDescription {
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
        const value = formatCurrencyValue(payload.value);
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
    case "lead_edited": {
      const changes = Array.isArray(payload.changes)
        ? (payload.changes as Array<{ label?: string; field?: string; from?: unknown; to?: unknown }>)
        : [];
      const lines = changes.map(
        (c) => `${c.label ?? c.field ?? "Campo"}: ${formatChangeValue(c.from)} → ${formatChangeValue(c.to)}`
      );
      return {
        icon: Pencil,
        iconClass: "bg-indigo-100 text-indigo-700",
        title: `Dados do lead editados (${changes.length} ${changes.length === 1 ? "campo" : "campos"})`,
        detail: lines.join("\n") || null,
      };
    }
    case "lead_status_changed":
      return {
        icon: Flag,
        iconClass: "bg-amber-100 text-amber-700",
        title: `Status: ${statusLabel(payload.from)} → ${statusLabel(payload.to)}`,
        detail: payload.whatsappContacted === true ? "Já havia contato pelo WhatsApp." : null,
      };
    case "lead_stars_changed": {
      const from = typeof payload.from === "number" ? payload.from : 0;
      const to = typeof payload.to === "number" ? payload.to : 0;
      return {
        icon: Star,
        iconClass: "bg-amber-100 text-amber-600",
        title: `Temperatura: ${from}★ → ${to}★`,
        detail: null,
      };
    }
    case "lead_note_added":
      return {
        icon: StickyNote,
        iconClass: "bg-neutral-100 text-neutral-600",
        title: payload.viaWhatsapp === true ? "Observação interna (via WhatsApp)" : "Observação interna",
        detail: typeof payload.content === "string" ? payload.content : null,
      };
    case "lead_vinculo_added":
      return {
        icon: Link2,
        iconClass: "bg-sky-100 text-sky-700",
        title: `Vínculo adicionado: ${String(payload.pasta ?? "—")} · ${String(payload.bloco ?? "—")}`,
        detail: null,
      };
    case "lead_vinculo_replaced":
      return {
        icon: Link2,
        iconClass: "bg-sky-100 text-sky-700",
        title: `Vínculo trocado: ${String(payload.fromPasta ?? "—")} · ${String(payload.fromBloco ?? "—")} → ${String(payload.pasta ?? "—")} · ${String(payload.bloco ?? "—")}`,
        detail: null,
      };
    case "lead_vinculo_removed":
      return {
        icon: Link2,
        iconClass: "bg-rose-100 text-rose-600",
        title: `Vínculo removido: ${String(payload.pasta ?? "—")} · ${String(payload.bloco ?? "—")}`,
        detail: null,
      };
    case "activity": {
      const kind = String(payload.kind ?? "anotacao");
      const config: Record<string, { icon: LucideIcon; iconClass: string; title: string }> = {
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
