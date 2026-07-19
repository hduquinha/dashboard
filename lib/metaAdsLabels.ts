const ACRONYM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\big\s*\/\s*fb\b/gi, "IG/FB"],
  [/\bvozup\b/gi, "VozUP"],
  [/\bvox2you\b/gi, "Vox2You"],
  [/\bcrm\b/gi, "CRM"],
  [/\bb2b\b/gi, "B2B"],
  [/\bb2c\b/gi, "B2C"],
];

function collapseSpaces(value: string): string {
  return value.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function sentenceCase(value: string): string {
  const normalized = collapseSpaces(value).toLocaleLowerCase("pt-BR");
  if (!normalized) return "";

  let readable = normalized.charAt(0).toLocaleUpperCase("pt-BR") + normalized.slice(1);
  for (const [pattern, replacement] of ACRONYM_REPLACEMENTS) {
    readable = readable.replace(pattern, replacement);
  }
  return readable;
}

/** Humaniza o nome técnico da campanha da Meta preservando todos os
 * segmentos (identidade real da campanha) — nunca reduz ao último "tema",
 * pois duas campanhas distintas podem compartilhar o mesmo tema final. */
export function readableCampaignName(rawName: string): string {
  const raw = collapseSpaces(rawName);
  if (!raw) return "Campanha sem nome";

  const segments = raw.split("|").map(collapseSpaces).filter(Boolean);
  if (segments.length === 0) return sentenceCase(raw);

  return segments
    .map((segment) => sentenceCase(segment.replace(/^lp\s+/i, "").trim() || segment))
    .join(" · ");
}

export function isAdvantagePlusAdset(rawName: string): boolean {
  return /\badv\s*\+/i.test(rawName);
}

/** Humaniza os públicos mais usados sem apagar o nome técnico de origem. */
export function readableAdsetName(rawName: string): string {
  const raw = collapseSpaces(rawName);
  if (!raw) return "Conjunto sem nome";

  let label = raw
    .replace(/^conjunto\s+\d+\s*-\s*/i, "")
    .replace(/\badv\s*\+/gi, "")
    .replace(/^\s*[-–—|:]+\s*|\s*[-–—|:]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const normalized = normalizeForMatch(label);
  if (/^aberto(?:\b|$)/.test(normalized)) {
    label = label.replace(/^aberto/i, "Público aberto");
  } else if (/^engajamento\s+ig\s*\/\s*fb(?:\b|$)/.test(normalized)) {
    label = label.replace(/^engajamento\s+ig\s*\/\s*fb/i, "Engajados no IG/FB");
  } else if (/^lal\s+leads?\s+vox2you(?:\b|$)/.test(normalized)) {
    label = label.replace(/^lal\s+leads?\s+vox2you/i, "Semelhante aos leads Vox2You");
  } else {
    label = label.replace(/\blal\b/gi, "Semelhante");
  }

  return sentenceCase(label || raw);
}
