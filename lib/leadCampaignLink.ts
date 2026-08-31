import { getPool } from "@/lib/db";

const META_SCHEMA = "meta_ads";

export interface LeadCampaignLink {
  campaignId: string;
  campaignName: string;
  /** Como o vínculo foi encontrado — aparece no title do botão, para quem
   *  precisar auditar por que a ficha aponta para esta campanha. */
  via: "atribuicao" | "campaign_id" | "ad_id" | "nome";
}

/**
 * Descobre a campanha de mídia de um lead, na mesma ordem de confiança usada
 * pela tela de campanhas (ver a cascata em lib/metaAds.ts):
 *
 *  1. atribuição congelada (lead_ad_attribution) — imune a renomeação;
 *  2. `campaign_id` gravado no payload (Lead Ads nativo);
 *  3. `ad_id` do payload → anúncio → campanha;
 *  4. nome da campanha do UTM, aceitando também nomes ANTIGOS
 *     (campaign_name_history) — é o caso mais comum, porque a maioria dos
 *     leads só traz `utm_campaign`.
 *
 * Devolve null quando o lead não veio de mídia paga ou quando a campanha não
 * existe mais na base sincronizada — aí a ficha simplesmente não mostra o link.
 */
export async function resolveLeadCampaign(inscricaoId: number): Promise<LeadCampaignLink | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    campaign_id: string | null;
    name: string | null;
    via: LeadCampaignLink["via"] | null;
  }>(
    `
    WITH lead AS (
      SELECT i.payload,
             NULLIF(TRIM(i.payload->>'campaign_id'), '') AS payload_campaign_id,
             NULLIF(TRIM(i.payload->>'ad_id'), '')       AS payload_ad_id,
             LOWER(TRIM(COALESCE(
               NULLIF(TRIM(i.payload->>'utm_campaign'), ''),
               NULLIF(TRIM(i.payload->>'campaign_name'), '')
             )))                                          AS nome_utm
        FROM inscricoes.inscricoes i
       WHERE i.id = $1
    ),
    candidatos AS (
      -- 1. atribuição congelada
      SELECT c.campaign_id, c.name, 'atribuicao'::text AS via, 1 AS ordem
        FROM ${META_SCHEMA}.lead_ad_attribution la
        JOIN ${META_SCHEMA}.ads a ON a.ad_id = la.ad_id
        JOIN ${META_SCHEMA}.campaigns c ON c.campaign_id = a.campaign_id
       WHERE la.inscricao_id = $1

      UNION ALL
      -- 2. id da campanha no payload
      SELECT c.campaign_id, c.name, 'campaign_id', 2
        FROM lead l
        JOIN ${META_SCHEMA}.campaigns c ON c.campaign_id = l.payload_campaign_id

      UNION ALL
      -- 3. id do anúncio no payload
      SELECT c.campaign_id, c.name, 'ad_id', 3
        FROM lead l
        JOIN ${META_SCHEMA}.ads a ON a.ad_id = l.payload_ad_id
        JOIN ${META_SCHEMA}.campaigns c ON c.campaign_id = a.campaign_id

      UNION ALL
      -- 4. nome atual da campanha
      SELECT c.campaign_id, c.name, 'nome', 4
        FROM lead l
        JOIN ${META_SCHEMA}.campaigns c ON LOWER(c.name) = l.nome_utm
       WHERE l.nome_utm IS NOT NULL

      UNION ALL
      -- 4b. nome antigo (campanha renomeada depois que o lead entrou)
      SELECT c.campaign_id, c.name, 'nome', 5
        FROM lead l
        JOIN ${META_SCHEMA}.campaign_name_history h ON h.name_lower = l.nome_utm
        JOIN ${META_SCHEMA}.campaigns c ON c.campaign_id = h.campaign_id
       WHERE l.nome_utm IS NOT NULL
    )
    SELECT campaign_id, name, via
      FROM candidatos
     ORDER BY ordem
     LIMIT 1
    `,
    [inscricaoId]
  );

  const row = rows[0];
  if (!row?.campaign_id) return null;

  return {
    campaignId: row.campaign_id,
    campaignName: row.name ?? row.campaign_id,
    via: row.via ?? "nome",
  };
}
