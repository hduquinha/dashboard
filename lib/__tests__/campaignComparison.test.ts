import { buildComparison, type ComparisonInput } from "@/lib/campaignComparison";
import { classifyCampaignPurpose, matchesPurposeFilter, parsePurposeFilter } from "@/lib/campaignObjectives";

function entity(overrides: Partial<ComparisonInput> & { key: string }): ComparisonInput {
  return {
    label: overrides.key,
    sublabel: null,
    purpose: "captacao",
    spend: 0,
    cadastros: 0,
    leadsCrm: 0,
    leadsQualificados: 0,
    leadsFechados: 0,
    impressions: 0,
    clicks: 0,
    videoViews: 0,
    postEngagement: 0,
    ...overrides,
  };
}

describe("buildComparison", () => {
  const inputs = [
    entity({ key: "a", spend: 800, cadastros: 80, impressions: 1000, clicks: 100 }),
    entity({ key: "b", spend: 100, cadastros: 15 }),
    entity({ key: "c", spend: 100, cadastros: 5 }),
    entity({ key: "d", spend: 50, cadastros: 0 }),
  ];

  it("calcula fatias, custo por lead e eficiência", () => {
    const result = buildComparison(inputs);

    expect(result.totalSpend).toBe(1050);
    expect(result.totalCadastros).toBe(100);
    expect(result.custoMedio).toBe(10.5);

    const a = result.entities.find((e) => e.key === "a")!;
    expect(a.custoPorLead).toBe(10);
    expect(a.shareLeads).toBe(80);
    expect(Math.round(a.shareSpend)).toBe(76);
    // Traz 80% dos leads consumindo 76% do gasto → levemente acima de 1.
    expect(a.eficiencia).toBeGreaterThan(1);
    expect(a.ctr).toBe(10);

    const c = result.entities.find((e) => e.key === "c")!;
    expect(c.custoPorLead).toBe(20);
    expect(c.eficiencia).toBeLessThan(1);
  });

  it("ranqueia por custo e ignora quem não teve cadastro", () => {
    const result = buildComparison(inputs);

    expect(result.melhorCusto?.key).toBe("b");
    expect(result.piorCusto?.key).toBe("c");
    expect(result.maiorVolume?.key).toBe("a");
    expect(result.entities.find((e) => e.key === "d")?.rankCusto).toBeNull();
    expect(result.semResultado.map((e) => e.key)).toEqual(["d"]);
  });

  it("monta o Pareto e diz onde está a concentração", () => {
    const result = buildComparison(inputs);

    expect(result.pareto.map((p) => p.key)).toEqual(["a", "b", "c"]);
    expect(result.pareto[0].acumulado).toBe(80);
    expect(result.pareto[2].acumulado).toBe(100);
    // Uma única entidade já responde por 80% dos cadastros.
    expect(result.concentracao).toEqual({ quantidade: 1, total: 3, share: 80 });
  });

  it("não quebra com recorte vazio nem divide por zero", () => {
    const empty = buildComparison([]);
    expect(empty.custoMedio).toBeNull();
    expect(empty.concentracao).toBeNull();
    expect(empty.melhorCusto).toBeNull();

    const semGasto = buildComparison([entity({ key: "x", spend: 0, cadastros: 0 })]);
    expect(semGasto.entities[0].eficiencia).toBeNull();
    expect(semGasto.entities[0].custoPorLead).toBeNull();
    expect(semGasto.semResultado).toEqual([]);
  });

  it("não elege pior custo quando só existe uma entidade com cadastro", () => {
    const result = buildComparison([entity({ key: "unica", spend: 100, cadastros: 10 })]);
    expect(result.melhorCusto?.key).toBe("unica");
    expect(result.piorCusto).toBeNull();
  });
});

describe("objetivo da campanha", () => {
  it("separa captação de engajamento", () => {
    expect(classifyCampaignPurpose("OUTCOME_LEADS")).toBe("captacao");
    expect(classifyCampaignPurpose("OUTCOME_ENGAGEMENT")).toBe("engajamento");
    expect(classifyCampaignPurpose("outcome_leads")).toBe("captacao");
    expect(classifyCampaignPurpose(null)).toBe("outro");
    expect(classifyCampaignPurpose("OBJETIVO_NOVO_DA_META")).toBe("outro");
  });

  it("filtra mantendo objetivo desconhecido junto da captação", () => {
    expect(parsePurposeFilter("qualquer-coisa")).toBe("todas");
    expect(matchesPurposeFilter("outro", "captacao")).toBe(true);
    expect(matchesPurposeFilter("outro", "engajamento")).toBe(false);
    expect(matchesPurposeFilter("engajamento", "captacao")).toBe(false);
    expect(matchesPurposeFilter("engajamento", "todas")).toBe(true);
  });
});
