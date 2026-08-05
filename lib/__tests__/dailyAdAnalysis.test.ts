import { buildDailyAnalysis, summarizeDailyAnalysis } from "@/lib/dailyAdAnalysis";
import type { DailyAdRow } from "@/types/metaAds";

function row(overrides: Partial<DailyAdRow>): DailyAdRow {
  return {
    date: "2026-07-28",
    adId: "a1",
    adName: "VOZUP_AD01",
    adsetName: "Conjunto 1",
    campaignName: "Campanha A",
    landingUrl: null,
    thumbnailUrl: null,
    imageUrl: null,
    videoId: null,
    spend: 0,
    impressions: 0,
    clicks: 0,
    leadsMeta: 0,
    cadastrosCrm: 0,
    novos: 0,
    envios: 0,
    leadsCrm: 0,
    ...overrides,
  };
}

const LP_VENDAS = "https://www.escolavozup.com/forms/vendas/6-perguntas";
const NATIVO = "http://fb.me/";

describe("buildDailyAnalysis", () => {
  const rows = [
    row({ date: "2026-07-28", adId: "a1", landingUrl: NATIVO, spend: 300, cadastrosCrm: 4, leadsCrm: 3, impressions: 1000, clicks: 20 }),
    row({ date: "2026-07-28", adId: "a2", landingUrl: LP_VENDAS, spend: 100, cadastrosCrm: 1, leadsCrm: 1 }),
    row({ date: "2026-07-27", adId: "a1", landingUrl: NATIVO, spend: 200, cadastrosCrm: 0 }),
  ];

  test("um bloco por dia, do mais recente pro mais antigo, com custo médio do dia", () => {
    const days = buildDailyAnalysis(rows);

    expect(days.map((day) => day.date)).toEqual(["2026-07-28", "2026-07-27"]);

    const [recente, anterior] = days;
    expect(recente.spend).toBe(400);
    expect(recente.cadastrosCrm).toBe(5);
    expect(recente.custoPorCadastro).toBe(80);
    expect(recente.adCount).toBe(2);
    expect(recente.buckets.map((bucket) => bucket.destination.kind)).toEqual(["native_form", "landing_page"]);

    // Dia com gasto e nenhum cadastro não tem custo por lead — null, não zero.
    expect(anterior.custoPorCadastro).toBeNull();
  });

  test("dentro do dia, cada grupo de destino traz seu próprio custo médio", () => {
    const [recente] = buildDailyAnalysis(rows);
    const [nativo, lp] = recente.buckets;
    expect(nativo.custoPorCadastro).toBe(75);
    expect(nativo.ctr).toBeCloseTo(2);
    expect(lp.custoPorCadastro).toBe(100);
    expect(lp.ads).toHaveLength(1);
  });

  test("cadastro que chegou num dia sem gasto continua aparecendo", () => {
    // Anúncio pausado que ainda recebeu cadastro: a linha vem do banco com
    // spend 0 e não pode desaparecer da leitura diária.
    const days = buildDailyAnalysis([row({ date: "2026-07-26", spend: 0, cadastrosCrm: 2, leadsCrm: 2 })]);
    expect(days).toHaveLength(1);
    expect(days[0].spend).toBe(0);
    expect(days[0].cadastrosCrm).toBe(2);
    expect(days[0].custoPorCadastro).toBe(0);
  });
});

describe("summarizeDailyAnalysis", () => {
  test("custo do período é gasto total ÷ cadastros totais, não a média das médias diárias", () => {
    // Média das médias daria (80 + 10) / 2 = 45; o certo é 600 ÷ 15 = 40.
    const days = buildDailyAnalysis([
      row({ date: "2026-07-28", spend: 400, cadastrosCrm: 5, novos: 5, leadsCrm: 5 }),
      row({ date: "2026-07-27", spend: 200, cadastrosCrm: 10, novos: 8, leadsCrm: 8 }),
    ]);

    const summary = summarizeDailyAnalysis(days);
    expect(summary.custoPorCadastro).toBe(40);
    // Custo por PESSOA NOVA usa `novos` (5 + 8), não `cadastros`: os dois
    // recontatos do dia 27 já eram da base e não são crescimento.
    expect(summary.custoPorContato).toBeCloseTo(600 / 13);
    expect(summary.dayCount).toBe(2);
    expect(summary.spendPerDay).toBe(300);
    expect(summary.cadastrosPerDay).toBe(7.5);
    expect(summary.bestDay?.date).toBe("2026-07-27");
    expect(summary.worstDay?.date).toBe("2026-07-28");
  });

  test("dias sem cadastro não entram no melhor/pior (não existe custo por lead lá)", () => {
    const days = buildDailyAnalysis([
      row({ date: "2026-07-28", spend: 400, cadastrosCrm: 5, leadsCrm: 5 }),
      row({ date: "2026-07-27", spend: 200, cadastrosCrm: 0 }),
    ]);

    const summary = summarizeDailyAnalysis(days);
    expect(summary.bestDay?.date).toBe("2026-07-28");
    expect(summary.worstDay).toBeNull();
  });

  test("período sem nenhum dia devolve zeros e nulos, sem dividir por zero", () => {
    const summary = summarizeDailyAnalysis([]);
    expect(summary.dayCount).toBe(0);
    expect(summary.spendPerDay).toBeNull();
    expect(summary.cadastrosPerDay).toBeNull();
    expect(summary.custoPorCadastro).toBeNull();
    expect(summary.bestDay).toBeNull();
  });
});
