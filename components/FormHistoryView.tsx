"use client";

import type { InscricaoItem } from "@/types/inscricao";
import { FORM_TRACKING_KEYS, leadFieldLabel, STANDARD_PAYLOAD_KEYS } from "@/lib/leadFields";

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
 * Um campo é "interno" (não vira campo de "Informações Padrão do Lead" a
 * partir do formulário) quando já é exibido em outro bloco fixo da ficha do
 * lead (Origem do Lead, Treinamento, Indicador), é metadado técnico
 * (FORM_TRACKING_KEYS) ou é bookkeeping do próprio dashboard.
 */
function isInternalKey(key: string): boolean {
  if (SKIP_KEYS.has(key)) return true;
  if (STANDARD_PAYLOAD_KEYS.has(key)) return true;
  if (FORM_TRACKING_KEYS.has(key)) return true;
  if (key.startsWith("presenca_dia")) return true;
  if (key.startsWith("_")) return true;
  if (key.startsWith("dashboard_")) return true;
  return false;
}

interface LeadFormAnswerField {
  key: string;
  label: string;
  value: string;
}

function payloadFields(payload: Record<string, unknown>): LeadFormAnswerField[] {
  return Object.entries(payload)
    .filter(([key, value]) => key !== "facebook_field_data" && !isInternalKey(key) && formatValue(value) !== null)
    .map(([key, value]) => ({ key, label: leadFieldLabel(key), value: formatValue(value)! }));
}

/** Só os campos técnicos/de rastreamento (ver FORM_TRACKING_KEYS) — exibidos numa seção própria no final da ficha. */
function trackingPayloadFields(payload: Record<string, unknown>): LeadFormAnswerField[] {
  return Object.entries(payload)
    .filter(([key, value]) => FORM_TRACKING_KEYS.has(key) && formatValue(value) !== null)
    .map(([key, value]) => ({ key, label: leadFieldLabel(key), value: formatValue(value)! }));
}

/* ─── Facebook Lead Ads: perguntas e respostas do formulário ─── */

interface FormQA {
  question: string;
  answer: string;
}

/** "-_quero_perder_o_medo_de_falar_em_público" → "Quero perder o medo de falar em público" */
function cleanFacebookText(raw: string): string {
  const text = raw
    .replace(/^[-_\s]+/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Perguntas longas e conhecidas do formulário do Meta, resumidas só pra
 * exibição na ficha do lead — a pergunta em si (na origem/no formulário) não
 * muda, isso é puramente cosmético pra facilitar a leitura rápida.
 * Casamento por trecho (case-insensitive) pra tolerar variações de pontuação.
 */
const QUESTION_SHORTENERS: { includes: string; short: string }[] = [
  { includes: "quando pretende começar", short: "Quando pretende começar" },
  { includes: "consultoria personalizada e gratuita", short: "Consultoria" },
  { includes: "por que você se interessou", short: "Motivo de interesse" },
  { includes: "estar presencialmente", short: "Consegue vir presencial" },
];

function shortenFormQuestion(question: string): string {
  const normalized = question.toLowerCase();
  const rule = QUESTION_SHORTENERS.find((r) => normalized.includes(r.includes));
  return rule ? rule.short : question;
}

/**
 * Perguntas do Facebook que já duplicam campos fixos de "Informações Padrão
 * do Lead" (nome/e-mail/telefone) — não repetir aqui, o dado já apareceu
 * em cima. Casamento pelo texto limpo da pergunta (case-insensitive).
 */
const DUPLICATE_STANDARD_QUESTIONS = new Set([
  "nome completo", "nome", "e-mail", "email", "telefone", "whatsapp", "telefone / whatsapp", "celular",
]);

function isDuplicateStandardQuestion(question: string): boolean {
  return DUPLICATE_STANDARD_QUESTIONS.has(question.trim().toLowerCase());
}

/**
 * As respostas do formulário do Meta chegam em `facebook_field_data` como
 * [{ name: "pergunta_com_underscores?", values: ["-_resposta"] }, ...] — é a
 * informação mais valiosa pro vendedor (objetivo, disponibilidade, quando quer
 * começar), então vira campos de "Informações Padrão do Lead" em vez de JSON cru.
 */
function parseFacebookQA(payload: Record<string, unknown>): FormQA[] {
  const raw = payload.facebook_field_data;
  if (!Array.isArray(raw)) return [];
  const result: FormQA[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { name, values } = entry as { name?: unknown; values?: unknown };
    if (typeof name !== "string" || !name.trim()) continue;
    const cleanedQuestion = cleanFacebookText(name);
    if (isDuplicateStandardQuestion(cleanedQuestion)) continue;
    const answer = (Array.isArray(values) ? values : [values])
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map(cleanFacebookText)
      .filter(Boolean)
      .join(", ");
    if (!answer) continue;
    result.push({ question: shortenFormQuestion(cleanedQuestion), answer });
  }
  return result;
}

/* ─── Componente ─── */

interface FormHistoryViewProps {
  inscricao: InscricaoItem;
}

/**
 * Respostas do formulário (perguntas do Facebook Lead Ads já resumidas +
 * demais campos do payload) como uma lista simples de campo/valor — usada
 * diretamente no grid de "Informações Padrão do Lead" (mesmo componente
 * InfoCard dos demais campos), sem cabeçalho, ícone ou card próprio.
 */
export function leadFormAnswerFields(inscricao: InscricaoItem): LeadFormAnswerField[] {
  const enrollments = inscricao.allEnrollments ?? [];
  const enrollmentPayloads = enrollments
    .map((e) => e.payload)
    .filter((p): p is Record<string, unknown> => p != null);
  const payloads = enrollmentPayloads.length > 0
    ? enrollmentPayloads
    : [(inscricao.payload ?? {}) as Record<string, unknown>];

  const seen = new Set<string>();
  const result: LeadFormAnswerField[] = [];

  for (const payload of payloads) {
    for (const qa of parseFacebookQA(payload)) {
      const dedupeKey = `qa:${qa.question.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      result.push({ key: dedupeKey, label: qa.question, value: qa.answer });
    }
    for (const field of payloadFields(payload)) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      result.push(field);
    }
  }

  return result;
}

/**
 * Metadados técnicos do formulário (rastreamento de anúncio/campanha, IDs do
 * Facebook etc. — ver FORM_TRACKING_KEYS) — deliberadamente fora do bloco
 * "Informações Padrão do Lead" por não serem relevantes pra quem olha a
 * ficha; exibidos numa seção própria no final da visualização.
 */
export function hasFormTrackingFields(inscricao: InscricaoItem): boolean {
  const payload = (inscricao.payload ?? {}) as Record<string, unknown>;
  return trackingPayloadFields(payload).length > 0;
}

export function FormTrackingFields({ inscricao }: FormHistoryViewProps) {
  const currentPayload = (inscricao.payload ?? {}) as Record<string, unknown>;
  const fields = trackingPayloadFields(currentPayload);
  if (fields.length === 0) return null;

  return (
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
  );
}
