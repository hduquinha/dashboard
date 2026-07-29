import { groupAdsByCreative } from "@/lib/creativeGroups";
import type { AdRow } from "@/types/metaAds";

/** AdRow mínimo — só os campos que o agrupamento realmente usa; o resto recebe
 * um default plausível para não poluir cada caso de teste. */
function ad(overrides: Partial<AdRow>): AdRow {
  return {
    adId: "1",
    adName: "VOZUP_AD09_IMG_AUTO",
    status: "PAUSED",
    effectiveStatus: "PAUSED",
    thumbnailUrl: null,
    imageUrl: null,
    videoId: null,
    landingUrl: null,
    adsetId: "s1",
    adsetName: "Conjunto 1",
    adsetStatus: "ACTIVE",
    campaignId: "c1",
    campaignName: "Campanha A",
    campaignStatus: "ACTIVE",
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    ctr: null,
    cpc: null,
    cpm: null,
    frequency: null,
    leadsMeta: 0,
    cadastrosCrm: 0,
    leadsCrm: 0,
    leadsQualificados: 0,
    leadsFechados: 0,
    valorFechado: 0,
    cplReal: null,
    cacReal: null,
    stageCounts: {},
    ...overrides,
  };
}

describe("groupAdsByCreative", () => {
  test("o mesmo criativo em vários conjuntos vira um card só, com métricas somadas", () => {
    // Cenário real: a Meta creditou Leads nos conjuntos que rodaram (2+2+2),
    // mas os cadastros do CRM (via utm_term) caíram noutros conjuntos (6+2).
    // Por conjunto não bate; somado no criativo, 6 Meta vs 8 CRM — reconcilia.
    const ads = [
      ad({ adId: "a1", adsetId: "s1", adsetName: "Conjunto 1", leadsMeta: 2, cadastrosCrm: 6, leadsCrm: 5, spend: 40, impressions: 100, clicks: 10 }),
      ad({ adId: "a2", adsetId: "s2", adsetName: "Conjunto 2", leadsMeta: 2, cadastrosCrm: 2, leadsCrm: 2, spend: 20, impressions: 50, clicks: 5 }),
      ad({ adId: "a3", adsetId: "s3", adsetName: "Conjunto 3", leadsMeta: 2, cadastrosCrm: 0, leadsCrm: 0, spend: 20, impressions: 50, clicks: 5 }),
    ];

    const groups = groupAdsByCreative(ads);

    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.key).toBe("VOZUP_AD09_IMG_AUTO");
    expect(group.members).toHaveLength(3);
    expect(group.adsetCount).toBe(3);
    expect(group.campaignCount).toBe(1);

    expect(group.card.leadsMeta).toBe(6);
    expect(group.card.cadastrosCrm).toBe(8);
    expect(group.card.leadsCrm).toBe(7);
    expect(group.card.spend).toBe(80);
    // Rótulos agregados em vez de um conjunto arbitrário.
    expect(group.card.adsetName).toBe("3 conjuntos");
    expect(group.card.campaignName).toBe("Campanha A");
  });

  test("um criativo por conjunto (escopo granular) preserva o número por conjunto", () => {
    const groups = groupAdsByCreative([
      ad({ adId: "a1", adName: "VOZUP_AD01", leadsMeta: 3, cadastrosCrm: 1 }),
      ad({ adId: "a2", adName: "VOZUP_AD02", leadsMeta: 0, cadastrosCrm: 4 }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key).sort()).toEqual(["VOZUP_AD01", "VOZUP_AD02"]);
    for (const g of groups) {
      expect(g.adsetCount).toBe(1);
      expect(g.card.adsetName).toBe("Conjunto 1");
    }
  });

  test("criativo fica 'em veiculação' se qualquer conjunto estiver ativo", () => {
    const [group] = groupAdsByCreative([
      ad({ adId: "a1", effectiveStatus: "PAUSED", status: "PAUSED" }),
      ad({ adId: "a2", effectiveStatus: "ACTIVE", status: "ACTIVE" }),
    ]);
    expect(group.card.effectiveStatus).toBe("ACTIVE");
  });

  test("CTR/CPC do card derivam da soma, não da média dos conjuntos", () => {
    const [group] = groupAdsByCreative([
      ad({ adId: "a1", spend: 30, impressions: 100, clicks: 10 }),
      ad({ adId: "a2", spend: 10, impressions: 100, clicks: 10 }),
    ]);
    // CTR = 20 cliques / 200 impressões = 10%
    expect(group.card.ctr).toBeCloseTo(10);
    // CPC = R$40 / 20 cliques = R$2
    expect(group.card.cpc).toBeCloseTo(2);
  });
});
