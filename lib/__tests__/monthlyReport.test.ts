import {
  buildMonthlyReport,
  buildReportText,
  deltaPct,
  isReportMonth,
  monthBounds,
  monthLabel,
  shiftMonth,
  type MonthlyReportInput,
} from "@/lib/monthlyReport";
import type { AdRow, CampaignPurpose, DailySeriesPoint, FunnelStagePoint } from "@/types/metaAds";

function ad(overrides: Partial<AdRow> & { adId: string; campaignId: string; purpose?: CampaignPurpose }): AdRow {
  const { purpose = "captacao", ...rest } = overrides;
  return {
    adName: `Anúncio ${rest.adId}`,
    thumbnailUrl: null,
    imageUrl: null,
    videoId: null,
    campaignObjective: purpose === "engajamento" ? "OUTCOME_ENGAGEMENT" : "OUTCOME_LEADS",
    campaignPurpose: purpose,
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    landingUrl: null,
    adsetId: `set-${rest.campaignId}`,
    adsetName: "Conjunto",
    adsetStatus: "ACTIVE",
    campaignName: `Campanha ${rest.campaignId}`,
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
    ...rest,
  };
}

const FUNNEL: FunnelStagePoint[] = [
  { position: 0, key: "novo", label: "Novo", kind: "entry", count: 20 },
  { position: 1, key: "primeiro_contato", label: "Tentativas", kind: "normal", count: 12 },
  { position: 3, key: "agendado", label: "Agendado", kind: "normal", count: 5 },
  { position: 4, key: "fechamento", label: "Fechado", kind: "normal", count: 3 },
  { position: 6, key: "ganho", label: "Follow-Up", kind: "won", count: 2 },
  { position: 7, key: "perdido", label: "Repique", kind: "lost", count: 4 },
];

const SERIES: DailySeriesPoint[] = [
  { date: "2026-07-01", spend: 100, leadsMeta: 4, cadastrosCrm: 5, novos: 5, leadsCrm: 5, impressions: 1000, reach: 900, videoViews: 0 },
  { date: "2026-07-02", spend: 300, leadsMeta: 0, cadastrosCrm: 0, novos: 0, leadsCrm: 0, impressions: 2000, reach: 1800, videoViews: 0 },
  { date: "2026-07-03", spend: 0, leadsMeta: 0, cadastrosCrm: 1, novos: 1, leadsCrm: 1, impressions: 0, reach: 0, videoViews: 0 },
  { date: "2026-07-04", spend: 200, leadsMeta: 10, cadastrosCrm: 14, novos: 14, leadsCrm: 14, impressions: 3000, reach: 2500, videoViews: 0 },
];

function baseInput(overrides: Partial<MonthlyReportInput> = {}): MonthlyReportInput {
  return {
    month: "2026-07",
    from: "2026-07-01",
    to: "2026-07-31",
    parcial: false,
    ads: [
      ad({ adId: "1", campaignId: "c1", spend: 400, cadastrosCrm: 16, novos: 16, leadsCrm: 16, impressions: 4000, clicks: 200, leadsFechados: 2 }),
      ad({ adId: "2", campaignId: "c2", spend: 200, cadastrosCrm: 4, novos: 4, leadsCrm: 4, impressions: 2000, clicks: 60 }),
      ad({ adId: "3", campaignId: "c3", purpose: "engajamento", spend: 100, impressions: 30000, reach: 25000, postEngagement: 5000, videoViews: 12000 }),
    ],
    previousAds: null,
    previousMonth: null,
    periodReach: null,
    series: SERIES,
    funnel: FUNNEL,
    finance: null,
    previousFinance: null,
    ticketMedio: null,
    saleStageKey: null,
    enrollmentOrigins: null,
    ...overrides,
  };
}

/** `toLocaleString` de moeda usa espaço não-quebrável entre "R$" e o número;
 * o teste compara o texto legível, não o code point. */
function plainText(report: Parameters<typeof buildReportText>[0]): string {
  return buildReportText(report).replace(/ /g, " ");
}

/** Conciliação matrícula → lead → anúncio, como vem de getEnrollmentOrigins. */
function origins(
  anuncio: [number, number],
  crmSemAnuncio: [number, number],
  semCadastro: [number, number]
): NonNullable<MonthlyReportInput["enrollmentOrigins"]> {
  const total = anuncio[0] + crmSemAnuncio[0] + semCadastro[0];
  return {
    total,
    totalAmount: anuncio[1] + crmSemAnuncio[1] + semCadastro[1],
    anuncio: { count: anuncio[0], amount: anuncio[1] },
    crmSemAnuncio: { count: crmSemAnuncio[0], amount: crmSemAnuncio[1] },
    semCadastro: { count: semCadastro[0], amount: semCadastro[1] },
    rows: [],
  };
}

describe("helpers de mês", () => {
  it("valida o formato do mês", () => {
    expect(isReportMonth("2026-07")).toBe(true);
    expect(isReportMonth("2026-13")).toBe(false);
    expect(isReportMonth("2026-7")).toBe(false);
    expect(isReportMonth(null)).toBe(false);
  });

  it("anda para trás e para frente atravessando o ano", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-07", -6)).toBe("2026-01");
  });

  it("fecha o mês no último dia, inclusive fevereiro bissexto", () => {
    expect(monthBounds("2026-07")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("corta o mês corrente no dia de hoje, mas não encurta mês passado", () => {
    expect(monthBounds("2026-07", "2026-07-15")).toEqual({ from: "2026-07-01", to: "2026-07-15" });
    expect(monthBounds("2026-06", "2026-07-15")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  it("escreve o mês por extenso", () => {
    expect(monthLabel("2026-07")).toBe("Julho de 2026");
  });

  it("não inventa variação sem base de comparação", () => {
    expect(deltaPct(10, 0)).toBeNull();
    expect(deltaPct(10, null)).toBeNull();
    expect(deltaPct(150, 100)).toBe(50);
  });
});

describe("buildMonthlyReport", () => {
  it("separa investimento de conversão e de engajamento", () => {
    const report = buildMonthlyReport(baseInput());
    expect(report.investment.total).toBe(700);
    expect(report.investment.conversao).toBe(600);
    expect(report.investment.engajamento).toBe(100);
    expect(report.investment.shareEngajamentoPct).toBeCloseTo(14.29, 1);
  });

  it("mantém o engajamento fora de toda conta de custo por lead", () => {
    const report = buildMonthlyReport(baseInput());
    // 600 de conversão ÷ 20 cadastros — se os 100 do engajamento entrassem,
    // daria 35,00 e a mídia pareceria pior do que foi.
    expect(report.conversion.custoPorCadastro).toBe(30);
    expect(report.conversion.campanhas.every((line) => line.purpose !== "engajamento")).toBe(true);
    expect(report.engagement.campanhas).toHaveLength(1);
    expect(report.engagement.custoPorInteracao).toBeCloseTo(0.02, 4);
  });

  it("lê o funil pelo tipo da etapa, não pelo nome que a operação deu a ela", () => {
    const report = buildMonthlyReport(baseInput());
    expect(report.conversion.ganhos).toBe(2);
    expect(report.conversion.ganhoLabel).toBe("Follow-Up");
    expect(report.conversion.agendados).toBe(5);
    expect(report.conversion.taxaAgendamento).toBe(25);
  });

  it("aponta a campanha mais eficiente e a mais cara", () => {
    const report = buildMonthlyReport(baseInput());
    expect(report.conversion.melhorCampanha?.campaignId).toBe("c1");
    expect(report.conversion.melhorCampanha?.custoPorCadastro).toBe(25);
    expect(report.conversion.piorCampanha?.campaignId).toBe("c2");
    expect(report.conversion.piorCampanha?.custoPorCadastro).toBe(50);
  });

  it("conta dias com gasto e sem cadastro a partir da série diária", () => {
    const report = buildMonthlyReport(baseInput());
    expect(report.investment.diasComEntrega).toBe(3);
    expect(report.investment.diasSemCadastro).toBe(1);
    expect(report.investment.gastoSemCadastro).toBe(300);
    expect(report.investment.maiorDia).toEqual({ date: "2026-07-02", spend: 300 });
  });

  it("acusa campanha que gastou sem trazer cadastro", () => {
    const input = baseInput({
      ads: [
        ad({ adId: "1", campaignId: "c1", spend: 400, cadastrosCrm: 16, novos: 16, leadsCrm: 16 }),
        ad({ adId: "9", campaignId: "c9", spend: 150 }),
      ],
    });
    const report = buildMonthlyReport(input);
    expect(report.conversion.semCadastro).toEqual({ campanhas: 1, spend: 150 });
    expect(report.highlights.some((point) => point.text.includes("sem trazer nenhum cadastro"))).toBe(true);
  });

  it("NÃO conta etapa do funil como retorno: sem matrícula atribuída, retorno é zero", () => {
    // O caso real de julho/2026: dois leads de anúncio marcados como ganho no
    // CRM e nenhuma matrícula correspondente no Financeiro. Tratar a etapa
    // como venda inventava R$ 10.000 de retorno que nunca existiu.
    const report = buildMonthlyReport(
      baseInput({
        ticketMedio: 5000,
        finance: { month: "2026-07", recebido: 6050, previsto: 2600, matriculas: 5, valorContratado: 26000 },
        enrollmentOrigins: origins([0, 0], [1, 6000], [4, 20000]),
      })
    );
    expect(report.financial.basis).toBe("sem_base");
    expect(report.financial.retorno).toBeNull();
    expect(report.financial.roas).toBeNull();
    expect(report.financial.roiPct).toBeNull();
    expect(report.financial.matriculasDeAnuncio).toBe(0);
    expect(report.financial.matriculasNoMes).toBe(5);
    // A estimativa continua existindo, mas como potencial em aberto.
    expect(report.financial.potencial).toMatchObject({ oportunidades: 2, valor: 10000 });
    expect(report.highlights.some((point) => point.text.includes("Nenhuma das 5 matrículas"))).toBe(true);
    expect(report.highlights.some((point) => point.text.includes("É cenário, não receita"))).toBe(true);
  });

  it("avisa a divergência entre CRM e Financeiro", () => {
    const report = buildMonthlyReport(
      baseInput({
        ticketMedio: 5000,
        finance: { month: "2026-07", recebido: 6050, previsto: 2600, matriculas: 5, valorContratado: 26000 },
        enrollmentOrigins: origins([0, 0], [1, 6000], [4, 20000]),
      })
    );
    expect(report.financial.divergenciaCrmFinanceiro).toBe(true);
    expect(report.highlights.some((point) => point.text.includes("Atenção à divergência"))).toBe(true);
  });

  it("conta como retorno a matrícula conciliada com lead de anúncio", () => {
    const report = buildMonthlyReport(
      baseInput({
        ticketMedio: 5000,
        finance: { month: "2026-07", recebido: 6050, previsto: 2600, matriculas: 5, valorContratado: 26000 },
        enrollmentOrigins: origins([2, 11000], [1, 6000], [2, 9000]),
      })
    );
    expect(report.financial.basis).toBe("matricula");
    expect(report.financial.retorno).toBe(11000);
    expect(report.financial.matriculasDeAnuncio).toBe(2);
    expect(report.financial.roas).toBeCloseTo(11000 / 600, 4);
    expect(report.financial.custoPorMatricula).toBe(300);
    expect(report.financial.divergenciaCrmFinanceiro).toBe(false);
    expect(report.highlights.some((point) => point.text.includes("Retorno medido"))).toBe(true);
  });

  it("usa o valor fechado do CRM quando ele existe e não há matrícula conciliada", () => {
    const input = baseInput({
      finance: { month: "2026-07", recebido: 0, previsto: 0, matriculas: 1, valorContratado: 5000 },
      enrollmentOrigins: origins([0, 0], [0, 0], [1, 5000]),
    });
    input.ads[0] = { ...input.ads[0], valorFechado: 8000 };
    const report = buildMonthlyReport(input);
    expect(report.financial.basis).toBe("crm");
    expect(report.financial.retorno).toBe(8000);
  });

  it("sem conciliação disponível, não afirma retorno nem divergência", () => {
    const report = buildMonthlyReport(baseInput());
    expect(report.financial.basis).toBe("sem_base");
    expect(report.financial.retorno).toBeNull();
    expect(report.financial.divergenciaCrmFinanceiro).toBe(false);
  });

  it("aceita outra etapa como oportunidade fechada no cálculo do potencial", () => {
    const report = buildMonthlyReport(baseInput({ ticketMedio: 1000, saleStageKey: "fechamento" }));
    expect(report.financial.potencial.stageLabel).toBe("Fechado");
    expect(report.financial.potencial.oportunidades).toBe(3);
    expect(report.financial.potencial.valor).toBe(3000);
  });

  it("compara o mês com o anterior e sinaliza queda de custo como boa notícia", () => {
    const report = buildMonthlyReport(
      baseInput({
        previousMonth: "2026-06",
        previousAds: [ad({ adId: "p1", campaignId: "c1", spend: 500, cadastrosCrm: 10, novos: 10, leadsCrm: 10 })],
      })
    );
    expect(report.comparison?.previousMonth).toBe("2026-06");
    expect(report.comparison?.cadastros).toMatchObject({ current: 20, previous: 10, deltaPct: 100 });
    expect(report.comparison?.custoPorCadastro.deltaPct).toBeCloseTo(-40, 5);
    expect(report.highlights.some((point) => point.text.includes("custo por cadastro caiu"))).toBe(true);
  });

  it("fica sem comparativo quando o mês anterior não tem dado", () => {
    expect(buildMonthlyReport(baseInput()).comparison).toBeNull();
    expect(buildMonthlyReport(baseInput({ previousMonth: "2026-06", previousAds: [] })).comparison).toBeNull();
  });

  it("ignora o mês anterior que só tem anúncio cadastrado, sem entrega nem lead", () => {
    // getAdsHierarchy devolve a estrutura de anúncios mesmo em mês sem
    // insights; comparar com esse mês encheria a tela de badge vazio.
    const report = buildMonthlyReport(
      baseInput({ previousMonth: "2026-06", previousAds: [ad({ adId: "p1", campaignId: "c1" })] })
    );
    expect(report.comparison).toBeNull();
  });

  it("usa o ticket do Financeiro no potencial quando nenhum foi informado", () => {
    const report = buildMonthlyReport(
      baseInput({
        finance: { month: "2026-07", recebido: 2100, previsto: 2600, matriculas: 5, valorContratado: 26000 },
      })
    );
    expect(report.financial.potencial.ticketOrigem).toBe("financeiro");
    expect(report.financial.potencial.ticketMedio).toBe(5200);
    expect(report.financial.potencial.valor).toBe(10400);
    expect(report.financeContext?.ticketMedioMatricula).toBe(5200);
  });

  it("abre as matrículas do mês por origem apurada", () => {
    const report = buildMonthlyReport(
      baseInput({
        finance: { month: "2026-07", recebido: 6050, previsto: 2600, matriculas: 5, valorContratado: 26000 },
        enrollmentOrigins: origins([0, 0], [1, 6000], [4, 20000]),
      })
    );
    const point = report.highlights.find((item) => item.text.includes("se dividem em"));
    expect(point?.text).toContain("1 de lead do CRM sem anúncio");
    expect(point?.text).toContain("4 sem cadastro no CRM (venda fora do funil digital");
    expect(report.financeContext?.origens?.semCadastro).toEqual({ count: 4, amount: 20000 });
  });

  it("gera o texto do relatório com resumo, blocos e retorno medido", () => {
    const text = plainText(
      buildMonthlyReport(
        baseInput({
          ticketMedio: 5000,
          finance: { month: "2026-07", recebido: 6050, previsto: 2600, matriculas: 3, valorContratado: 16000 },
          enrollmentOrigins: origins([1, 5000], [0, 0], [2, 11000]),
        })
      )
    );
    expect(text).toContain("RELATÓRIO DE MÍDIA — JULHO DE 2026");
    expect(text).toContain("CONVERSÃO (campanhas com formulário)");
    expect(text).toContain("ENGAJAMENTO (campanhas de aparecer — não geram lead)");
    expect(text).toContain("RETORNO MEDIDO (matrícula registrada e conciliada com lead de anúncio)");
    expect(text).toContain("• Matrículas de anúncio: 1 de 3 no mês");
    expect(text).toContain("• Retorno: R$ 5.000,00");
    expect(text).toContain("Sem cadastro no CRM — indicação/boca a boca/presencial: 2");
  });

  it("o texto nunca apresenta o potencial como retorno", () => {
    const text = plainText(
      buildMonthlyReport(
        baseInput({
          ticketMedio: 5000,
          finance: { month: "2026-07", recebido: 0, previsto: 0, matriculas: 5, valorContratado: 26000 },
          enrollmentOrigins: origins([0, 0], [1, 6000], [4, 20000]),
        })
      )
    );
    expect(text).toContain("• Retorno: R$ 0,00 — nenhuma matrícula do mês foi atribuída a anúncio");
    expect(text).toContain("Potencial em aberto (cenário, não receita)");
    expect(text).not.toContain("• ROAS:");
  });
});
