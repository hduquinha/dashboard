import { ensureCommercialSchema } from "@/lib/commercial";
import { autoMergeNewLeadByPhone, getPool } from "@/lib/db";
import { ingestVozupLead } from "@/lib/vozupLeadIngest";

jest.mock("@/lib/db", () => ({
  autoMergeNewLeadByPhone: jest.fn(),
  getPool: jest.fn(),
}));

jest.mock("@/lib/commercial", () => ({
  ensureCommercialSchema: jest.fn(),
}));

// O lead novo já nasce no funil padrão: sem `funnel_id` gravado aqui, o card
// não aparece em coluna nenhuma do Kanban depois de distribuído.
jest.mock("@/lib/funnels", () => ({
  getDefaultFunnel: jest.fn(async () => ({
    id: 7,
    name: "Funil VozUP",
    isDefault: true,
    sellerIds: [],
    stages: [{ id: 1, key: "novo", label: "Novo", kind: "entry", color: "slate", position: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })),
  findStageByKind: jest.requireActual("@/lib/funnels").findStageByKind,
}));

const mockedGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockedMerge = autoMergeNewLeadByPhone as jest.MockedFunction<
  typeof autoMergeNewLeadByPhone
>;
const mockedEnsureCommercialSchema = ensureCommercialSchema as jest.MockedFunction<
  typeof ensureCommercialSchema
>;

describe("ingestVozupLead attribution guard", () => {
  const query = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValueOnce({ rows: [{ id: 321 }] }).mockResolvedValue({ rows: [] });
    mockedGetPool.mockReturnValue({ query } as unknown as ReturnType<typeof getPool>);
    mockedMerge.mockResolvedValue({ merged: false, primaryId: 321 });
    mockedEnsureCommercialSchema.mockResolvedValue(undefined);
  });

  it("persiste e sincroniza a origem organica normalizada", async () => {
    const savedId = await ingestVozupLead(
      {
        nome: "Pessoa de Teste",
        telefone: "11999999999",
        origem: "Meta Ads VozUP - Home",
        treinamento_nome: "Meta Ads VozUP - Home",
        utm_source: "ig",
        utm_medium: "social",
        utm_content: "link_in_bio",
        fbclid: "click-organico-meta",
      },
      { notify: false }
    );

    expect(savedId).toBe(321);
    const insertedPayload = JSON.parse(query.mock.calls[0][1][0] as string);
    expect(insertedPayload).toMatchObject({
      origem: "Landing Page VozUP - Home",
      treinamento_nome: "Landing Page VozUP - Home",
      utm_source: "ig",
      utm_medium: "social",
      utm_content: "link_in_bio",
      fbclid: "click-organico-meta",
    });
    expect(mockedMerge).toHaveBeenCalledWith(321, "11999999999");

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO dashboard.commercial_leads"),
      [321, "Landing Page VozUP - Home", 7, "novo"]
    );
  });

  it("mantem Meta Ads quando o payload traz evidencia paga real", async () => {
    await ingestVozupLead(
      {
        nome: "Pessoa de Teste",
        telefone: "11999999999",
        origem: "Meta Ads VozUP - Gravar Videos",
        treinamento_nome: "Meta Ads VozUP - Gravar Videos",
        utm_source: "facebookads",
        utm_medium: "cpc",
        utm_campaign: "PROXON | CAPTACAO",
        utm_term: "99_INTERESSES",
        utm_content: "VOZUP_AD09_IMG_AUTO",
        fbclid: "click-pago-meta",
      },
      { notify: false }
    );

    const insertedPayload = JSON.parse(query.mock.calls[0][1][0] as string);
    expect(insertedPayload).toMatchObject({
      origem: "Meta Ads VozUP - Gravar Videos",
      treinamento_nome: "Meta Ads VozUP - Gravar Videos",
      utm_source: "facebookads",
      utm_medium: "cpc",
      utm_campaign: "PROXON | CAPTACAO",
      utm_term: "99_INTERESSES",
      utm_content: "VOZUP_AD09_IMG_AUTO",
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO dashboard.commercial_leads"),
      [321, "Meta Ads VozUP - Gravar Videos", 7, "novo"]
    );
  });
});
