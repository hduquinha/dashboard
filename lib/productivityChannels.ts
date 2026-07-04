import type { ProductivityChannelKey } from "@/lib/productivityConfig";

/**
 * Classificacao best-effort de campanha/origem de um lead em um dos buckets
 * de PRODUCTIVITY_CHANNELS (lib/productivityConfig.ts). Nao existe hoje um
 * campo dedicado de "canal" em dashboard.commercial_leads — isso e inferido
 * a partir de campaign_source/campaign_name (mesmos campos ja usados por
 * lib/db.ts CAMPAIGN_SOURCE_EXPRESSION e lib/leadFields.ts describeLeadSource).
 *
 * Confianca media: as regras abaixo cobrem os padroes mais comuns vistos no
 * payload hoje, mas podem precisar de ajuste fino depois de validar com quem
 * usa o relatorio de produtividade no dia a dia.
 */
export function classifyCampaignChannel(
  campaignSource: string | null | undefined,
  campaignName: string | null | undefined
): ProductivityChannelKey | null {
  const text = `${campaignSource ?? ""} ${campaignName ?? ""}`.toLowerCase().trim();
  if (!text) return null;

  if (/indica[cç][aã]o/.test(text)) return "indicacao_aluno";
  if (/instagram|direct/.test(text)) return "instagram_direct_espontaneo";
  if (/fachada/.test(text)) return "fachada";
  if (/equipe\s*vox|vox\s*up/.test(text)) return "equipe_vox";
  if (/whatsapp|wpp/.test(text) && /meta|facebook|fb\b/.test(text)) return "m4_meta_wpp";
  if (/google/.test(text)) return "m4_google";
  if (/meta|facebook|fb\b/.test(text)) return "m4_meta_nativos";
  if (/site|organic|org[aâ]nico/.test(text)) return "site";
  return null;
}
