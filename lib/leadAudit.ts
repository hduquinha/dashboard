import { leadFieldLabel } from "@/lib/leadFields";

/**
 * Diff de payload para auditoria de edições de lead na linha do tempo.
 *
 * updateInscricao grava vários aliases para o mesmo campo lógico (ex.:
 * traffic_source/codigo_indicador/indicador/ref/referral) — o diff colapsa
 * cada grupo no alias canônico para o histórico não listar 5 mudanças
 * quando o vendedor alterou 1 campo.
 */

export interface LeadAuditChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

/** Grupos de aliases gravados juntos por updateInscricao — só o canônico (1º) aparece no diff. */
const ALIAS_GROUPS: string[][] = [
  ["traffic_source", "codigo_indicador", "indicador", "ref", "referral"],
  ["codigoProprio", "codigoRecrutador", "codigo_recrutador", "codigo", "codigo_indicador_proprio"],
  ["recrutador_id", "parent_id", "indicador_id", "sponsor_id"],
  ["nivel", "level", "hierarchy_level"],
  ["tipo", "isRecruiter"],
];

const SECONDARY_ALIASES = new Set(ALIAS_GROUPS.flatMap((group) => group.slice(1)));

function isInternalKey(key: string): boolean {
  return key.startsWith("dashboard_") || key.startsWith("presenca_") || key.startsWith("_");
}

function normalizeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

/** Lista o que mudou de fato entre dois payloads (campos internos fora). */
export function diffLeadPayload(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): LeadAuditChange[] {
  const prev = before ?? {};
  const next = after ?? {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const changes: LeadAuditChange[] = [];

  for (const key of keys) {
    if (isInternalKey(key) || SECONDARY_ALIASES.has(key)) continue;
    const from = normalizeValue(prev[key]);
    const to = normalizeValue(next[key]);
    if (from === to) continue;
    changes.push({ field: key, label: leadFieldLabel(key), from, to });
  }

  return changes.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}
