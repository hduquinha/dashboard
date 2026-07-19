import type { AdRow } from "@/types/metaAds";

/** Teve qualquer atividade no período (exibição, clique, lead ou cadastro). */
export function hasMovement(ad: AdRow): boolean {
  return ad.spend > 0 || ad.impressions > 0 || ad.clicks > 0 || ad.leadsMeta > 0 || ad.cadastrosCrm > 0;
}

/** Meta contou mais leads do que o CRM confirmou, ou teve clique sem nenhum cadastro. */
export function needsAttention(ad: AdRow): boolean {
  return ad.leadsMeta > ad.cadastrosCrm || (ad.clicks > 0 && ad.cadastrosCrm === 0);
}

export function hasRegistration(ad: AdRow): boolean {
  return ad.cadastrosCrm > 0 || ad.leadsCrm > 0;
}

/** Menor = mais prioritário (usado pra ordenar por "o que merece olhar primeiro"). */
export function attentionPriority(ad: AdRow): number {
  if (ad.leadsMeta > ad.cadastrosCrm) return 0;
  if (ad.clicks > 0 && ad.cadastrosCrm === 0) return 1;
  if (ad.cadastrosCrm > 0) return 2;
  if (hasMovement(ad)) return 3;
  return 4;
}
