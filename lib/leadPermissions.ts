import { hasPermission, type PermissionUser } from "@/lib/permissions";
import type { EnrollmentSummary, InscricaoItem } from "@/types/inscricao";

const PHONE_KEYS = ["telefone", "phone", "celular", "whatsapp", "dashboard_telefone"];
const EMAIL_KEYS = ["email", "e_mail"];
const CITY_KEYS = ["cidade", "city", "estado", "state", "bairro", "endereco", "address"];
const PROFESSION_KEYS = ["profissao", "profissao_area", "profissaoArea", "cargo", "job", "job_title", "empresa", "company"];
const TRAINING_KEYS = ["treinamento", "training", "training_id", "trainingId", "data_treinamento", "dataTreinamento", "treinamento_nome"];
const SOURCE_KEYS = [
  "origem",
  "source",
  "lead_source",
  "leadSource",
  "traffic_source",
  "indicacao",
  "campaign_source",
  "campaignSource",
  "campaign_name",
  "campaignName",
  "campaign_term",
  "campaignTerm",
  "utm_source",
  "utm_campaign",
  "utm_medium",
  "utm_term",
  "form_name",
  "ad_name",
];

function removePayloadKeys(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    delete payload[key];
  }
}

function maskEnrollmentPayload(
  enrollment: EnrollmentSummary,
  keysToRemove: string[]
): EnrollmentSummary {
  if (!enrollment.payload) {
    return enrollment;
  }
  const payload = { ...enrollment.payload };
  removePayloadKeys(payload, keysToRemove);
  return { ...enrollment, payload };
}

export function maskInscricaoForUser(
  item: InscricaoItem,
  user: PermissionUser | null | undefined
): InscricaoItem {
  if (!user) {
    return item;
  }

  const payload = { ...(item.payload ?? {}) };
  const parsedPayload = { ...(item.parsedPayload ?? {}) };
  const upDay = { ...(item.upDay ?? {}) };
  const keysToRemove: string[] = [];

  const masked: InscricaoItem = {
    ...item,
    payload,
    parsedPayload,
    upDay,
  };

  if (!hasPermission(user, "field.view.phone")) {
    masked.telefone = null;
    upDay.telefone = null;
    removePayloadKeys(parsedPayload, PHONE_KEYS);
    keysToRemove.push(...PHONE_KEYS);
  }

  if (!hasPermission(user, "field.view.email")) {
    upDay.email = null;
    removePayloadKeys(parsedPayload, EMAIL_KEYS);
    keysToRemove.push(...EMAIL_KEYS);
  }

  if (!hasPermission(user, "field.view.city")) {
    masked.cidade = null;
    upDay.cidade = null;
    removePayloadKeys(parsedPayload, CITY_KEYS);
    keysToRemove.push(...CITY_KEYS);
  }

  if (!hasPermission(user, "field.view.profession")) {
    masked.profissao = null;
    upDay.profissaoArea = null;
    removePayloadKeys(parsedPayload, PROFESSION_KEYS);
    keysToRemove.push(...PROFESSION_KEYS);
  }

  if (!hasPermission(user, "field.view.training")) {
    masked.treinamentoId = null;
    masked.treinamentoNome = null;
    masked.treinamentoData = null;
    masked.allEnrollments = null;
    upDay.treinamentoNome = null;
    upDay.dataTreinamento = null;
    upDay.dataTreinamentoExtenso = null;
    removePayloadKeys(parsedPayload, TRAINING_KEYS);
    keysToRemove.push(...TRAINING_KEYS);
  }

  if (!hasPermission(user, "field.view.source")) {
    masked.recrutadorCodigo = null;
    masked.recrutadorNome = null;
    masked.recrutadorUrl = null;
    upDay.indicacao = null;
    removePayloadKeys(parsedPayload, SOURCE_KEYS);
    keysToRemove.push(...SOURCE_KEYS);
  }

  if (!hasPermission(user, "field.view.notes")) {
    masked.notes = [];
  }

  if (!hasPermission(user, "field.view.commercial")) {
    masked.commercial = undefined;
  }

  removePayloadKeys(payload, keysToRemove);
  if (masked.allEnrollments && keysToRemove.length > 0) {
    masked.allEnrollments = masked.allEnrollments.map((enrollment) =>
      maskEnrollmentPayload(enrollment, keysToRemove)
    );
  }

  return masked;
}

export function maskInscricoesForUser(
  items: InscricaoItem[],
  user: PermissionUser | null | undefined
): InscricaoItem[] {
  return items.map((item) => maskInscricaoForUser(item, user));
}
