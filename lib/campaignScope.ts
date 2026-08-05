import type { AdRow, CampaignGroup } from "@/types/metaAds";

/** Todos os anúncios da árvore campanha → conjunto → anúncio. */
export function flattenAds(hierarchy: CampaignGroup[]): AdRow[] {
  return hierarchy.flatMap((campaign) => campaign.adsets.flatMap((adset) => adset.ads));
}

/**
 * Aplica o recorte de campanha/conjunto escolhido na querystring (compartilhado
 * por todas as abas de /campanhas). Um id que não existe mais na árvore — por
 * exemplo depois de trocar o período ou o filtro de status — cai de volta pro
 * escopo mais amplo, em vez de mostrar uma tela vazia sem explicação.
 */
export function scopeAds(
  hierarchy: CampaignGroup[],
  selectedCampaignId: string | null,
  selectedAdsetId: string | null
): AdRow[] {
  if (!selectedCampaignId) return flattenAds(hierarchy);

  const campaign = hierarchy.find((item) => item.campaignId === selectedCampaignId);
  if (!campaign) return flattenAds(hierarchy);
  if (!selectedAdsetId) return campaign.adsets.flatMap((adset) => adset.ads);

  const adset = campaign.adsets.find((item) => item.adsetId === selectedAdsetId);
  return adset ? adset.ads : campaign.adsets.flatMap((item) => item.ads);
}
