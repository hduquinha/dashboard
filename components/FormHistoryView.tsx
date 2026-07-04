"use client";

import type { EnrollmentSummary, InscricaoItem } from "@/types/inscricao";
import { formatTrainingDateLabel } from "@/lib/trainings";
import { leadFieldLabel, STANDARD_PAYLOAD_KEYS } from "@/lib/leadFields";

/* ─── Config ─── */

const SKIP_KEYS = new Set([
  "_final", "_step", "_meta", "_id", "id",
  "dashboard_status", "dashboard_status_at", "dashboard_status_whatsapp",
  "dashboard_notes", "dashboard_stars", "dashboard_search",
  "dashboard_nome_sugestoes", "dashboard_email_sugestoes",
  "presenca_validada", "presenca_aprovada", "presenca_participante_nome",
  "presenca_tempo_total_minutos", "presenca_tempo_dinamica_minutos",
  "presenca_percentual_dinamica", "presenca_validada_em", "presenca_total_dias",
  "presenca_dia_processado", "presenca_dinamica_dias",
  "presenca_dia1_aprovado", "presenca_dia1_participante_nome",
  "presenca_dia2_aprovado", "presenca_dia2_participante_nome",
]);

/* ─── Helpers ─── */

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const parts = value.map(formatValue).filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Um campo é "interno" (não vira pergunta/resposta em "Respostas do Formulário")
 * quando já é exibido em outro bloco fixo da ficha do lead (Informações Padrão,
 * Origem do Lead, Treinamento, Indicador) ou é bookkeeping do próprio dashboard.
 */
function isInternalKey(key: string): boolean {
  if (SKIP_KEYS.has(key)) return true;
  if (STANDARD_PAYLOAD_KEYS.has(key)) return true;
  if (key.startsWith("presenca_dia")) return true;
  if (key.startsWith("_")) return true;
  if (key.startsWith("dashboard_")) return true;
  return false;
}

function productIcon(trainingId: string | null, treinamentoNome: string | null): string {
  const src = `${trainingId ?? ""} ${treinamentoNome ?? ""}`.toLowerCase();
  if (src.includes("voz") || src.includes("vozup")) return "🎤";
  if (src.includes("up day") || src.includes("upday")) return "📅";
  if (src.includes("online") || src.includes("encontro")) return "💻";
  return "📋";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function enrollmentLabel(e: EnrollmentSummary): string {
  if (e.treinamentoNome) return e.treinamentoNome;
  if (e.treinamentoId) return formatTrainingDateLabel(e.treinamentoId) ?? e.treinamentoId;
  return "Formulário";
}

function payloadFields(payload: Record<string, unknown>): { key: string; label: string; value: string }[] {
  return Object.entries(payload)
    .filter(([key, value]) => !isInternalKey(key) && formatValue(value) !== null)
    .map(([key, value]) => ({ key, label: leadFieldLabel(key), value: formatValue(value)! }));
}

/* ─── Sub-components ─── */

function EnrollmentCard({ e, index, total }: { e: EnrollmentSummary; index: number; total: number }) {
  const icon = productIcon(e.treinamentoId, e.treinamentoNome);
  const label = enrollmentLabel(e);
  const dateLabel = e.treinamentoData
    ? formatTrainingDateLabel(e.treinamentoData) ?? fmtDate(e.treinamentoData)
    : null;
  const fields = e.payload ? payloadFields(e.payload) : [];

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-3">
        <span className="mt-0.5 text-base leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-xs font-semibold text-neutral-900">{label}</p>
            {total > 1 && (
              <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[9px] font-bold text-neutral-500">
                {index + 1}/{total}
              </span>
            )}
          </div>
          {dateLabel && <p className="text-[10px] text-neutral-400">{dateLabel}</p>}
          <p className="text-[10px] text-neutral-400">Inscrito em {fmtDate(e.criadoEm)}</p>
        </div>
        <div className="flex-shrink-0">
          {e.presencaAprovada ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">✓ Presente</span>
          ) : e.presencaValidada ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">⚠ Parcial</span>
          ) : null}
        </div>
      </div>

      {/* Form fields */}
      {fields.length > 0 && (
        <div className="divide-y divide-neutral-50">
          {fields.map(({ key, label: lbl, value }) => (
            <div key={key} className="flex items-start gap-2 px-4 py-1.5">
              <span className="min-w-[120px] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                {lbl}
              </span>
              <span className="min-w-0 break-words text-xs text-neutral-800">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Component ─── */

interface FormHistoryViewProps {
  inscricao: InscricaoItem;
}

export function FormHistoryView({ inscricao }: FormHistoryViewProps) {
  const enrollments = inscricao.allEnrollments ?? [];
  const currentPayload = (inscricao.payload ?? {}) as Record<string, unknown>;

  // If we have enrollments with payloads, show each as a complete form card.
  // Otherwise, fall back to showing the current lead's payload only.
  const hasEnrollmentsWithPayload = enrollments.some((e) => e.payload != null);

  if (hasEnrollmentsWithPayload || enrollments.length > 0) {
    return (
      <div className="space-y-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">
          {enrollments.length === 1 ? "1 formulário" : `${enrollments.length} formulários`}
        </p>
        {enrollments.map((e, i) => (
          <EnrollmentCard key={e.id} e={e} index={i} total={enrollments.length} />
        ))}
      </div>
    );
  }

  // Fallback: show current lead's payload (allEnrollments null or empty)
  const fields = payloadFields(currentPayload);
  return (
    <div className="space-y-5">
      {fields.length > 0 ? (
        <section>
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-neutral-400">
            Respostas do formulário
          </p>
          <div className="grid grid-cols-1 gap-1.5">
            {fields.map(({ key, label, value }) => (
              <div
                key={key}
                className="flex items-start gap-2 rounded-lg border border-neutral-100 bg-white px-3 py-2"
              >
                <span className="min-w-[120px] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  {label}
                </span>
                <span className="min-w-0 break-words text-xs text-neutral-800">{value}</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="py-6 text-center text-xs text-neutral-400">
          Carregando dados do formulário...
        </p>
      )}
    </div>
  );
}
