import { buildAdDestinationGroups, classifyAdDestination, costPer, summarizeByKind } from "@/lib/adDestinationGroups";
import type { AdRow } from "@/types/metaAds";

function ad(overrides: Partial<AdRow>): AdRow {
  return {
    adId: "1",
    adName: "VOZUP_AD01",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
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
    envios: 0,
    descartados: 0,
    repetidos: 0,
    recontatos: 0,
    novos: 0,
    leadsCrm: 0,
    leadsQualificados: 0,
    leadsFechados: 0,
    valorFechado: 0,
    cplReal: null,
    cacReal: null,
    stageCounts: {},
    campaignObjective: "OUTCOME_LEADS",
    campaignPurpose: "captacao",
    videoViews: 0,
    linkClicks: 0,
    landingPageViews: 0,
    postEngagement: 0,
    pageEngagement: 0,
    reactions: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    messagingStarted: 0,
    ...overrides,
  };
}

describe("classifyAdDestination", () => {
  test("fb.me é formulário nativo (Lead Ads), não landing page", () => {
    // O sync grava esse placeholder quando o criativo não tem página externa —
    // é o mesmo anúncio cujos leads chegam com origem "Facebook Lead Ads".
    const destination = classifyAdDestination("http://fb.me/");
    expect(destination.kind).toBe("native_form");
    expect(destination.key).toBe("native_form");
    expect(destination.url).toBeNull();
  });

  test("landing page do site vira grupo por tema e variante, com acento no rótulo", () => {
    const destination = classifyAdDestination("https://www.escolavozup.com/forms/falar-em-publico/6-perguntas?utm_source=x");
    expect(destination.kind).toBe("landing_page");
    expect(destination.key).toBe("lp:falar-em-publico/6-perguntas");
    expect(destination.label).toBe("LP Falar em Público");
    expect(destination.detail).toBe("6 perguntas");
    // A query string sai fora: é assim que o grupo (e o Clarity) enxerga a página.
    expect(destination.url).toBe("https://www.escolavozup.com/forms/falar-em-publico/6-perguntas");
  });

  test("tema novo que ainda não está no mapa não quebra: cai no fallback legível", () => {
    const destination = classifyAdDestination("https://www.escolavozup.com/forms/tema-novo/4-perguntas");
    expect(destination.kind).toBe("landing_page");
    expect(destination.label).toBe("LP Tema Novo");
    expect(destination.detail).toBe("4 perguntas");
  });

  test("sem URL o destino fica explicitamente não identificado (nunca vira nativo por dedução)", () => {
    expect(classifyAdDestination(null).kind).toBe("unknown");
    expect(classifyAdDestination("   ").kind).toBe("unknown");
  });
});

describe("costPer", () => {
  test("gasto ÷ quantidade", () => {
    expect(costPer(400, 50)).toBe(8);
  });

  test("sem quantidade devolve null (a UI mostra '—', não R$ 0,00)", () => {
    expect(costPer(400, 0)).toBeNull();
  });
});

describe("buildAdDestinationGroups", () => {
  const ads = [
    ad({ adId: "a1", adName: "AD_A", landingUrl: "http://fb.me/", spend: 300, cadastrosCrm: 4, leadsCrm: 3, leadsMeta: 5, impressions: 1000, clicks: 50 }),
    ad({ adId: "a2", adName: "AD_A", adsetId: "s2", landingUrl: "http://fb.me/", spend: 100, cadastrosCrm: 1, leadsCrm: 1 }),
    ad({
      adId: "a3",
      adName: "AD_B",
      campaignId: "c2",
      landingUrl: "https://www.escolavozup.com/forms/vendas/6-perguntas",
      spend: 200,
      cadastrosCrm: 2,
      leadsCrm: 2,
      leadsFechados: 1,
    }),
  ];

  test("soma por destino e deriva o custo médio por lead", () => {
    const groups = buildAdDestinationGroups(ads);

    expect(groups.map((group) => group.key)).toEqual(["native_form", "lp:vendas/6-perguntas"]);

    const [nativo, lp] = groups;
    expect(nativo.spend).toBe(400);
    expect(nativo.cadastrosCrm).toBe(5);
    expect(nativo.custoPorCadastro).toBe(80);
    // Dois ad_id do mesmo criativo em conjuntos diferentes = 1 criativo.
    expect(nativo.creativeCount).toBe(1);
    expect(nativo.adsetCount).toBe(2);
    expect(nativo.ctr).toBeCloseTo(5);

    expect(lp.custoPorCadastro).toBe(100);
    expect(lp.custoPorVenda).toBe(200);
  });

  test("formulário nativo vem antes das landing pages, independente do gasto", () => {
    const groups = buildAdDestinationGroups([
      ad({ adId: "a1", landingUrl: "https://www.escolavozup.com/forms/vendas/6-perguntas", spend: 9000 }),
      ad({ adId: "a2", landingUrl: "http://fb.me/", spend: 1 }),
    ]);
    expect(groups.map((group) => group.kind)).toEqual(["native_form", "landing_page"]);
  });

  test("resumo por tipo compara nativo × landing pages sem duplicar lead", () => {
    const summaries = summarizeByKind(buildAdDestinationGroups(ads));
    expect(summaries).toHaveLength(2);
    const [nativo, landings] = summaries;
    expect(nativo.custoPorCadastro).toBe(80);
    expect(landings.groupCount).toBe(1);
    expect(landings.cadastrosCrm).toBe(2);
    expect(nativo.cadastrosCrm + landings.cadastrosCrm).toBe(7);
  });
});
