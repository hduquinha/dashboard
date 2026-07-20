import type { AdRow } from "@/types/metaAds";

/**
 * Um criativo é o anúncio "de verdade" do ponto de vista de quem olha a tela:
 * ex. `VOZUP_AD09_IMG_AUTO`. A Meta duplica esse mesmo criativo em vários
 * conjuntos (Conjunto 1/2/3/4 ADV+, Engajados, Interesses, Formulário Nativo…),
 * gerando um `ad_id` por conjunto. A comparação "Meta marcou × Cadastros" só
 * reconcilia no NÍVEL DO CRIATIVO: a Meta divide o crédito dos Leads entre os
 * conjuntos com a atribuição dela (clique/visualização, janela de 7 dias),
 * enquanto o CRM atribui cada cadastro ao conjunto que a pessoa de fato clicou
 * (via utm_term). Por conjunto isolado os dois nunca batem; somando todos os
 * `ad_id` do mesmo criativo, sim.
 */
export interface CreativeGroup {
  /** Chave de agrupamento = nome do criativo. */
  key: string;
  /** AdRow sintético com as métricas somadas de todos os `ad_id` do criativo.
   * É o objeto exibido no card e usado pelos diagnósticos (mesmos campos de um
   * AdRow real, para reaproveitar componentes e `campaignDiagnostics`). */
  card: AdRow;
  /** Os anúncios reais (um por `ad_id`/conjunto) que compõem o criativo,
   * ordenados por gasto — usados no detalhamento por conjunto do modal. */
  members: AdRow[];
  /** Quantas campanhas distintas rodam este criativo no escopo atual. */
  campaignCount: number;
  /** Quantos conjuntos distintos rodam este criativo no escopo atual. */
  adsetCount: number;
}

function sumStageCounts(members: AdRow[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const member of members) {
    for (const [key, value] of Object.entries(member.stageCounts)) {
      total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

/** Um criativo "está no ar" se pelo menos um dos seus anúncios está ativo. */
function pickStatus(members: AdRow[]): Pick<AdRow, "status" | "effectiveStatus"> {
  const active = members.find((member) => (member.effectiveStatus ?? member.status) === "ACTIVE");
  const chosen = active ?? members[0];
  return { status: chosen.status, effectiveStatus: chosen.effectiveStatus };
}

/**
 * Agrupa uma lista de anúncios (um por `ad_id`) em criativos (um por nome).
 * O escopo (campanha/conjunto) é aplicado ANTES de chamar isto: com o escopo
 * em "todos" ou numa campanha, o criativo soma seus conjuntos; ao filtrar um
 * conjunto específico, cada criativo volta a ter um único `ad_id` (visão
 * granular preservada para quem quer o número por conjunto).
 */
export function groupAdsByCreative(ads: AdRow[]): CreativeGroup[] {
  const byName = new Map<string, AdRow[]>();
  for (const ad of ads) {
    const existing = byName.get(ad.adName);
    if (existing) existing.push(ad);
    else byName.set(ad.adName, [ad]);
  }

  const groups: CreativeGroup[] = [];
  for (const [key, rawMembers] of byName.entries()) {
    const members = [...rawMembers].sort((a, b) => b.spend - a.spend);
    const campaignCount = new Set(members.map((m) => m.campaignId)).size;
    const adsetCount = new Set(members.map((m) => m.adsetId)).size;

    const spend = members.reduce((total, m) => total + m.spend, 0);
    const impressions = members.reduce((total, m) => total + m.impressions, 0);
    const clicks = members.reduce((total, m) => total + m.clicks, 0);
    const leadsCrm = members.reduce((total, m) => total + m.leadsCrm, 0);
    const leadsFechados = members.reduce((total, m) => total + m.leadsFechados, 0);

    const card: AdRow = {
      adId: members[0].adId,
      adName: key,
      ...pickStatus(members),
      thumbnailUrl: members.find((m) => m.thumbnailUrl)?.thumbnailUrl ?? null,
      imageUrl: members.find((m) => m.imageUrl)?.imageUrl ?? null,
      landingUrl: members.find((m) => m.landingUrl)?.landingUrl ?? null,
      adsetId: adsetCount === 1 ? members[0].adsetId : "",
      adsetName: adsetCount === 1 ? members[0].adsetName : `${adsetCount} conjuntos`,
      adsetStatus: members[0].adsetStatus,
      campaignId: campaignCount === 1 ? members[0].campaignId : "",
      campaignName: campaignCount === 1 ? members[0].campaignName : `${campaignCount} campanhas`,
      campaignStatus: members[0].campaignStatus,
      spend,
      impressions,
      reach: members.reduce((total, m) => total + m.reach, 0),
      clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      cpc: clicks > 0 ? spend / clicks : null,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      frequency: null,
      leadsMeta: members.reduce((total, m) => total + m.leadsMeta, 0),
      cadastrosCrm: members.reduce((total, m) => total + m.cadastrosCrm, 0),
      leadsCrm,
      leadsQualificados: members.reduce((total, m) => total + m.leadsQualificados, 0),
      leadsFechados,
      valorFechado: members.reduce((total, m) => total + m.valorFechado, 0),
      cplReal: leadsCrm > 0 ? spend / leadsCrm : null,
      cacReal: leadsFechados > 0 ? spend / leadsFechados : null,
      stageCounts: sumStageCounts(members),
    };

    groups.push({ key, card, members, campaignCount, adsetCount });
  }

  return groups;
}
