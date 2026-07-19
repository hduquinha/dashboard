const META_ADS_ORIGIN = /^\s*meta\s+ads(?:\s+voz\s*up)?(?=\s*(?:[-–—]|$))/iu;

const PAID_META_MEDIUMS = new Set([
  "ads",
  "cpa",
  "cpc",
  "cpm",
  "cpv",
  "display",
  "paid",
  "paidmedia",
  "paidsearch",
  "paidsocial",
  "paidtraffic",
  "ppc",
  "remarketing",
  "retargeting",
  "socialpaid",
  "socialads",
  "sponsored",
  "sponsoredsocial",
]);

const PAID_META_SOURCE_PREFIXES = ["facebookads", "fbads", "igads", "instagramads", "metaads"];

const META_SOURCES = new Set([
  "facebook",
  "facebookcom",
  "fb",
  "ig",
  "instagram",
  "instagramcom",
  "meta",
]);

const PAID_META_OBJECT_ID_KEYS = [
  "campaign_id",
  "campaignId",
  "adset_id",
  "adsetId",
  "ad_set_id",
  "adSetId",
  "ad_id",
  "adId",
  "creative_id",
  "creativeId",
] as const;

function text(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function token(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isMetaAdsOrigin(value: string): boolean {
  return META_ADS_ORIGIN.test(value);
}

function landingPageOrigin(value: string): string {
  return value.replace(META_ADS_ORIGIN, "Landing Page VozUP").trim();
}

export function hasPaidMetaEvidence(payload: Record<string, unknown>): boolean {
  const source = token(text(payload, "utm_source", "utmSource"));
  const medium = token(text(payload, "utm_medium", "utmMedium"));
  const hasGoogleSignal = Boolean(text(payload, "gclid")) || source.includes("google");
  if (hasGoogleSignal) return false;

  const hasExplicitMetaAdsSource = PAID_META_SOURCE_PREFIXES.some((prefix) =>
    source.startsWith(prefix)
  );
  const hasMetaContext = META_SOURCES.has(source) || Boolean(text(payload, "fbclid"));

  return (
    hasExplicitMetaAdsSource ||
    (PAID_META_MEDIUMS.has(medium) && hasMetaContext) ||
    PAID_META_OBJECT_ID_KEYS.some((key) => text(payload, key) !== "")
  );
}

/**
 * `fbclid` identifica um clique no ecossistema Meta, mas tambem existe em
 * links organicos. Fontes genericas como `ig`/`facebook`, campanha textual e
 * o proprio fbclid nao provam compra de midia.
 */
export function isMetaAdsWithoutPaidEvidence(payload: Record<string, unknown>): boolean {
  const origem = text(payload, "origem", "origin");
  return isMetaAdsOrigin(origem) && !hasPaidMetaEvidence(payload);
}

/**
 * Corrige no servidor o falso positivo produzido por clientes antigos, que
 * classificavam qualquer `utm_source=ig`/`fbclid` como "Meta Ads". Mantem os
 * parametros de rastreio para auditoria, alterando somente os rotulos de
 * origem usados pelo produto, pelas pastas e pelo merge por telefone.
 */
export function normalizeMetaAdsAttributionPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  if (!isMetaAdsWithoutPaidEvidence(payload)) return payload;

  const origemOriginal = text(payload, "origem", "origin");
  const origemNormalizada = landingPageOrigin(origemOriginal);
  const normalized: Record<string, unknown> = {
    ...payload,
    origem: origemNormalizada,
  };

  for (const key of ["treinamento_nome", "treinamentoNome"]) {
    const value = text(payload, key);
    if (value && isMetaAdsOrigin(value)) {
      normalized[key] = landingPageOrigin(value);
    }
  }

  const extras = payload.dashboard_origens_adicionais;
  if (Array.isArray(extras)) {
    normalized.dashboard_origens_adicionais = Array.from(
      new Set(
        extras.map((value) =>
          typeof value === "string" && isMetaAdsOrigin(value)
            ? landingPageOrigin(value)
            : value
        )
      )
    );
  }

  return normalized;
}
