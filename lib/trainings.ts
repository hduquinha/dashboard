import type { TrainingKind, TrainingOption } from "@/types/training";

const DEFAULT_TRAINING_OPTIONS: TrainingOption[] = [
  {
    id: "15 e 16/08",
    label: "Up Day Plus 15 e 16/08/2026",
    kind: "up-day-plus",
    days: 2,
    cluster: 80,
    aliases: [
      "15 e 16/08/2026",
      "15 e 16 de Agosto de 2026",
      "15 e 16 de agosto de 2026",
      "2026-08-15T09:00:00-03:00",
      "Inscricao UP Day - Agosto 2026",
      "Inscrição UP Day - Agosto 2026",
    ],
  },
];

const IGNORED_TRAINING_DATE_LABELS = new Set(["01/01/2026"]);
const IGNORED_TRAINING_IDS = new Set(
  [
    "01/0102026",
    "01/010/2026",
    "01/01/02026",
    "2026-01-01",
    "2026-01-01T00:00:00-03:00",
    "2026-01-01T19:00:00-03:00",
  ].map(normalizeComparable)
);

const MONTHS_PT_BR: Record<string, string> = {
  janeiro: "01",
  fevereiro: "02",
  marco: "03",
  "marco.": "03",
  abril: "04",
  maio: "05",
  junho: "06",
  julho: "07",
  agosto: "08",
  setembro: "09",
  outubro: "10",
  novembro: "11",
  dezembro: "12",
};

function normalizeId(id: unknown): string | null {
  if (typeof id !== "string") {
    return null;
  }
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeComparable(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

export function formatTrainingDateLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (isoDate) {
    const year = Number.parseInt(isoDate[1], 10);
    const month = Number.parseInt(isoDate[2], 10);
    const day = Number.parseInt(isoDate[3], 10);
    return isValidDateParts(year, month, day) ? formatDateParts(year, month, day) : null;
  }

  return null;
}

function isMalformedTrainingDateId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || formatTrainingDateLabel(trimmed)) {
    return false;
  }

  return (
    /^\d{1,2}\/\d{3,}(?:\/\d+)?$/.test(trimmed) ||
    /^\d{1,2}\/\d{1,2}\/\d{5,}$/.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}/.test(trimmed)
  );
}

export function isIgnoredTrainingId(value: string | null | undefined): boolean {
  const normalized = normalizeId(value);
  if (!normalized) {
    return false;
  }

  const formatted = formatTrainingDateLabel(normalized);
  return (
    IGNORED_TRAINING_IDS.has(normalizeComparable(normalized)) ||
    (formatted ? IGNORED_TRAINING_DATE_LABELS.has(formatted) : false) ||
    isMalformedTrainingDateId(normalized)
  );
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
  const comparable = normalizeComparable(id);

  const extensiveMultiDay = comparable.match(/^(\d{1,2})\s*e\s*(\d{1,2})\s+de\s+([a-z.]+)\s+de\s+(\d{4})$/);
  if (extensiveMultiDay) {
    const firstDay = extensiveMultiDay[1].padStart(2, "0");
    const secondDay = extensiveMultiDay[2].padStart(2, "0");
    const month = MONTHS_PT_BR[extensiveMultiDay[3]];
    const year = extensiveMultiDay[4];
    if (month) {
      return `${firstDay} e ${secondDay}/${month}/${year}`;
    }
  }

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
 * - ISO date IDs from the public form become "Encontro Online 11/03/2026"
 * - Up Day Plus dates keep the "Up Day Plus" prefix when the caller knows the context
 */
export function buildAutoTrainingLabel(id: string, kind: TrainingKind = "online"): string {
  const trimmed = id.trim();
  const comparable = normalizeComparable(trimmed);

  if (comparable.includes("encontro online")) {
    return trimmed;
  }

  if (comparable.includes("up day")) {
    return trimmed.startsWith("Up Day Plus") ? trimmed : trimmed.replace(/^inscri[cç][aã]o\s+/i, "");
  }

  const formatted = formatTrainingDateLabel(id);
  if (kind === "up-day-plus") {
    return `Up Day Plus ${formatted ?? normalizeUpDayDate(trimmed)}`;
  }

  return formatted ? `Encontro Online ${formatted}` : trimmed;
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

  const kindValue = normalizeId(record.kind ?? record.type ?? record.category);
  const kind: TrainingKind | undefined =
    kindValue === "online" || kindValue === "encontro-online"
      ? "online"
      : kindValue === "up-day-plus" || kindValue === "upday" || kindValue === "up-day"
      ? "up-day-plus"
      : undefined;

  const aliases = Array.isArray(record.aliases)
    ? record.aliases.map(normalizeId).filter((item): item is string => Boolean(item))
    : [];

  return {
    id,
    label: labelCandidate ?? formattedDate ?? label,
    startsAt,
    cluster,
    days,
    kind,
    aliases,
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

function optionIds(option: TrainingOption): string[] {
  return [option.id, ...(option.aliases ?? [])].filter((value) => value.trim().length > 0);
}

function cloneOption(option: TrainingOption): TrainingOption {
  return {
    ...option,
    aliases: option.aliases ? [...option.aliases] : undefined,
  };
}

function dedupeOptions(options: TrainingOption[]): TrainingOption[] {
  const unique = new Map<string, TrainingOption>();

  for (const option of options) {
    const key = normalizeComparable(option.id);
    unique.set(key, {
      ...option,
      aliases: Array.from(new Set(option.aliases ?? [])),
    });
  }

  return Array.from(unique.values());
}

function findConfiguredTraining(id: string): TrainingOption | null {
  const comparable = normalizeComparable(id);
  return (
    TRAINING_OPTIONS.find((option) =>
      optionIds(option).some((candidate) => normalizeComparable(candidate) === comparable)
    ) ?? null
  );
}

const TRAINING_OPTIONS: TrainingOption[] = dedupeOptions([
  ...DEFAULT_TRAINING_OPTIONS,
  ...parseTrainingConfigEnv(),
]);

export function listTrainingOptions(): TrainingOption[] {
  return TRAINING_OPTIONS.map(cloneOption);
}

export function listTrainingOptionIds(option: TrainingOption): string[] {
  return optionIds(option);
}

export function getTrainingById(id: string | null | undefined): TrainingOption | null {
  const normalized = normalizeId(id);
  if (!normalized || isIgnoredTrainingId(normalized)) {
    return null;
  }

  const match = findConfiguredTraining(normalized);
  if (!match) {
    const formatted = formatTrainingDateLabel(normalized);
    return {
      id: normalized,
      label: buildAutoTrainingLabel(normalized, "online"),
      startsAt: formatted ? normalized : null,
      kind: formatted ? "online" : undefined,
    };
  }

  return cloneOption(match);
}
