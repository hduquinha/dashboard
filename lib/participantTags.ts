import type { EnrollmentSummary, InscricaoItem, PresencaDia } from "@/types/inscricao";
import { buildAutoTrainingLabel, formatTrainingDateLabel, getTrainingById } from "@/lib/trainings";

export interface ParticipantTag {
  key: string;
  label: string;
  category: ParticipantTagCategory;
  tone: ParticipantTagTone;
  priority: number;
  color: string;
  description?: string;
}

export type ParticipantTagCategory =
  | "status"
  | "business"
  | "training"
  | "presence"
  | "quality"
  | "communication"
  | "profile"
  | "location"
  | "recruiter"
  | "temperature"
  | "duplicate";

export type ParticipantTagTone = "neutral" | "info" | "success" | "warning" | "danger" | "brand" | "violet";

const TAG_CATEGORY_ORDER: ParticipantTagCategory[] = [
  "quality",
  "status",
  "business",
  "presence",
  "training",
  "temperature",
  "communication",
  "profile",
  "location",
  "recruiter",
  "duplicate",
];

export const TAG_CATEGORY_LABELS: Record<ParticipantTagCategory, string> = {
  status: "Status",
  business: "Setor",
  training: "Treinamento",
  presence: "Presença",
  quality: "Qualidade",
  communication: "Canal",
  profile: "Perfil",
  location: "Cidade",
  recruiter: "Indicador",
  temperature: "Temperatura",
  duplicate: "Duplicidade",
};

const TAG_TONE_CLASS_NAMES: Record<ParticipantTagTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  brand: "border-cyan-200 bg-cyan-50 text-cyan-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

const TAG_DOT_CLASS_NAMES: Record<ParticipantTagTone, string> = {
  neutral: "bg-slate-400",
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  brand: "bg-cyan-500",
  violet: "bg-violet-500",
};

function createParticipantTag({
  key,
  label,
  category,
  tone,
  priority,
  description,
}: Omit<ParticipantTag, "color">): ParticipantTag {
  return {
    key,
    label,
    category,
    tone,
    priority,
    color: TAG_TONE_CLASS_NAMES[tone],
    description,
  };
}

export function participantTagClassName(tag: Pick<ParticipantTag, "tone" | "color">): string {
  return tag.color || TAG_TONE_CLASS_NAMES[tag.tone];
}

export function participantTagDotClassName(tag: Pick<ParticipantTag, "tone">): string {
  return TAG_DOT_CLASS_NAMES[tag.tone];
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function payloadText(inscricao: InscricaoItem, keys: string[]): string | null {
  for (const key of keys) {
    const value = asText(inscricao.payload?.[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function uniqueTags(tags: ParticipantTag[]): ParticipantTag[] {
  const seen = new Set<string>();
  const unique: ParticipantTag[] = [];

  for (const tag of tags) {
    const key = `${tag.key}:${tag.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(tag);
  }

  return unique;
}

export function sortParticipantTags(tags: ParticipantTag[]): ParticipantTag[] {
  return tags.slice().sort((left, right) => {
    const byPriority = left.priority - right.priority;
    if (byPriority !== 0) {
      return byPriority;
    }

    const byCategory =
      TAG_CATEGORY_ORDER.indexOf(left.category) - TAG_CATEGORY_ORDER.indexOf(right.category);
    if (byCategory !== 0) {
      return byCategory;
    }

    return left.label.localeCompare(right.label, "pt-BR");
  });
}

export function groupParticipantTags(tags: ParticipantTag[]): Array<{
  category: ParticipantTagCategory;
  label: string;
  tags: ParticipantTag[];
}> {
  const grouped = new Map<ParticipantTagCategory, ParticipantTag[]>();

  for (const tag of sortParticipantTags(tags)) {
    const existing = grouped.get(tag.category) ?? [];
    existing.push(tag);
    grouped.set(tag.category, existing);
  }

  return TAG_CATEGORY_ORDER.filter((category) => grouped.has(category)).map((category) => ({
    category,
    label: TAG_CATEGORY_LABELS[category],
    tags: grouped.get(category) ?? [],
  }));
}

export function isOnlineTraining(treinamentoId: string | null | undefined): boolean {
  const configured = getTrainingById(treinamentoId);
  if (configured?.kind) {
    return configured.kind === "online";
  }

  return formatTrainingDateLabel(treinamentoId) !== null;
}

export function formatTrainingTagLabel(
  treinamentoId: string | null | undefined,
  treinamentoNome?: string | null,
  treinamentoData?: string | null
): string {
  const id = asText(treinamentoId);
  const configured = getTrainingById(id);
  const formattedDate = formatTrainingDateLabel(treinamentoData ?? id);
  const name = asText(treinamentoNome);

  if (configured?.label) {
    return configured.label;
  }

  if (name && formattedDate && !name.includes(formattedDate)) {
    return `${name} ${formattedDate}`;
  }

  if (name) {
    return name;
  }

  if (id) {
    return buildAutoTrainingLabel(id);
  }

  return name ?? formattedDate ?? "Treinamento";
}

function getPresenceTrainingLabel(inscricao: InscricaoItem): string {
  const presencaTreinamentoId = asText(inscricao.payload?.presenca_treinamento_id);
  return formatTrainingTagLabel(
    presencaTreinamentoId ?? inscricao.treinamentoId,
    inscricao.treinamentoNome,
    inscricao.treinamentoData
  );
}

function hasDinamica(day: PresencaDia | null | undefined, fallbackMinutes?: number | null): boolean {
  return Boolean(day?.temDinamica) || Boolean(fallbackMinutes && fallbackMinutes > 0);
}

function buildDayPresenceTag(
  day: number,
  data: PresencaDia | null | undefined,
  trainingLabel: string
): ParticipantTag[] {
  if (!data) {
    return [];
  }

  const labelPrefix = data.aprovado ? `Participou Dia ${day}` : `Presença parcial Dia ${day}`;
  const tags: ParticipantTag[] = [
    createParticipantTag({
      key: `presence-day-${day}`,
      label: `${labelPrefix}: ${trainingLabel}`,
      category: "presence",
      tone: data.aprovado ? "success" : "warning",
      priority: data.aprovado ? 30 : 15,
      description: `Presença registrada no dia ${day}`,
    }),
  ];

  if (hasDinamica(data)) {
    tags.push(createParticipantTag({
      key: `dynamic-day-${day}`,
      label: `Dinâmica Dia ${day}: ${trainingLabel}`,
      category: "presence",
      tone: "brand",
      priority: 35,
      description: `Dinâmica registrada no dia ${day}`,
    }));
  }

  return tags;
}


function buildQualityTags(inscricao: InscricaoItem): ParticipantTag[] {
  const missingName = !inscricao.nome?.trim();
  const missingPhone = !inscricao.telefone?.trim();

  if (!missingName && !missingPhone) {
    return [];
  }

  return [
    createParticipantTag({
      key: "quality-dados-incompletos",
      label: "Dados incompletos",
      category: "quality",
      tone: "warning",
      priority: 5,
      description: "Nome ou telefone ausente no cadastro",
    }),
  ];
}

function buildLeadEntryTags(_inscricao: InscricaoItem): ParticipantTag[] {
  return [];
}

function buildEnrollmentHistoryTags(enrollments: EnrollmentSummary[]): ParticipantTag[] {
  const tags: ParticipantTag[] = [];
  if (enrollments.length === 0) return tags;

  // Ordena da mais antiga para a mais recente para identificar entrada
  const sorted = enrollments
    .slice()
    .sort((a, b) => new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime());

  const seenTrainings = new Set<string>();
  const multipleEnrollments = sorted.length > 1;

  // Reinscrita: participou de um evento anterior com presença aprovada e voltou
  if (multipleEnrollments && sorted.slice(0, -1).some((e) => e.presencaAprovada)) {
    tags.push(createParticipantTag({
      key: "returning-participant",
      label: "Reinscrita",
      category: "training",
      tone: "success",
      priority: 23,
      description: "Participante que já esteve presente em um evento anterior e se inscreveu novamente",
    }));
  }

  for (let idx = 0; idx < sorted.length; idx++) {
    const enrollment = sorted[idx];
    const label = formatTrainingTagLabel(
      enrollment.treinamentoId,
      enrollment.treinamentoNome,
      enrollment.treinamentoData
    );

    const dedupeKey = (enrollment.treinamentoId ?? label).toLowerCase().trim();
    if (seenTrainings.has(dedupeKey)) continue;
    seenTrainings.add(dedupeKey);

    if (idx === 0) {
      tags.push(createParticipantTag({
        key: `origem-${displayTagKey(label)}`,
        label: `Origem: ${label}`,
        category: "training",
        tone: "info",
        priority: 38,
        description: "Primeiro evento pelo qual o lead entrou no sistema",
      }));
    } else {
      tags.push(createParticipantTag({
        key: `inscrito-${displayTagKey(label)}`,
        label: `Inscrito: ${label}`,
        category: "training",
        tone: "info",
        priority: 40,
        description: "Evento no qual o lead se inscreveu",
      }));
    }

    if (enrollment.presencaValidada) {
      tags.push(createParticipantTag({
        key: `presente-${displayTagKey(label)}`,
        label: enrollment.presencaAprovada ? `Presente: ${label}` : `Parcial: ${label}`,
        category: "presence",
        tone: enrollment.presencaAprovada ? "success" : "warning",
        priority: enrollment.presencaAprovada ? 30 : 15,
        description: "Presença confirmada neste evento",
      }));
    }
  }

  return tags;
}

export function buildParticipantTags(inscricao: InscricaoItem): ParticipantTag[] {
  const tags: ParticipantTag[] = [];
  const presenceTrainingId = asText(inscricao.payload?.presenca_treinamento_id) ?? inscricao.treinamentoId;

  // Usa histórico agregado quando disponível (múltiplos eventos por pessoa)
  if (inscricao.allEnrollments && inscricao.allEnrollments.length > 0) {
    tags.push(...buildEnrollmentHistoryTags(inscricao.allEnrollments));
  } else {
    // Fallback: comportamento anterior para inscrição sem histórico agregado
    const enrollmentLabel = formatTrainingTagLabel(
      inscricao.treinamentoId,
      inscricao.treinamentoNome,
      inscricao.treinamentoData
    );

    const origemPayload = asText(inscricao.payload?.origem) ??
      asText(inscricao.payload?.campaignSource) ??
      asText(inscricao.payload?.campaign_source);

    if (inscricao.treinamentoId || inscricao.treinamentoNome || inscricao.treinamentoData) {
      tags.push(createParticipantTag({
        key: "enrollment",
        label: `Origem: ${enrollmentLabel}`,
        category: "training",
        tone: "info",
        priority: 38,
        description: "Evento de origem do lead",
      }));
    } else if (origemPayload) {
      tags.push(createParticipantTag({
        key: `origem-${displayTagKey(origemPayload)}`,
        label: `Origem: ${origemPayload}`,
        category: "training",
        tone: "info",
        priority: 38,
        description: "Formulário de origem do lead",
      }));
    }

    if (inscricao.presencaValidada && isOnlineTraining(presenceTrainingId)) {
      const presenceLabel = getPresenceTrainingLabel(inscricao);
      const totalDias = inscricao.presencaTotalDias ?? 1;
      const dayTags =
        totalDias >= 2
          ? [
              ...buildDayPresenceTag(1, inscricao.presencaDia1, presenceLabel),
              ...buildDayPresenceTag(2, inscricao.presencaDia2, presenceLabel),
            ]
          : [];

      if (dayTags.length > 0) {
        tags.push(...dayTags);
      } else {
        tags.push(createParticipantTag({
          key: "presence",
          label: `${inscricao.presencaAprovada ? "Presença aprovada" : "Presença parcial"}: ${presenceLabel}`,
          category: "presence",
          tone: inscricao.presencaAprovada ? "success" : "warning",
          priority: inscricao.presencaAprovada ? 30 : 15,
          description: "Resultado de presença do participante",
        }));

        if (hasDinamica(inscricao.presencaDia1, inscricao.presencaTempoDinamicaMinutos)) {
          tags.push(createParticipantTag({
            key: "dynamic",
            label: `Dinâmica: ${presenceLabel}`,
            category: "presence",
            tone: "brand",
            priority: 35,
            description: "Participou da dinâmica do treinamento",
          }));
        }
      }
    }
  }

  tags.push(...buildLeadEntryTags(inscricao));

  // Etiquetas de origens acumuladas por mesclagem (ex: mesmo contato que
  // entrou pelo Workshop e depois pela Landing Page).
  const origensAdicionais = inscricao.payload?.dashboard_origens_adicionais;
  if (Array.isArray(origensAdicionais)) {
    for (const entrada of origensAdicionais) {
      const label = typeof entrada === "string" ? entrada.trim() : "";
      if (!label) continue;
      tags.push(createParticipantTag({
        key: `origem-extra-${displayTagKey(label)}`,
        label: `Origem: ${label}`,
        category: "training",
        tone: "info",
        priority: 40,
        description: "Origem adicional registrada em interação posterior",
      }));
    }
  }

  if (inscricao.status === "aprovado") {
    tags.push(createParticipantTag({
      key: "status-approved",
      label: "Qualificado",
      category: "status",
      tone: "success",
      priority: 20,
      description: "Lead aprovado no dashboard",
    }));
  } else if (inscricao.status === "rejeitado") {
    tags.push(createParticipantTag({
      key: "status-rejected",
      label: "Descartado",
      category: "status",
      tone: "danger",
      priority: 10,
      description: "Lead rejeitado no dashboard",
    }));
  }

  if (inscricao.tipo === "recrutador") {
    tags.push(createParticipantTag({
      key: "role-recruiter",
      label: "Recrutador",
      category: "profile",
      tone: "violet",
      priority: 50,
      description: "Cadastro tratado como recrutador/cluster",
    }));
  }

  if (inscricao.statusWhatsappContacted) {
    tags.push(createParticipantTag({
      key: "whatsapp",
      label: "WhatsApp enviado",
      category: "communication",
      tone: "brand",
      priority: 60,
      description: "Contato ativo já realizado pelo WhatsApp",
    }));
  }

  tags.push(...buildQualityTags(inscricao));

  return sortParticipantTags(uniqueTags(tags));
}

export function buildOperationalTags(inscricao: InscricaoItem): ParticipantTag[] {
  const tags = buildParticipantTags(inscricao);

  if (inscricao.isVirtual) {
    tags.push(createParticipantTag({
      key: "channel-virtual",
      label: "Virtual",
      category: "communication",
      tone: "warning",
      priority: 55,
      description: "Inscrição virtual ou importada",
    }));
  }

  return sortParticipantTags(uniqueTags(tags));
}

function displayTagKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function tagFromDashboardDisplay(rawTag: string): ParticipantTag {
  const label = rawTag.trim();
  const separatorIndex = label.indexOf(":");
  const prefix = separatorIndex >= 0 ? label.slice(0, separatorIndex).trim().toLowerCase() : "";
  const value = separatorIndex >= 0 ? label.slice(separatorIndex + 1).trim() : label;

  if (prefix.includes("status")) {
    const normalized = value.toLowerCase();
    return createParticipantTag({
      key: `display-${displayTagKey(label)}`,
      label,
      category: "status",
      tone: normalized.includes("qualificado")
        ? "success"
        : normalized.includes("descartado")
          ? "danger"
          : "neutral",
      priority: 20,
    });
  }

  if (
    prefix.includes("treinamento") ||
    prefix.includes("origem") ||
    prefix.includes("entrada") ||
    prefix.includes("inscrito")
  ) {
    return createParticipantTag({
      key: `display-${displayTagKey(label)}`,
      label,
      category: "training",
      tone: "info",
      priority: prefix.includes("origem") || prefix.includes("entrada") ? 38 : 40,
    });
  }

  if (prefix.includes("parcial")) {
    return createParticipantTag({
      key: `display-${displayTagKey(label)}`,
      label,
      category: "presence",
      tone: "warning",
      priority: 15,
    });
  }

  if (prefix.includes("cidade")) {
    return createParticipantTag({
      key: `display-${displayTagKey(label)}`,
      label,
      category: "location",
      tone: "neutral",
      priority: 70,
    });
  }

  if (prefix.includes("indicador")) {
    return createParticipantTag({
      key: `display-${displayTagKey(label)}`,
      label,
      category: "recruiter",
      tone: "violet",
      priority: 75,
    });
  }

  if (prefix.includes("temperatura")) {
    return createParticipantTag({
      key: `display-${displayTagKey(label)}`,
      label,
      category: "temperature",
      tone: value.startsWith("4") || value.startsWith("5") ? "danger" : "warning",
      priority: 45,
    });
  }

  if (prefix.includes("presença") || prefix.includes("presenca")) {
    return createParticipantTag({
      key: `display-${displayTagKey(label)}`,
      label,
      category: "presence",
      tone: value.toLowerCase().includes("aprovada") ? "success" : "warning",
      priority: 30,
    });
  }

  if (prefix.includes("qualidade")) {
    const lowered = value.toLowerCase();
    return createParticipantTag({
      key: `display-${displayTagKey(label)}`,
      label,
      category: "quality",
      tone:
        lowered.includes("inválido") ||
        lowered.includes("invalido") ||
        lowered.includes("suspeito") ||
        lowered.includes("fantasma") ||
        lowered.includes("teste")
          ? "danger"
          : "warning",
      priority: 5,
    });
  }

  if (prefix.includes("duplicidade") || label.toLowerCase().includes("duplicado")) {
    return createParticipantTag({
      key: `display-${displayTagKey(label)}`,
      label,
      category: "duplicate",
      tone: "warning",
      priority: 8,
    });
  }

  return createParticipantTag({
    key: `display-${displayTagKey(label)}`,
    label,
    category: "status",
    tone: "neutral",
    priority: 90,
  });
}
