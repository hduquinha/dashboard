import type { TrainingOption } from "@/types/training";

function normalizeId(id: unknown): string | null {
  if (typeof id !== "string") {
    return null;
  }
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatTrainingDateLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function parseEntry(value: unknown): TrainingOption | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = normalizeId(record.id ?? record.key ?? record.slug ?? record.code);
  if (!id) {
    return null;
  }

  const rawLabel = typeof record.label === "string" ? record.label : record.title;
  const labelCandidate = normalizeId(rawLabel);
  const label = labelCandidate ?? id;

  const startsAtValue = record.startsAt ?? record.date ?? record.starts_at;
  const startsAt = typeof startsAtValue === "string" ? startsAtValue : null;
  const formattedDate = labelCandidate ? null : formatTrainingDateLabel(startsAt ?? id);

  const clusterValue = record.cluster;
  const cluster = typeof clusterValue === "number" ? clusterValue : null;

  const daysValue = record.days;
  const days = typeof daysValue === "number" && (daysValue === 1 || daysValue === 2) ? daysValue : undefined;

  return {
    id,
    label: labelCandidate ?? formattedDate ?? label,
    startsAt,
    cluster,
    days,
  };
}

function parseTrainingConfigEnv(): TrainingOption[] {
  const raw = process.env.TRAINING_CONFIG;
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const entries = parsed
        .map(parseEntry)
        .filter((value): value is TrainingOption => Boolean(value));

      const unique = new Map<string, TrainingOption>();
      for (const entry of entries) {
        if (!unique.has(entry.id)) {
          unique.set(entry.id, entry);
        }
      }

      return Array.from(unique.values());
    }

    const single = parseEntry(parsed);
    return single ? [single] : [];
  } catch (error) {
    console.warn("Failed to parse TRAINING_CONFIG env var", error);
    return [];
  }
}

const TRAINING_OPTIONS: TrainingOption[] = parseTrainingConfigEnv();

export function listTrainingOptions(): TrainingOption[] {
  return TRAINING_OPTIONS.map((option) => ({ ...option }));
}

export function getTrainingById(id: string | null | undefined): TrainingOption | null {
  const normalized = normalizeId(id);
  if (!normalized) {
    return null;
  }

  const match = TRAINING_OPTIONS.find((option) => option.id === normalized);
  if (!match) {
    const formatted = formatTrainingDateLabel(normalized);
    return {
      id: normalized,
      label: formatted ?? normalized,
      startsAt: formatted ? normalized : null,
    };
  }

  return match;
}
