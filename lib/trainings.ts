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

/**
 * Try to normalize a free-form Up Day Plus date string into a cleaner format.
 * Examples:
 *   "18 e 19/04"     → "18 e 19/04/2026"
 *   "18 e 19/04/26"  → "18 e 19/04/2026"
 *   "05/05"          → "05/05/2026"
 *   "05/05/2026"     → "05/05/2026" (unchanged)
 */
function normalizeUpDayDate(id: string): string {
  const currentYear = new Date().getFullYear();

  // Pattern: "DD e DD/MM" or "DD e DD/MM/YY" or "DD e DD/MM/YYYY"
  const multiDayMatch = id.match(/^(\d{1,2}\s*e\s*\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (multiDayMatch) {
    const days = multiDayMatch[1]; // e.g. "18 e 19"
    const month = multiDayMatch[2].padStart(2, '0');
    const yearPart = multiDayMatch[3];
    const year = yearPart
      ? (yearPart.length <= 2 ? `20${yearPart.padStart(2, '0')}` : yearPart)
      : String(currentYear);
    return `${days}/${month}/${year}`;
  }

  // Pattern: "DD/MM" (single day, no year)
  const singleNoYear = id.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (singleNoYear) {
    const day = singleNoYear[1].padStart(2, '0');
    const month = singleNoYear[2].padStart(2, '0');
    return `${day}/${month}/${currentYear}`;
  }

  // Pattern: "DD/MM/YY" (short year)
  const shortYear = id.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (shortYear) {
    const day = shortYear[1].padStart(2, '0');
    const month = shortYear[2].padStart(2, '0');
    const year = `20${shortYear[3]}`;
    return `${day}/${month}/${year}`;
  }

  return id;
}

/**
 * Build a user-facing label for a training ID that was not configured in TRAINING_CONFIG.
 * - ISO date IDs (e.g. "2026-03-11T19:00:00-03:00") → "Encontro Online 11/03/2026"
 * - Free-form IDs (e.g. "18 e 19/04")               → "Up Day Plus 18 e 19/04/2026"
 */
export function buildAutoTrainingLabel(id: string): string {
  const formatted = formatTrainingDateLabel(id);
  if (formatted) {
    return `Encontro Online ${formatted}`;
  }
  return `Up Day Plus ${normalizeUpDayDate(id)}`;
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
      label: buildAutoTrainingLabel(normalized),
      startsAt: formatted ? normalized : null,
    };
  }

  return match;
}
