import { buildAdDestinationGroups } from "@/lib/adDestinationGroups";
import { groupAdsByCreative } from "@/lib/creativeGroups";
import { summarizeArrival } from "@/lib/leadArrivalAnalysis";
import type { AdLeadDetail, AdRow } from "@/types/metaAds";

/**
 * A promessa da decomposição de cadastros é uma identidade:
 *
 *     envios = descartados + repetidos + recontatos + novos
 *     cadastros = novos + recontatos
 *
 * A classificação em si mora no SQL (leadBucketExpr, em lib/metaAds.ts), mas
 * todo agregador de tela soma esses campos por conta própria — e é aí que a
 * identidade costuma quebrar, porque basta esquecer um `+=` num agrupamento
 * novo para "Envios" e "Cadastros" passarem a contar universos diferentes na
 * mesma tela.
 */

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
    campaignObjective: null,
    campaignPurpose: "captacao",
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

/** Um anúncio coerente: 10 envios que se decompõem sem sobra. */
const COERENTE = {
  envios: 10,
  descartados: 1,
  repetidos: 2,
  recontatos: 3,
  novos: 4,
  cadastrosCrm: 7,
};

function lead(overrides: Partial<AdLeadDetail> & { id: number }): AdLeadDetail {
  return {
    nome: `Lead ${overrides.id}`,
    telefone: null,
    email: null,
    criadoEm: "2026-08-01T12:00:00.000Z",
    hora: 9,
    diaSemana: 6,
    dia: "2026-08-01",
    adId: "1",
    adName: "VOZUP_AD01",
    adsetName: "Conjunto 1",
    campaignName: "Campanha A",
    landingUrl: null,
    thumbnailUrl: null,
    imageUrl: null,
    videoId: null,
    stageKey: null,
    stageLabel: null,
    stageKind: null,
    sellerName: "Andrea",
    bucket: "novo",
    isReturning: false,
    etapasAlcancadas: [],
    ...overrides,
  };
}

describe("identidade dos cadastros nos agregadores", () => {
  it("o agrupamento por destino soma as quatro caixas e fecha a conta", () => {
    const [group] = buildAdDestinationGroups([
      ad({ adId: "a1", ...COERENTE }),
      ad({ adId: "a2", adsetId: "s2", ...COERENTE }),
    ]);

    expect(group.envios).toBe(20);
    expect(group.descartados + group.repetidos + group.recontatos + group.novos).toBe(group.envios);
    expect(group.cadastrosCrm).toBe(group.novos + group.recontatos);
  });

  it("o card de criativo somado entre conjuntos mantém a mesma identidade", () => {
    const [{ card }] = groupAdsByCreative([
      ad({ adId: "a1", ...COERENTE }),
      ad({ adId: "a2", adsetId: "s2", adsetName: "Conjunto 2", ...COERENTE }),
    ]);

    expect(card.envios).toBe(20);
    expect(card.descartados + card.repetidos + card.recontatos + card.novos).toBe(card.envios);
    expect(card.cadastrosCrm).toBe(card.novos + card.recontatos);
  });
});

describe("summarizeArrival", () => {
  it("recontato conta como cadastro mas não como pessoa nova", () => {
    const outcomes = summarizeArrival([
      lead({ id: 1, bucket: "novo" }),
      lead({ id: 2, bucket: "recontato", isReturning: true }),
    ]);

    expect(outcomes.cadastros).toBe(2);
    expect(outcomes.contatosNovos).toBe(1);
  });

  it("repetição do período aparece na lista mas não é contada de novo", () => {
    const outcomes = summarizeArrival([
      lead({ id: 1, bucket: "novo" }),
      lead({ id: 2, bucket: "repetido", isReturning: true }),
    ]);

    expect(outcomes.cadastros).toBe(1);
    expect(outcomes.contatosNovos).toBe(1);
  });

  it("a taxa de agendamento usa pessoas como base, não envios repetidos", () => {
    const outcomes = summarizeArrival([
      lead({ id: 1, bucket: "novo", etapasAlcancadas: ["agendado"] }),
      lead({ id: 2, bucket: "repetido", isReturning: true }),
    ]);

    // 1 agendamento sobre 1 pessoa = 100%. Contando a repetição daria 50% e a
    // operação pareceria pior do que foi.
    expect(outcomes.taxaAgendamento).toBe(100);
  });
});
